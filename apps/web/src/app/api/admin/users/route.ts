import { getDb, listUsersForMod, setUserBanned, setUserRole } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMod } from "@/lib/require-mod";

export const dynamic = "force-dynamic";

const banInput = z.object({
  action: z.enum(["ban", "unban"]),
  userId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
});
const roleInput = z.object({
  action: z.enum(["grant_mod", "revoke_mod"]),
  userId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
});
const input = z.discriminatedUnion("action", [banInput, roleInput]);

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
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const isRoleChange = parsed.data.action === "grant_mod" || parsed.data.action === "revoke_mod";
  const gate = await requireMod({ adminOnly: isRoleChange });
  if (gate.response) return gate.response;

  try {
    const db = getDb();
    const result = isRoleChange
      ? await setUserRole(db, {
          moderatorId: gate.user.id,
          userId: parsed.data.userId,
          role: parsed.data.action === "grant_mod" ? "mod" : "user",
          reason: parsed.data.reason,
        })
      : await setUserBanned(db, {
          moderatorId: gate.user.id,
          userId: parsed.data.userId,
          banned: parsed.data.action === "ban",
          reason: parsed.data.reason,
        });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:user-action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
