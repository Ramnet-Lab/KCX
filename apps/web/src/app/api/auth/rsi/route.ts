import { getDb, syncMembershipFromProfile, users } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkVerification, startVerification } from "@/lib/rsi-verify";
import { createSession, currentUser, logAuthEvent } from "@/lib/session";

export const dynamic = "force-dynamic";

const startInput = z.object({ action: z.literal("start"), handle: z.string().min(3).max(60) });
const checkInput = z.object({ action: z.literal("check"), handle: z.string().min(3).max(60) });
const input = z.discriminatedUnion("action", [startInput, checkInput]);

/**
 * RSI ownership verification.
 *
 * `start` issues a code to paste into the RSI profile bio; `check` reads the public profile and
 * confirms it. A successful check either creates the account and signs the trader in (signup),
 * or re-verifies an existing account (recovery / periodic re-check).
 */
export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const signedIn = await currentUser();

  if (parsed.data.action === "start") {
    const result = await startVerification(parsed.data.handle, signedIn?.id ?? null);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
    return NextResponse.json({ code: result.code, expiresAt: result.expiresAt.toISOString() });
  }

  const outcome = await checkVerification(parsed.data.handle);
  if (!outcome.ok) {
    const status = outcome.reason === "cooldown" || outcome.reason === "budget" ? 429 : 409;
    return NextResponse.json({ error: outcome.message, reason: outcome.reason }, { status });
  }

  const db = getDb();
  const handle = outcome.profile.handle.toLowerCase();
  const profileFields = {
    displayName: outcome.profile.displayName ?? handle,
    isVerified: true,
    rsiVerifiedAt: new Date(),
    enlistedAt: outcome.profile.enlistedAt,
    citizenRecord: outcome.profile.citizenRecord,
    mainOrgSid: outcome.profile.mainOrgSid,
    avatarUrl: outcome.profile.avatarUrl,
  };

  const [existing] = await db.select().from(users).where(eq(users.handle, handle));
  let userId: string;

  if (existing) {
    if (signedIn && signedIn.id !== existing.id) {
      return NextResponse.json({ error: "That handle belongs to another KCX account." }, { status: 409 });
    }
    await db.update(users).set(profileFields).where(eq(users.id, existing.id));
    userId = existing.id;
  } else if (signedIn) {
    // Signed-in trader claiming their handle for the first time.
    await db.update(users).set({ handle, ...profileFields }).where(eq(users.id, signedIn.id));
    userId = signedIn.id;
  } else {
    const [created] = await db.insert(users).values({ handle, ...profileFields }).returning();
    userId = created!.id;
    await logAuthEvent("account_created", { userId, handle });
  }

  /*
   * Org membership is DERIVED, and this is the only place it changes.
   *
   * Nobody joins or leaves an org on KCX — they do it on RSI, and we read it here. That
   * also refreshes their rank (which is what makes the star ranking a credential rather
   * than a claim) and their authority freshness, so a treasurer who is still in the org
   * keeps spending and one who left quietly stops.
   *
   * Best-effort: a roster that failed to update must never cost someone their sign-in.
   */
  await syncMembershipFromProfile(db, { userId, profile: outcome.profile }).catch((err) =>
    console.error("[rsi:org-sync]", err instanceof Error ? err.message : err),
  );

  // Verification alone signs you in; enrolling a passkey is the next step, not a gate.
  if (!signedIn) {
    await createSession(userId);
    await logAuthEvent("login", { userId, handle, detail: "rsi_verification" });
  }

  return NextResponse.json({
    ok: true,
    isNewAccount: !existing && !signedIn,
    user: {
      id: userId,
      handle,
      displayName: profileFields.displayName,
      isVerified: true,
      enlistedAt: profileFields.enlistedAt?.toISOString() ?? null,
      citizenRecord: profileFields.citizenRecord,
      mainOrgSid: profileFields.mainOrgSid,
    },
  });
}
