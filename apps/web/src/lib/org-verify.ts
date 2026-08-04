import {
  ORG_CHARTER_FIELDS,
  orgs,
  ORG_VERIFY_MAX_ATTEMPTS,
  completeOrgVerification,
  getDb,
  liveOrgVerification,
  noteOrgVerificationAttempt,
  startOrgVerification,
} from "@kcx/db";
import { generateVerificationCode } from "@kcx/shared";
import { eq } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { storeUploadedImage } from "@/lib/uploads";

/**
 * Proving control of an org.
 *
 * The same trick as handle verification, pointed at a different page. An org's public RSI
 * page carries a Charter, History and Manifesto — all editable only by org admins — so a
 * code appearing in one of them proves control of the ORG, not merely membership of it.
 *
 * That is what lets leadership be settled without anyone's judgement. Moderators remain the
 * override for the cases judgement is actually needed on: compromised accounts, leadership
 * that changed hands off-platform, and disputes.
 *
 * Fetch policy matches lib/rsi-verify.ts: user-initiated only, one page per request, and a
 * cooldown per attempt. A human clicking "check" should look like a human loading the page.
 */

export const ORG_PAGE_BASE = "https://robertsspaceindustries.com/orgs";
const UA = "KCX/0.1 (Kestrel Commodities Exchange, unofficial Star Citizen fan project)";

export type OrgVerifyOutcome =
  | { ok: true; orgId: string }
  | { ok: false; reason: "no_claim" | "expired" | "attempts" | "fetch_failed" | "no_code"; message: string };

/** Codes carry an ORG marker so nobody pastes a handle code into a charter and wonders why. */
export function generateOrgCode(): string {
  return generateVerificationCode(randomInt).replace(/^KCX-/, "KCXORG-");
}

/** Issue a code for a leadership claim. */
export async function startOrgClaim(orgId: string, claimantId: string) {
  return startOrgVerification(getDb(), { orgId, claimantId, code: generateOrgCode() });
}

const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

/**
 * Pull the org's public description blocks.
 *
 * All three live under `js-show-description-content`, one per tab. Read together rather than
 * insisting on a particular one: a leader told to "paste it in your charter" will sometimes
 * put it in the history, and refusing that would be pedantry rather than security — every
 * one of these fields requires the same org-admin rights to edit.
 */
export function extractCharterText(html: string): string {
  const blocks = html.match(/class="[^"]*js-show-description-content[^"]*"[\s\S]{0,20000}?<\/div>/gi) ?? [];
  // The logo alt text and org name also sit on the page; including the whole body would let
  // a code pasted anywhere at all count, so this stays scoped to the editable blocks.
  return blocks.map(stripTags).join("\n");
}

/** RSI's org logo, so an org's listings can carry its own badge. */
export function extractOrgLogoUrl(html: string): string | null {
  const m = html.match(/<img[^>]*src="([^"]*\/logo\/[^"]+)"/i);
  if (!m?.[1]) return null;
  return m[1].startsWith("http") ? m[1] : `https://robertsspaceindustries.com${m[1]}`;
}

const normalise = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/**
 * Check the org page for the outstanding code, and on success cache the logo.
 *
 * The logo is fetched and stored through the ordinary upload pipeline — magic-byte sniffed,
 * re-encoded filename, served from our own origin — rather than hotlinked. Hotlinking would
 * put RSI's bandwidth behind every board render and break the moment they set a referrer
 * policy, and the pipeline already refuses anything that isn't really an image.
 */
