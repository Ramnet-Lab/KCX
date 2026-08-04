import { getDb, users } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, currentUser, destroySession, devLoginEnabled } from "@/lib/session";

/**
 * DEV-ONLY identity stub so the order board is usable before auth lands (M5).
 * Gated on ALLOW_DEV_LOGIN=true AND non-production — this whole file is deleted when
 * Discord OAuth + RSI verification ship.
 */

const input = z.object({ handle: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/) });

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({
    devLoginEnabled: devLoginEnabled(),
    user: user
      ? { id: user.id, handle: user.handle, displayName: user.displayName, isVerified: user.isVerified }
      : null,
  });
}

export async function POST(request: Request) {
  if (!devLoginEnabled()) {
    return NextResponse.json({ error: "Dev login is disabled" }, { status: 403 });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Handle must be 2–32 chars: letters, numbers, _ or -" }, { status: 400 });
  }

  const handle = parsed.data.handle.toLowerCase();
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.handle, handle));
  const user =
    existing ??
    (
      await db
        .insert(users)
        .values({ handle, displayName: parsed.data.handle, isVerified: true })
        .returning()
    )[0]!;

  // Issue a REAL session rather than a parallel cookie scheme: the dev stub previously
  // wrote the raw user id into the session cookie, which currentUser() (expecting a hashed
  // token) rejected outright — dev sign-in looked successful and authenticated nothing.
  await createSession(user.id);
  return NextResponse.json({
    user: { id: user.id, handle: user.handle, displayName: user.displayName, isVerified: user.isVerified },
  });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ user: null });
}
