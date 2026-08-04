/**
 * Reader for public RSI citizen profiles.
 *
 * Parsers over someone else's HTML are inherently brittle, so this is deliberately written
 * to degrade rather than explode: every field is independently optional, and a markup change
 * costs us that one field instead of the whole verification. Selectors were taken from the
 * live page (verified 2026-08-03).
 *
 * Etiquette: fetches are user-initiated only, one profile at a time, heavily rate-limited and
 * cached upstream — never crawled. RSI's ToS frowns on automated access, and the community
 * norm (which SC Market and others follow) is exactly this: sparse, deliberate, honest UA.
 */

export type RsiProfile = {
  handle: string;
  displayName: string | null;
  bio: string | null;
  enlistedAt: Date | null;
  citizenRecord: string | null;
  mainOrgSid: string | null;
  avatarUrl: string | null;
  /** Display name of the main org, e.g. "Maikoh Company". */
  mainOrgName: string | null;
  /**
   * The org's own name for this rank, e.g. "Alpha". Free text chosen by the org, so it
   * means nothing across orgs and is shown rather than compared.
   */
  mainOrgRank: string | null;
  /**
   * Rank as RSI's own 0–5 star scale. Unlike the rank NAME this is structural, and it is
   * set by the org's leadership rather than by the member — which is what makes it usable
   * as a credential. Compared only WITHIN one org: plenty of orgs give everyone five.
   */
  mainOrgRankStars: number | null;
  /** RSI's org logo path. Cached locally on verification rather than hotlinked. */
  mainOrgLogoUrl: string | null;
  /**
   * Whether the profile actually shows the org.
   *
   * RSI lets a member redact or hide their affiliation. "redacted" means there IS an org we
   * are not being shown — materially different from having none, and worth distinguishing
   * so a redacted member isn't silently treated as org-less.
   */
  mainOrgVisibility: "visible" | "redacted" | "none";
};

export const RSI_PROFILE_BASE = "https://robertsspaceindustries.com/citizens";

/** Handles are alphanumeric + underscore; anything else is a bad request, not a fetch. */
export const RSI_HANDLE_RE = /^[A-Za-z0-9_-]{3,60}$/;

const stripTags = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

/**
 * `<span class="label">X</span> <strong class="value">Y</strong>` → Y
 *
 * The class match is prefix-anchored rather than exact: RSI suffixes these with layout
 * classes on some entries (`class="label data1"`, `class="value data2"`) and not others.
 * Requiring an exact `class="label"` silently returned null for exactly those fields —
 * which is how the org rank read as absent on a profile that plainly showed one.
 */
function labelledValue(html: string, label: string): string | null {
  const re = new RegExp(
    `<span[^>]*class="label[^"]*"[^>]*>\\s*${label}\\s*</span>\\s*<strong[^>]*class="value[^"]*"[^>]*>([\\s\\S]*?)</strong>`,
    "i",
  );
  return firstGroup(html, re);
}

export function parseRsiProfile(html: string, requestedHandle: string): RsiProfile {
  // Bio uses a <div class="value"> rather than <strong>, and may be absent entirely.
  const bioMatch = html.match(
    /<div[^>]*class="entry bio"[^>]*>\s*<span[^>]*class="label"[^>]*>\s*Bio\s*<\/span>\s*<div[^>]*class="value"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const enlistedRaw = labelledValue(html, "Enlisted");
  const enlisted = enlistedRaw ? new Date(enlistedRaw) : null;

  const recordMatch = html.match(
    /class="entry citizen-record"[\s\S]*?<strong[^>]*class="value"[^>]*>\s*#?([0-9]+)\s*<\/strong>/i,
  );
  const orgMatch = html.match(/class="main-org[^"]*"[\s\S]*?href="\/orgs\/([A-Za-z0-9_-]+)"/i);
  // RSI serves media as SITE-RELATIVE paths. The original pattern demanded an absolute
  // https URL, so it matched nothing and every avatar came back null without any error.
  const avatarMatch = html.match(/<div[^>]*class="thumb"[^>]*>\s*<img[^>]*src="([^"]+)"/i);

  // Everything org-related is read from inside the main-org block only. Scanning the whole
  // page would pick up the affiliate-org list further down, and quietly reporting an
  // affiliate as someone's main org is the kind of error nobody would ever notice.
  const orgBlock = html.match(/<div[^>]*class="main-org[^"]*"[\s\S]*?(?=<div[^>]*class="(?:orgs|affiliation)|<\/main>|$)/i)?.[0] ?? "";
  const visibilityFlag = orgBlock.match(/class="main-org[^"]*visibility-([A-Z])/i)?.[1]?.toUpperCase() ?? null;
  const orgSid = orgMatch?.[1] ?? null;

  return {
    handle: labelledValue(html, "Handle name") ?? requestedHandle,
    displayName: labelledValue(html, "Handle name"),
    bio: bioMatch?.[1] ? stripTags(bioMatch[1]) || null : null,
    enlistedAt: enlisted && !Number.isNaN(enlisted.getTime()) ? enlisted : null,
    citizenRecord: recordMatch?.[1] ?? null,
    mainOrgSid: orgSid,
    avatarUrl: absoluteRsiUrl(avatarMatch?.[1] ?? null),
    mainOrgName: firstGroup(orgBlock, /href="\/orgs\/[A-Za-z0-9_-]+"[^>]*class="value[^"]*"[^>]*>([\s\S]*?)<\/a>/i),
    mainOrgRank: labelledValue(orgBlock, "Organization rank"),
    mainOrgRankStars: parseRankStars(orgBlock),
    mainOrgLogoUrl: absoluteRsiUrl(orgBlock.match(/<a[^>]*href="\/orgs\/[^"]*"><img[^>]*src="([^"]+)"/i)?.[1] ?? null),
    // A visible block carries the SID; anything else means RSI is withholding it. `R` is
    // RSI's redacted flag, but treat any non-visible flag WITH no SID the same way rather
    // than enumerating letters we haven't seen.
    mainOrgVisibility: orgSid ? "visible" : visibilityFlag && visibilityFlag !== "V" ? "redacted" : "none",
  };
}

/** First capture group, tags stripped — null when absent or empty after stripping. */
function firstGroup(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1] ? stripTags(m[1]) || null : null;
}

/**
 * Rank as a 0–5 star count.
 *
 * The markup is five sibling spans, the filled ones carrying `class="active"`. Counting
 * `active` rather than reading a number because RSI never prints the number.
 */
function parseRankStars(orgBlock: string): number | null {
  const ranking = orgBlock.match(/<div[^>]*class="ranking[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!ranking) return null;
  return (ranking.match(/<span class="active">/g) ?? []).length;
}

/** RSI serves media as site-relative paths; store something fetchable. */
function absoluteRsiUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `https://robertsspaceindustries.com${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Codes avoid characters that are easy to mistype or confuse (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateVerificationCode(random: (max: number) => number): string {
  // caller supplies a CSPRNG (node:crypto randomInt)
  let body = "";
  for (let i = 0; i < 6; i++) body += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return `KCX-${body.slice(0, 3)}-${body.slice(3)}`;
}

/** Bio text is free-form; match the code anywhere, case-insensitively, ignoring whitespace. */
export function bioContainsCode(bio: string | null, code: string): boolean {
  if (!bio) return false;
  const normalise = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  return normalise(bio).includes(normalise(code));
}
