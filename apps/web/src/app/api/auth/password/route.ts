import { authEvents, getDb, users } from "@kcx/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "@/lib/password";
import { consumeVerificationForReset } from "@/lib/rsi-verify";
import { createSession, currentUser, logAuthEvent } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Password sign-in — the travelling alternative to a passkey.
 *
 * A passkey lives on the device that created it. Enrol one on a desktop and your phone has no
 * way in, which is a dead end for anyone whose main device isn't the one in their pocket. A
 * password is weaker but portable, so it exists alongside passkeys rather than instead of
 * them, and RSI re-verification remains the recovery path for both.
 */

const setInput = z.object({
  action: z.literal("set"),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH).optional(),
});
const loginInput = z.object({
  action: z.literal("login"),
  handle: z.string().min(3).max(60),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
const removeInput = z.object({
  action: z.literal("remove"),
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH),
});
const input = z.discriminatedUnion("action", [setInput, loginInput, removeInput]);

/** Failed attempts tolerated per handle before it's locked out for a while. */
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MINUTES = 15;

async function recentFailures(handle: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<string>`count(*)::text` })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.handle, handle),
        eq(authEvents.type, "login_failed"),
        gt(authEvents.createdAt, new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000)),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();

  // ---------------------------------------------------------------- sign in
  if (parsed.data.action === "login") {
    const handle = parsed.data.handle.trim().toLowerCase();

    if ((await recentFailures(handle)) >= MAX_FAILURES) {
      return NextResponse.json(
        { error: `Too many failed attempts. Wait ${FAILURE_WINDOW_MINUTES} minutes, or verify your RSI handle instead.` },
        { status: 429 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.handle, handle));
    // Run the verify even when the user is missing so a wrong handle and a wrong password
    // take the same time — otherwise this endpoint enumerates who has an account.
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);

    if (!user || !ok) {
      await logAuthEvent("login_failed", { userId: user?.id ?? null, handle, detail: "password" });
      return NextResponse.json({ error: "That handle and password don't match." }, { status: 401 });
    }
    if (user.bannedAt) return NextResponse.json({ error: "Account unavailable." }, { status: 403 });

    await createSession(user.id);
    await logAuthEvent("login", { userId: user.id, handle, detail: "password" });
    return NextResponse.json({
      ok: true,
      user: { id: user.id, handle: user.handle, displayName: user.displayName },
    });
  }

  // ------------------------------------------------------- set / remove
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  /*
   * Changing an existing password needs the old one — the session alone isn't enough, or a
   * borrowed unlocked browser could lock the real owner out.
   *
   * The alternative is a freshly completed RSI verification. That is the reset path: someone
   * who has just re-proved control of the handle's bio has demonstrated MORE than knowing the
   * password, since that same proof is what created the account. The proof is spent on use.
   */
  if (me.passwordHash) {
    const supplied = parsed.data.currentPassword;
    const byPassword = !!supplied && (await verifyPassword(supplied, me.passwordHash));
    if (!byPassword) {
      const byVerification = await consumeVerificationForReset(me.handle);
      if (!byVerification) {
        return NextResponse.json(
          {
            error: supplied
              ? "Current password is wrong."
              : "Enter your current password, or verify your RSI handle again to reset it.",
            canResetViaRsi: true,
          },
          { status: 403 },
        );
      }
      await logAuthEvent("password_set", { userId: me.id, handle: me.handle, detail: "reset_via_rsi" });
    }
  }

  if (parsed.data.action === "remove") {
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, me.id));
    await logAuthEvent("password_removed", { userId: me.id, handle: me.handle });
    return NextResponse.json({ ok: true, hasPassword: false });
  }

  const strength = checkPasswordStrength(parsed.data.password, me.handle);
  if (!strength.ok) return NextResponse.json({ error: strength.message }, { status: 400 });

  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, me.id));
  await logAuthEvent("password_set", { userId: me.id, handle: me.handle });
  return NextResponse.json({ ok: true, hasPassword: true });
}

/** Whether the signed-in trader has a password set — drives the account UI. */
export async function GET() {
  const me = await currentUser();
  return NextResponse.json({
    hasPassword: !!me?.passwordHash,
    minLength: MIN_PASSWORD_LENGTH,
  });
}
