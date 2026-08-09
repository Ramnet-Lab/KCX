import { getDb, users } from "@kcx/db";
import { eq, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { IMPERSONATE_COOKIE, actualUser, logAuthEvent } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Standing in as another trader.
 *
 * The admin's tool for "what does this person actually see", which is the question behind
 * most support and nearly every bug report. It is a cookie naming a user id and nothing
 * else: `currentUser` swaps in that account wholesale, so the site behaves for the admin
 * exactly as it behaves for them, down to losing admin rights for the duration.
 *
 * Guarded on `actualUser`, never `currentUser`. While impersonation is live the request
 * looks like an ordinary trader, so asking the impersonation-aware helper whether the caller
 * may impersonate would refuse to let them stop.
 */
const input = z.object({
  /** Either identifier — an admin usually has the handle, not the row. */
  userId: z.string().uuid().optional(),
  handle: z.string().trim().min(1).max(60).optional(),
});

export async function POST(request: Request) {
  const admin = await actualUser();
  if (!admin) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (admin.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.userId && !parsed.data.handle)) {
    return NextResponse.json({ error: "Name a trader" }, { status: 400 });
  }

  try {
    const handle = parsed.data.handle?.toLowerCase().replace(/^@/, "");
    const [target] = await getDb()
      .select({ id: users.id, handle: users.handle, displayName: users.displayName })
      .from(users)
      .where(
        parsed.data.userId
          ? eq(users.id, parsed.data.userId)
          : or(eq(users.handle, handle!), sql`lower(${users.displayName}) = ${handle}`)!,
      )
      .limit(1);
    if (!target) return NextResponse.json({ error: "No account with that handle" }, { status: 404 });
    if (target.id === admin.id) return NextResponse.json({ error: "That's you." }, { status: 400 });

    const jar = await cookies();
    jar.set(IMPERSONATE_COOKIE, target.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Session-scoped on purpose: closing the browser drops it. Standing in as somebody is
      // a thing you do for a few minutes, and one that should never quietly outlive the task.
    });
    await logAuthEvent("impersonation_started", {
      userId: admin.id,
      handle: target.handle,
      detail: `as ${target.handle}`,
    });
    return NextResponse.json({ ok: true, handle: target.handle, displayName: target.displayName });
  } catch (err) {
    console.error("[admin:impersonate]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not switch" }, { status: 500 });
  }
}

/** Step back out. Available to the real admin whatever the impersonated account may be. */
export async function DELETE() {
  const admin = await actualUser();
  if (!admin) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const jar = await cookies();
  const was = jar.get(IMPERSONATE_COOKIE)?.value ?? null;
  jar.delete(IMPERSONATE_COOKIE);
  if (was) await logAuthEvent("impersonation_ended", { userId: admin.id, detail: was });
  return NextResponse.json({ ok: true });
}
