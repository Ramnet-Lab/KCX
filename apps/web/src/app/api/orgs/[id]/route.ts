import { getDb, getOrg, listOrgMembers, orgStanding, removeOrgMember, setOrgMember, setOrgTreasury, users } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — the org, its roster, and its trading record. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  try {
    const db = getDb();
    const org = await getOrg(db, id, user?.id ?? null);
    if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [members, standing] = await Promise.all([listOrgMembers(db, id), orgStanding(db, id)]);
    // The roster and the treasury are for members only: who can spend an org's money, and
    // how much of it there is, is not something the whole board needs.
    const isMember = org.myRole != null;
    return NextResponse.json({
      org: isMember ? org : { ...org, treasury: 0, mySpendLimit: null },
      members: isMember ? members : [],
      standing,
    });
  } catch (err) {
    console.error("[orgs:get]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}

const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_member"),
    /** RSI handle, so an officer adds someone by the name they actually know. */
    handle: z.string().trim().min(2).max(60),
    role: z.enum(["owner", "officer", "trader", "member"]).optional(),
    spendLimit: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  }),
  z.object({ action: z.literal("remove_member"), userId: z.uuid() }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("set_treasury"), treasury: z.number().int().min(0).max(100_000_000_000) }),
]);

/** PATCH — membership, roles, delegated limits, and the declared treasury. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const input = parsed.data;

  try {
    const db = getDb();
    if (input.action === "set_treasury") {
      const result = await setOrgTreasury(db, { orgId: id, actorId: user.id, treasury: input.treasury });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (input.action === "set_member") {
      const [target] = await db.select({ id: users.id }).from(users).where(eq(users.handle, input.handle.toLowerCase()));
      if (!target) {
        return NextResponse.json({ error: `No KCX account for @${input.handle} — they need to sign up first.` }, { status: 404 });
      }
      const result = await setOrgMember(db, {
        orgId: id,
        actorId: user.id,
        userId: target.id,
        role: input.role,
        spendLimit: input.spendLimit,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    const targetId = input.action === "leave" ? user.id : input.userId;
    const result = await removeOrgMember(db, { orgId: id, actorId: user.id, userId: targetId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[orgs:action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
