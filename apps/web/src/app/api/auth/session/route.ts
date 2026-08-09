import { getDb, unreadMessageCount } from "@kcx/db";
import { NextResponse } from "next/server";
import { currentUser, destroySession, devLoginEnabled, logAuthEvent, sessionContext } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Current session — used by client components to render sign-in state.
 *
 * The unread count rides along rather than getting its own request: the header needs it on
 * every page, and this call already happens on every page. A failed count never costs
 * anyone their sign-in state — it degrades to zero.
 */
export async function GET() {
  const { user, actual, impersonating } = await sessionContext();
  const unreadMessages = user ? await unreadMessageCount(getDb(), user.id).catch(() => 0) : 0;
  return NextResponse.json({
    devLoginEnabled: devLoginEnabled(),
    unreadMessages,
    // Rides along for the same reason the unread count does: the banner has to appear on
    // every page, and this call already happens on every page.
    impersonating,
    actualHandle: impersonating ? (actual?.handle ?? null) : null,
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
