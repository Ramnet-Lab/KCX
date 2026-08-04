import {
  getDb,
  getOrg,
  listOrgMembers,
  listOrgProposals,
  modSetOrgLeadership,
  modSetOrgSuspended,
  orgStanding,
  setOrgBoardRules,
  setOrgMemberRole,
  setOrgTreasury,
  transferOrgLeadership,
  users,
} from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkOrgClaim, startOrgClaim } from "@/lib/org-verify";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — the org, its roster, its board proposals and its trading record. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  try {
    const db = getDb();
    const org = await getOrg(db, id, user?.id ?? null);
    if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isMember = org.myRole != null;
    const isMod = user?.role === "mod" || user?.role === "admin";
    const [members, standing, proposals] = await Promise.all([
      isMember || isMod ? listOrgMembers(db, id) : Promise.resolve([]),
      orgStanding(db, id),
      isMember || isMod ? listOrgProposals(db, id, user?.id ?? null) : Promise.resolve([]),
    ]);

    // The treasury and the roster are for members. How much an org has, and who can spend
    // it, is not something the whole board needs to see.
    return NextResponse.json({
      org: isMember || isMod ? org : { ...org, treasury: 0, mySpendLimit: null },
      members,
      proposals,
      standing,
    });
  } catch (err) {
    console.error("[orgs:get]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}

const action = z.discriminatedUnion("action", [
  /** Leadership, proven through the org's own RSI charter. */
  z.object({ action: z.literal("claim_start") }),
  z.object({ action: z.literal("claim_check") }),
  z.object({ action: z.literal("transfer"), userId: z.uuid() }),
  /** The president's controls. */
  z.object({
    action: z.literal("set_member"),
    userId: z.uuid(),
    role: z.enum(["treasurer", "member"]).optional(),
    isBoardMember: z.boolean().optional(),
    spendLimit: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  }),
  z.object({
    action: z.literal("set_board"),
    threshold: z.number().int().min(0).max(10),
    minValue: z.number().int().min(0).max(100_000_000_000),
  }),
  z.object({ action: z.literal("set_treasury"), treasury: z.number().int().min(0).max(100_000_000_000) }),
  /** Moderator override — the escape hatch for disputes and compromised accounts. */
  z.object({ action: z.literal("mod_leadership"), userId: z.uuid().nullable(), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("mod_suspend"), suspended: z.boolean(), reason: z.string().max(500).optional() }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const input = parsed.data;
  const db = getDb();
  const isMod = user.role === "mod" || user.role === "admin";

  try {
    switch (input.action) {
      case "claim_start": {
        if (!user.isVerified) {
          return NextResponse.json({ error: "Verify your RSI handle first" }, { status: 403 });
        }
        const result = await startOrgClaim(id, user.id);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true, code: result.code });
      }

      case "claim_check": {
        const org = await getOrg(db, id, user.id);
        if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const outcome = await checkOrgClaim(id, org.sid);
        if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case "transfer": {
        const result = await transferOrgLeadership(db, { orgId: id, actorId: user.id, toUserId: input.userId });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case "set_member": {
        const result = await setOrgMemberRole(db, {
          orgId: id,
          actorId: user.id,
          userId: input.userId,
          role: input.role,
          isBoardMember: input.isBoardMember,
          spendLimit: input.spendLimit,
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case "set_board": {
        const result = await setOrgBoardRules(db, {
          orgId: id,
          actorId: user.id,
          threshold: input.threshold,
          minValue: input.minValue,
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case "set_treasury": {
        const result = await setOrgTreasury(db, { orgId: id, actorId: user.id, treasury: input.treasury });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case "mod_leadership": {
        if (!isMod) return NextResponse.json({ error: "Moderators only" }, { status: 403 });
        const result = await modSetOrgLeadership(db, {
          orgId: id,
          moderatorId: user.id,
          userId: input.userId,
          reason: input.reason ?? null,
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case "mod_suspend": {
        if (!isMod) return NextResponse.json({ error: "Moderators only" }, { status: 403 });
        const result = await modSetOrgSuspended(db, {
          orgId: id,
          moderatorId: user.id,
          suspended: input.suspended,
          reason: input.reason ?? null,
        });
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (err) {
    console.error("[orgs:action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

/** Resolve a handle to a user id, so an officer can act on someone by the name they know. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const handle = new URL(request.url).searchParams.get("handle")?.trim().toLowerCase();
  if (!handle) return NextResponse.json({ error: "No handle given" }, { status: 400 });
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.handle, handle));
  if (!row) return NextResponse.json({ error: `No KCX account for @${handle}` }, { status: 404 });
  return NextResponse.json({ userId: row.id });
}
