import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { users } from "../schema/orders";

/**
 * Ban state, in one place.
 *
 * A ban has a start and an optional end, so "is this account banned" is a comparison against
 * the clock, not a null check. Six places enforce bans — sign-in, session lookup, passkey
 * login, password login, the bootstrap promotion, the mod console — and if any one of them
 * tested `bannedAt` alone, a served 24-hour ban would silently become permanent there.
 *
 * So: nothing tests the columns directly. Everything routes through these.
 */

export const BAN_DURATIONS = ["24h", "7d", "permanent"] as const;
export type BanDuration = (typeof BAN_DURATIONS)[number];

export const BAN_DURATION_LABELS: Record<BanDuration, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  permanent: "Permanent",
};

/** Milliseconds a duration runs for; null for a ban that never lifts. */
export function banDurationMs(duration: BanDuration): number | null {
  switch (duration) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

export type BannableUser = { bannedAt: Date | string | null; bannedUntil: Date | string | null };

/** True while a ban is in force. The only correct way to ask. */
export function isBanned(user: BannableUser | null | undefined, now: Date = new Date()): boolean {
  if (!user?.bannedAt) return false;
  if (!user.bannedUntil) return true; // permanent
  return new Date(user.bannedUntil).getTime() > now.getTime();
}

/** How a live ban should be described to a moderator; null when not banned. */
export function banSummary(user: BannableUser | null | undefined): string | null {
  if (!isBanned(user)) return null;
  if (!user!.bannedUntil) return "permanent";
  const until = new Date(user!.bannedUntil);
  const hours = Math.max(1, Math.round((until.getTime() - Date.now()) / 3_600_000));
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

/** SQL predicate matching accounts currently under a ban. */
export const ACTIVE_BAN = sql`(${users.bannedAt} IS NOT NULL AND (${users.bannedUntil} IS NULL OR ${users.bannedUntil} > now()))`;

/**
 * Clear bans that have run their course.
 *
 * Cosmetic rather than load-bearing — `isBanned` already treats an elapsed ban as lifted —
 * but it keeps the moderator console honest and stops served bans lingering in the data as
 * if they were still in force.
 */
export async function liftExpiredBans(db: Db): Promise<number> {
  const lifted = await db
    .update(users)
    .set({ bannedAt: null, bannedUntil: null })
    .where(sql`${users.bannedUntil} IS NOT NULL AND ${users.bannedUntil} <= now()`)
    .returning({ id: users.id });
  return lifted.length;
}
