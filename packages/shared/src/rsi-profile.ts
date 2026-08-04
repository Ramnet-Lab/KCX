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

/** `<span class="label">X</span> <strong class="value">Y</strong>` → Y */
function labelledValue(html: string, label: string): string | null {
  const re = new RegExp(
    `<span[^>]*class="label"[^>]*>\\s*${label}\\s*</span>\\s*<strong[^>]*class="value"[^>]*>([\\s\\S]*?)</strong>`,
    "i",
  );
  const m = html.match(re);
  return m?.[1] ? stripTags(m[1]) || null : null;
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
  const avatarMatch = html.match(
    /<div[^>]*class="thumb"[^>]*>\s*<img[^>]*src="(https:\/\/[^"]*robertsspaceindustries[^"]*)"/i,
  );

  return {
    handle: labelledValue(html, "Handle name") ?? requestedHandle,
    displayName: labelledValue(html, "Handle name"),
    bio: bioMatch?.[1] ? stripTags(bioMatch[1]) || null : null,
    enlistedAt: enlisted && !Number.isNaN(enlisted.getTime()) ? enlisted : null,
    citizenRecord: recordMatch?.[1] ?? null,
    mainOrgSid: orgMatch?.[1] ?? null,
    avatarUrl: avatarMatch?.[1] ?? null,
  };
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
