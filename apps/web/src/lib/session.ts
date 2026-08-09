import { authEvents, authSessions, getDb, isBanned, users } from "@kcx/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

export const SESSION_COOKIE = "kcx_session";
/**
 * Who an admin is currently standing in as.
 *
 * A second cookie rather than a second session, and only ever honoured when the REAL session
 * belongs to an admin — so setting it by hand gets an ordinary trader precisely nothing. It
 * carries a user id, never a privilege: `currentUser` returns the target verbatim, which
 * means an admin impersonating an ordinary trader also *loses* their own admin rights for
 * the duration. Every `role === "admin"` test in the app therefore fails closed while it is
 * set, which is the behaviour you want from a feature whose whole purpose is to see the site
 * exactly as somebody else sees it.
 */
export const IMPERSONATE_COOKIE = "kcx_impersonate";
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
/**
 * The account actually signed in, ignoring any impersonation.
 *
 * Anything that grants or revokes the power to impersonate must use THIS, never currentUser:
 * an admin standing in as a trader looks like that trader, so asking currentUser whether the
 * caller may stop impersonating would answer no and strand them there.
 */
export async function actualUser(): Promise<SessionUser | null> {
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
      if (row?.user && !isBanned(row.user)) {
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
        if (user && !isBanned(user)) return user;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Who the app should treat this request as — the impersonated trader when an admin has
 * stepped into someone's shoes, otherwise the signed-in account.
 *
 * Every page and endpoint already calls this, which is the point: acting as somebody has to
 * mean acting as them everywhere, and threading an "on behalf of" parameter through several
 * dozen call sites would leave whichever ones we missed quietly acting as the admin.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const actual = await actualUser();
  if (!actual || actual.role !== "admin") return actual;

  try {
    const jar = await cookies();
    const target = jar.get(IMPERSONATE_COOKIE)?.value;
    if (!target || !/^[0-9a-f-]{36}$/i.test(target) || target === actual.id) return actual;
    const [user] = await getDb().select().from(users).where(eq(users.id, target));
    // A banned account is deliberately still viewable: "why is this person seeing an error"
    // is one of the questions this exists to answer.
    return user ?? actual;
  } catch {
    return actual;
  }
}

/** The banner's data: who you are, who you're acting as, and whether that's happening. */
export async function sessionContext(): Promise<{
  user: SessionUser | null;
  actual: SessionUser | null;
  impersonating: boolean;
}> {
  const [actual, user] = await Promise.all([actualUser(), currentUser()]);
  return { user, actual, impersonating: !!actual && !!user && actual.id !== user.id };
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
