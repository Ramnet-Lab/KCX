import { getDb, users } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, currentUser, devLoginEnabled } from "@/lib/session";

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

  const res = NextResponse.json({
    user: { id: user.id, handle: user.handle, displayName: user.displayName, isVerified: user.isVerified },
  });
  res.cookies.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ user: null });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
