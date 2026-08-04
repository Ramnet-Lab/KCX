import { authEvents, getDb, rsiVerifications, users } from "@kcx/db";
import {
  RSI_HANDLE_RE,
  RSI_PROFILE_BASE,
  bioContainsCode,
  generateVerificationCode,
  parseRsiProfile,
  type RsiProfile,
} from "@kcx/shared";
import { and, eq, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";

/**
 * RSI ownership verification.
 *
 * Fetch policy is deliberately conservative: user-initiated only, one profile per request,
 * a global budget, and a per-attempt cooldown. RSI's ToS discourages automated access, so the
 * rule of thumb is that a human clicking "check" should be indistinguishable from a human
 * loading the page themselves.
 */

export const CODE_TTL_MINUTES = 30;
/** Global ceiling on outbound profile fetches per rolling hour. */
export const GLOBAL_FETCH_BUDGET_PER_HOUR = 60;
/** A trader can re-check their own verification this often. */
export const CHECK_COOLDOWN_SECONDS = 20;
export const MAX_ATTEMPTS = 20;

export type VerifyOutcome =
  | { ok: true; profile: RsiProfile }
  | { ok: false; reason: "cooldown" | "budget" | "not_found" | "no_code" | "expired" | "attempts" | "fetch_failed"; message: string };

async function withinGlobalBudget(): Promise<boolean> {
  const rows = await getDb().execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM rsi_verifications
    WHERE last_attempt_at > now() - interval '1 hour'
  `);
  return Number(rows.rows[0]?.n ?? 0) < GLOBAL_FETCH_BUDGET_PER_HOUR;
}

/** Start (or restart) verification for a handle. Returns the code to paste into the bio. */
export async function startVerification(
  handle: string,
  userId?: string | null,
): Promise<{ ok: true; code: string; expiresAt: Date } | { ok: false; message: string }> {
  const normalised = handle.trim();
  if (!RSI_HANDLE_RE.test(normalised)) {
    return { ok: false, message: "That doesn't look like an RSI handle (letters, numbers, _ or -)." };
  }

  const db = getDb();
  const lower = normalised.toLowerCase();

  // One account per RSI handle — the whole anti-alt design rests on this.
  const [claimed] = await db.select({ id: users.id }).from(users).where(eq(users.handle, lower));
  if (claimed && claimed.id !== userId) {
    return { ok: false, message: "That RSI handle is already linked to a KCX account." };
  }

  const code = generateVerificationCode((max) => randomInt(max));
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await db.transaction(async (tx) => {
    // Supersede any earlier pending attempt for this handle.
    await tx
      .update(rsiVerifications)
      .set({ status: "expired" })
      .where(and(eq(rsiVerifications.handle, lower), eq(rsiVerifications.status, "pending")));
    await tx.insert(rsiVerifications).values({ handle: lower, code, expiresAt, userId: userId ?? null });
    await tx.insert(authEvents).values({ handle: lower, userId: userId ?? null, type: "verification_started" });
  });

  return { ok: true, code, expiresAt };
}

/** Fetch the public profile and confirm the code is present in the bio. */
export async function checkVerification(handle: string): Promise<VerifyOutcome> {
  const db = getDb();
  const lower = handle.trim().toLowerCase();

  const [pending] = await db
    .select()
    .from(rsiVerifications)
    .where(and(eq(rsiVerifications.handle, lower), eq(rsiVerifications.status, "pending")))
    .orderBy(sql`created_at DESC`)
    .limit(1);

  if (!pending) return { ok: false, reason: "expired", message: "Start verification again — no active code." };
  if (pending.expiresAt <= new Date()) {
    await db.update(rsiVerifications).set({ status: "expired" }).where(eq(rsiVerifications.id, pending.id));
    return { ok: false, reason: "expired", message: "That code expired. Request a fresh one." };
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "attempts", message: "Too many checks on this code — request a new one." };
  }
  if (
    pending.lastAttemptAt &&
    Date.now() - pending.lastAttemptAt.getTime() < CHECK_COOLDOWN_SECONDS * 1000
  ) {
    return {
      ok: false,
      reason: "cooldown",
      message: `Give RSI a moment — try again in ${CHECK_COOLDOWN_SECONDS} seconds.`,
    };
  }
  if (!(await withinGlobalBudget())) {
    return { ok: false, reason: "budget", message: "Verification is busy right now — try again shortly." };
  }

  await db
    .update(rsiVerifications)
    .set({ attempts: pending.attempts + 1, lastAttemptAt: new Date() })
    .where(eq(rsiVerifications.id, pending.id));

  let html: string;
  try {
    const res = await fetch(`${RSI_PROFILE_BASE}/${encodeURIComponent(lower)}`, {
      redirect: "follow",
      headers: {
        "User-Agent": "KCX/0.1 (Kestrel Commodities Exchange; unofficial Star Citizen fan project)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.status === 404) {
      return { ok: false, reason: "not_found", message: "No RSI profile with that handle." };
    }
    if (!res.ok) {
      return { ok: false, reason: "fetch_failed", message: `RSI returned ${res.status}. Try again shortly.` };
    }
    html = await res.text();
  } catch {
    return { ok: false, reason: "fetch_failed", message: "Couldn't reach RSI just now. Try again shortly." };
  }

  const profile = parseRsiProfile(html, lower);
  if (!bioContainsCode(profile.bio, pending.code)) {
    await db.insert(authEvents).values({ handle: lower, type: "verification_failed", detail: "code_absent" });
    return {
      ok: false,
      reason: "no_code",
      message: "Couldn't find the code in your bio yet. Save your RSI profile, then check again.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(rsiVerifications)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(rsiVerifications.id, pending.id));
    await tx.insert(authEvents).values({ handle: lower, type: "verification_succeeded" });
  });

  return { ok: true, profile };
}

/** True when this handle has a fresh, verified attempt ready to be turned into an account. */
export async function consumeVerified(handle: string): Promise<boolean> {
  const lower = handle.trim().toLowerCase();
  const rows = await getDb().execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM rsi_verifications
    WHERE handle = ${lower} AND status = 'verified'
      AND verified_at > now() - interval '1 hour'
  `);
  return Number(rows.rows[0]?.n ?? 0) > 0;
}
