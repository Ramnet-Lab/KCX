import { BAN_DURATIONS, banUserByHandle, getDb, listUsersForMod, setUserBanned, setUserRole } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMod } from "@/lib/require-mod";

export const dynamic = "force-dynamic";

const banInput = z.object({
  action: z.literal("ban"),
  /** Either identifier works: moderators often have the name, not the row. */
  userId: z.string().uuid().optional(),
  handle: z.string().trim().min(3).max(60).optional(),
  duration: z.enum(BAN_DURATIONS),
  reason: z.string().trim().max(1000).optional(),
});
const unbanInput = z.object({
  action: z.literal("unban"),
  userId: z.string().uuid().optional(),
  handle: z.string().trim().min(3).max(60).optional(),
  reason: z.string().trim().max(1000).optional(),
});
const roleInput = z.object({
  action: z.literal("set_role"),
  userId: z.string().uuid(),
  role: z.enum(["user", "mod", "admin"]),
  reason: z.string().trim().max(1000).optional(),
});
const input = z.discriminatedUnion("action", [banInput, unbanInput, roleInput]);

export async function GET(request: Request) {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  const search = new URL(request.url).searchParams.get("q");
  try {
    return NextResponse.json({ users: await listUsersForMod(getDb(), search) });
  } catch (err) {
    console.error("[admin:users]", err instanceof Error ? err.message : err);
    return NextResponse.json({ users: [], error: "Unavailable" }, { status: 503 });
  }
}

/**
 * POST — ban, reinstate, or change someone's role.
 *
 * Handing out moderator is admin-only: a mod who can appoint mods can quietly grow their own
 * faction, which is not a power the role is meant to carry.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  // Bans are moderator work; handing out roles is not.
  const gate = await requireMod({ adminOnly: parsed.data.action === "set_role" });
  if (gate.response) return gate.response;

  try {
    const db = getDb();
    let result: Awaited<ReturnType<typeof setUserBanned>>;

    if (parsed.data.action === "set_role") {
      result = await setUserRole(db, {
        moderatorId: gate.user.id,
        userId: parsed.data.userId,
        role: parsed.data.role,
        reason: parsed.data.reason,
      });
    } else {
      const duration = parsed.data.action === "ban" ? parsed.data.duration : null;
      if (!parsed.data.userId && !parsed.data.handle) {
        return NextResponse.json({ error: "Give a handle or a user id" }, { status: 400 });
      }
      result = parsed.data.userId
        ? await setUserBanned(db, {
            moderatorId: gate.user.id,
            userId: parsed.data.userId,
            duration,
            reason: parsed.data.reason,
          })
        : await banUserByHandle(db, {
            moderatorId: gate.user.id,
            handle: parsed.data.handle!,
            duration,
            reason: parsed.data.reason,
          });
    }

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:user-action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