export async function checkOrgClaim(orgId: string, sid: string): Promise<OrgVerifyOutcome> {
  const db = getDb();
  const claim = await liveOrgVerification(db, orgId);
  if (!claim) return { ok: false, reason: "no_claim", message: "No leadership claim is open for this org." };
  if (claim.expiresAt <= new Date()) {
    return { ok: false, reason: "expired", message: "That code expired. Start a new claim." };
  }
  const attempts = await noteOrgVerificationAttempt(db, claim.id);
  if (attempts > ORG_VERIFY_MAX_ATTEMPTS) {
    return { ok: false, reason: "attempts", message: "Too many checks on this code. Start a new claim." };
  }

  let html: string;
  try {
    const res = await fetch(`${ORG_PAGE_BASE}/${encodeURIComponent(sid)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { ok: false, reason: "fetch_failed", message: `RSI returned ${res.status} for that org page.` };
    }
    html = await res.text();
  } catch {
    return { ok: false, reason: "fetch_failed", message: "Couldn't reach RSI just now. Try again shortly." };
  }

  if (!normalise(extractCharterText(html)).includes(normalise(claim.code))) {
    return {
      ok: false,
      reason: "no_code",
      message: `Couldn't find ${claim.code} in the org's ${ORG_CHARTER_FIELDS.join(", ")}. Paste it in, save, then check again.`,
    };
  }

  // Best-effort: a logo we can't fetch is a missing badge, never a failed verification.
  let logoFilename: string | null = null;
  const logoUrl = extractOrgLogoUrl(html);
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        const stored = await storeUploadedImage(Buffer.from(await res.arrayBuffer()), "orgs");
        if (stored.ok) logoFilename = stored.image.filename;
      }
    } catch {
      /* keep going without a logo */
    }
  }

  const result = await completeOrgVerification(db, { verificationId: claim.id, logoFilename });
  if (!result.ok) return { ok: false, reason: "no_claim", message: result.error };
  return { ok: true, orgId };
}

/** Retry a missing logo at most this often. Orgs with no logo at all do exist. */
const PROFILE_REFRESH_HOURS = 24;

/**
 * Fill in an org's public name and logo from its RSI page.
 *
 * These are public facts on a page anyone can read, so they are deliberately NOT gated
 * behind a leadership claim — doing that meant every unverified org rendered blank, and
 * unverified is the state every org starts in. The directory looked broken as a result.
 *
 * Called lazily when an org page is viewed and something is missing, never in a loop over
 * the directory: one org viewed is at most one outbound request, and only if we haven't
 * asked in the last day. That keeps this indistinguishable from a human opening the page,
 * which is the standard the rest of our RSI reads are held to.
 *
 * Entirely best-effort. A missing logo is a blank square, never a failed page.
 */
export async function refreshOrgPublicProfile(orgId: string, sid: string): Promise<void> {
  const db = getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) return;

  const needsLogo = !org.logoFilename;
  // A name equal to the SID means it came from the backfill, which only had the SID.
  const needsName = org.name === org.sid;
  if (!needsLogo && !needsName) return;
  if (org.profileFetchedAt && Date.now() - org.profileFetchedAt.getTime() < PROFILE_REFRESH_HOURS * 3_600_000) {
    return;
  }

  // Stamped BEFORE the fetch, so a page that errors or has no logo still counts as tried.
  // Stamping afterwards would retry every view for exactly the orgs that never resolve.
  await db.update(orgs).set({ profileFetchedAt: new Date() }).where(eq(orgs.id, orgId));

  let html: string;
  try {
    const res = await fetch(`${ORG_PAGE_BASE}/${encodeURIComponent(sid)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return;
    html = await res.text();
  } catch {
    return;
  }

  const patch: { name?: string; logoFilename?: string } = {};

  if (needsName) {
    const name = extractOrgName(html);
    if (name && name !== sid) patch.name = name;
  }

  if (needsLogo) {
    const logoUrl = extractOrgLogoUrl(html);
    if (logoUrl) {
      try {
        const res = await fetch(logoUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          // Through the ordinary pipeline: magic-byte sniffed and given a generated name,
          // because "it came from RSI" is not the same as "it is an image".
          const stored = await storeUploadedImage(Buffer.from(await res.arrayBuffer()), "orgs");
          if (stored.ok) patch.logoFilename = stored.image.filename;
        }
      } catch {
        /* blank square is fine */
      }
    }
  }

  if (Object.keys(patch).length > 0) {
    await db.update(orgs).set({ ...patch, updatedAt: new Date() }).where(eq(orgs.id, orgId));
  }
}

/** The org's display name from its public page header. */
export function extractOrgName(html: string): string | null {
  const m =
    html.match(/<h1[^>]*>\s*([^<]+?)\s*(?:<span|<\/h1>)/i) ??
    html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  const raw = m?.[1]?.trim();
  if (!raw) return null;
  // The header renders as "Maikoh Company / MAIKOHCO", with the SID inside its own span —
  // so the capture stops at the tag and leaves a dangling separator behind. Strip the SID
  // if it survived, then any trailing separator, or every org name ends in " /".
  return (
    raw
      .replace(/\s*[/|–-]\s*[A-Z0-9]{3,20}\s*$/, "")
      .replace(/\s*[/|–-]\s*$/, "")
      .trim() || null
  );
}
