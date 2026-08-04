import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export type Moderator = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
 * Gate for every moderator surface.
 *
 * Returns either the moderator or a response to send straight back, so a route can't
 * accidentally proceed on a failed check — there is no boolean to forget to test.
 *
 * Anonymous callers get 404 rather than 401: whether an admin area exists at all is not
 * something a stranger needs confirmed.
 */
export async function requireMod(
  opts: { adminOnly?: boolean } = {},
): Promise<{ user: Moderator; response?: never } | { user?: never; response: NextResponse }> {
  const user = await currentUser();
  if (!user) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const isAdmin = user.role === "admin";
  const isMod = isAdmin || user.role === "mod";
  if (!isMod) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (opts.adminOnly && !isAdmin) {
    return { response: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  }
  return { user };
}
