import { authEvents, authSessions, getDb, users } from "@kcx/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

export const SESSION_COOKIE = "kcx_session";
const SESSION_DAYS = 30;
/** Refresh `lastSeenAt` at most once an hour — a write per request is pointless load. */
const TOUCH_INTERVAL_MS = 3_600_000;

export type SessionUser = typeof users.$inferSelect;

/** Cookies carry a random token; only its hash is stored, so a DB leak yields no live sessions. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT ?? "kcx-dev-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Issue a session and set the cookie. Returns the raw token (never stored). */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await getDb().insert(authSessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    ipHash: hashIp(ip),
    userAgent: hdrs.get("user-agent")?.slice(0, 300) ?? null,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb()
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, hashToken(token)))
      .catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * The signed-in trader, or null.
 *
 * Also honours the dev sign-in stub when ALLOW_DEV_LOGIN is on and we're not in production —
 * that path disappears once real accounts are in use everywhere.
 */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const db = getDb();

    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) {
      const [row] = await db
        .select({ user: users, lastSeenAt: authSessions.lastSeenAt })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(and(eq(authSessions.tokenHash, hashToken(token)), gt(authSessions.expiresAt, new Date())));
      if (row?.user && !row.user.bannedAt) {
        if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
          await db
            .update(authSessions)
            .set({ lastSeenAt: new Date() })
            .where(eq(authSessions.tokenHash, hashToken(token)))
            .catch(() => {});
        }
        return row.user;
      }
    }

    if (devLoginEnabled()) {
      const devId = jar.get("kcx_uid")?.value;
      if (devId && /^[0-9a-f-]{36}$/i.test(devId)) {
        const [user] = await db.select().from(users).where(eq(users.id, devId));
        if (user && !user.bannedAt) return user;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function devLoginEnabled(): boolean {
  return process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
}

/** Purge expired sessions (called opportunistically; also safe to schedule). */
export async function pruneSessions(): Promise<void> {
  await getDb().execute(sql`DELETE FROM auth_sessions WHERE expires_at < now()`);
}

export async function logAuthEvent(
  type: (typeof authEvents.$inferInsert)["type"],
  opts: { userId?: string | null; handle?: string | null; detail?: string } = {},
): Promise<void> {
  const hdrs = await headers().catch(() => null);
  const ip = hdrs?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await getDb()
    .insert(authEvents)
    .values({
      userId: opts.userId ?? null,
      handle: opts.handle ?? null,
      type,
      detail: opts.detail ?? null,
      ipHash: hashIp(ip),
    })
    .catch(() => {});
}
