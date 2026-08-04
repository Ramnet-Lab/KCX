import { NextResponse } from "next/server";
import { currentUser, destroySession, devLoginEnabled, logAuthEvent } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Current session — used by client components to render sign-in state. */
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({
    devLoginEnabled: devLoginEnabled(),
    user: user
      ? {
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
          isVerified: user.isVerified,
          avatarUrl: user.avatarUrl,
          role: user.role,
        }
      : null,
  });
}

/** Sign out. */
export async function DELETE() {
  const user = await currentUser();
  if (user) await logAuthEvent("logout", { userId: user.id, handle: user.handle });
  await destroySession();
  return NextResponse.json({ user: null });
}
