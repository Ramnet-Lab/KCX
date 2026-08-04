import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { ORG_SPENDING_ROLES, orgEvents, orgMembers, orgs } from "../schema/orgs";
import { users } from "../schema/orders";

/**
 * Orgs: membership, treasury, and the question everything else here exists to answer —
 * "may this member commit this much of the org's money right now?"
 *
 * The treasury is self-declared aUEC on exactly the same footing as a personal balance. KCX
 * never holds it. What the exchange enforces is that the org's obligations don't exceed it,
 * and that no single member exceeds the slice they were delegated.
 */

export type OrgRole = (typeof ORG_SPENDING_ROLES)[number] | "member";

export type OrgDto = {
  id: string;
  sid: string;
  name: string;
  description: string | null;
  treasury: number;
  memberCount: number;
  /** Viewer-relative; null when they aren't a member. */
  myRole: string | null;
  mySpendLimit: number | null;
  createdAt: string;
};

export type OrgMemberDto = {
  userId: string;
  handle: string;
  displayName: string;
  role: string;
  spendLimit: number | null;
  /** Of their limit, how much is already committed to live org obligations. */
  committed: number;
  joinedAt: string;
};

export type OrgResult = { ok: true; orgId?: string } | { ok: false; error: string };

/**
 * aUEC an org has already promised.
 *
 * Mirrors COMMITTED_AUEC for a person, over the obligations an org can actually hold: live
 * wanted ads it posted, and sales it is the buyer on that haven't settled. Kept as raw SQL
 * next to the personal version for the same reason that one is — a second copy at a call
 * site is how one consumer ends up undercounting.
 */
export const COMMITTED_ORG_AUEC = (orgId: string) => sql`(
  SELECT
    coalesce((
      SELECT sum(bl.remaining_quantity::bigint * bl.buy_now_price)
      FROM bazaar_listings bl
      WHERE bl.org_id = ${orgId} AND bl.intent = 'buy'
        AND bl.status IN ('active','paused') AND bl.buy_now_price IS NOT NULL
    ), 0)
    +
    coalesce((
      SELECT sum(bs.total_price)
      FROM bazaar_sales bs
      WHERE bs.buyer_org_id = ${orgId} AND bs.status = 'pending'
    ), 0)
)`;

/** The same, narrowed to what ONE member has committed — what their spend limit is checked against. */
export const COMMITTED_BY_MEMBER = (orgId: string, userId: string) => sql`(
  SELECT
    coalesce((
      SELECT sum(bl.remaining_quantity::bigint * bl.buy_now_price)
      FROM bazaar_listings bl
      WHERE bl.org_id = ${orgId} AND bl.seller_id = ${userId} AND bl.intent = 'buy'
        AND bl.status IN ('active','paused') AND bl.buy_now_price IS NOT NULL
    ), 0)
    +
    coalesce((
      SELECT sum(bs.total_price)
      FROM bazaar_sales bs
      WHERE bs.buyer_org_id = ${orgId} AND bs.buyer_id = ${userId} AND bs.status = 'pending'
    ), 0)
)`;

export type OrgSpendCheck = {
  allowed: boolean;
  /** Treasury minus everything the org has already promised. */
  orgAvailable: number;
  /** The member's own remaining headroom, or null when they have no personal cap. */
  memberAvailable: number | null;
  reason: string | null;
};

/**
 * May this member commit `amount` of the org's money?
 *
 * TWO ceilings, both of which have to hold. The org's treasury is the real constraint; the
 * member's spend limit is the delegated slice of it. An org that trusts someone with 10M out
 * of a 200M treasury has said something specific, and enforcing only the treasury would make
 * that limit decorative.
 *
 * Availability is computed from what is COMMITTED, not what has been spent — the same rule
 * as a personal balance, because a promise you can't cover is the thing being prevented.
 */
export async function canSpendOrgFunds(
  db: Db,
  opts: { orgId: string; userId: string; amount: number },
): Promise<OrgSpendCheck> {
  const rows = await db.execute<{
    treasury: string; org_committed: string; role: string | null;
    spend_limit: string | null; member_committed: string;
  }>(sql`
    SELECT o.treasury::text,
           ${COMMITTED_ORG_AUEC(opts.orgId)}::text AS org_committed,
           m.role,
           m.spend_limit::text,
           ${COMMITTED_BY_MEMBER(opts.orgId, opts.userId)}::text AS member_committed
    FROM orgs o
    LEFT JOIN org_members m ON m.org_id = o.id AND m.user_id = ${opts.userId}::uuid
    WHERE o.id = ${opts.orgId}::uuid
  `);
  const r = rows.rows[0];
  if (!r) return { allowed: false, orgAvailable: 0, memberAvailable: null, reason: "That org doesn't exist" };

  if (!r.role) {
    return { allowed: false, orgAvailable: 0, memberAvailable: null, reason: "You're not a member of that org" };
  }
  if (!ORG_SPENDING_ROLES.includes(r.role as (typeof ORG_SPENDING_ROLES)[number])) {
    return {
      allowed: false,
      orgAvailable: 0,
      memberAvailable: null,
      reason: "Your role in that org can't commit its funds",
    };
  }

  const orgAvailable = Math.max(0, Number(r.treasury) - Number(r.org_committed));
  const memberAvailable =
    r.spend_limit != null ? Math.max(0, Number(r.spend_limit) - Number(r.member_committed)) : null;

  if (opts.amount > orgAvailable) {
    return {
      allowed: false,
      orgAvailable,
      memberAvailable,
      reason: `The org has ${orgAvailable.toLocaleString()} aUEC uncommitted; that needs ${opts.amount.toLocaleString()}.`,
    };
  }
  if (memberAvailable != null && opts.amount > memberAvailable) {
    return {
      allowed: false,
      orgAvailable,
      memberAvailable,
      reason: `Your delegated limit leaves you ${memberAvailable.toLocaleString()} aUEC of the org's money; that needs ${opts.amount.toLocaleString()}.`,
    };
  }
  return { allowed: true, orgAvailable, memberAvailable, reason: null };
}

/**
 * Found an org against a real RSI SID.
 *
 * The founder must already have that SID as their main org on their verified RSI profile.
 * Without that check an org here would be a club anyone could invent and name after someone
 * else's fleet — and org standing would be worth nothing, because nothing would connect it
 * to the org people actually know.
 */
export async function createOrg(
  db: Db,
  opts: { sid: string; name: string; description?: string | null; founderId: string },
): Promise<OrgResult> {
  const sid = opts.sid.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(sid)) {
    return { ok: false, error: "An org SID is 3–20 letters and digits, as it appears on RSI." };
  }

  return db.transaction(async (tx) => {
    const [founder] = await tx.select().from(users).where(eq(users.id, opts.founderId));
    if (!founder) return { ok: false as const, error: "Sign in first" };
    if (!founder.rsiVerifiedAt) {
      return { ok: false as const, error: "Verify your RSI handle before founding an org" };
    }
    if ((founder.mainOrgSid ?? "").toUpperCase() !== sid) {
      return {
        ok: false as const,
        error: `Your RSI profile lists ${founder.mainOrgSid ? `${founder.mainOrgSid} as your main org` : "no main org"}. You can only found the org you actually belong to — set it as your main org on RSI and verify again.`,
      };
    }

    const [existing] = await tx.select().from(orgs).where(eq(orgs.sid, sid));
    if (existing) return { ok: false as const, error: `${sid} is already on KCX — ask an officer to add you.` };

    const [org] = await tx
      .insert(orgs)
      .values({ sid, name: opts.name.trim().slice(0, 120), description: opts.description?.trim() || null, foundedById: opts.founderId })
      .returning();
    await tx.insert(orgMembers).values({ orgId: org!.id, userId: opts.founderId, role: "owner" });
    await tx.insert(orgEvents).values({ orgId: org!.id, actorId: opts.founderId, type: "founded", data: { sid } });
    return { ok: true as const, orgId: org!.id };
  });
}

/** Orgs this trader belongs to, with their role and the org's headroom. */
export async function listMyOrgs(db: Db, userId: string): Promise<OrgDto[]> {
  const rows = await db.execute<{
    id: string; sid: string; name: string; description: string | null; treasury: string;
    member_count: number; role: string; spend_limit: string | null; created_at: string | Date;
  }>(sql`
    SELECT o.id::text, o.sid, o.name, o.description, o.treasury::text,
           (SELECT count(*)::int FROM org_members m2 WHERE m2.org_id = o.id) AS member_count,
           m.role, m.spend_limit::text, o.created_at
    FROM orgs o
    JOIN org_members m ON m.org_id = o.id AND m.user_id = ${userId}::uuid
    ORDER BY o.name
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    sid: r.sid,
    name: r.name,
    description: r.description,
    treasury: Number(r.treasury),
    memberCount: r.member_count,
    myRole: r.role,
    mySpendLimit: r.spend_limit != null ? Number(r.spend_limit) : null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function getOrg(db: Db, orgId: string, viewerId?: string | null): Promise<OrgDto | null> {
  const rows = await db.execute<{
    id: string; sid: string; name: string; description: string | null; treasury: string;
    member_count: number; role: string | null; spend_limit: string | null; created_at: string | Date;
  }>(sql`
    SELECT o.id::text, o.sid, o.name, o.description, o.treasury::text,
           (SELECT count(*)::int FROM org_members m2 WHERE m2.org_id = o.id) AS member_count,
           m.role, m.spend_limit::text, o.created_at
    FROM orgs o
    LEFT JOIN org_members m ON m.org_id = o.id
      AND ${viewerId ? sql`m.user_id = ${viewerId}::uuid` : sql`false`}
    WHERE o.id = ${orgId}::uuid
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    sid: r.sid,
    name: r.name,
    description: r.description,
    treasury: Number(r.treasury),
    memberCount: r.member_count,
    myRole: r.role,
    mySpendLimit: r.spend_limit != null ? Number(r.spend_limit) : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Roster, with each member's committed slice so an officer can see where the money went. */
export async function listOrgMembers(db: Db, orgId: string): Promise<OrgMemberDto[]> {
  const rows = await db.execute<{
    user_id: string; handle: string; display_name: string; role: string;
    spend_limit: string | null; committed: string; joined_at: string | Date;
  }>(sql`
    SELECT m.user_id::text, u.handle, u.display_name, m.role, m.spend_limit::text,
           ${sql`(SELECT 0)`}::text AS committed, m.joined_at
    FROM org_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${orgId}::uuid
    ORDER BY array_position(ARRAY['owner','officer','trader','member']::text[], m.role), u.display_name
  `);

  // Per-member commitment is a correlated subquery over two tables; running it inside the
  // roster query would make the roster quadratic in members. A handful of round trips for a
  // page that is read rarely is the better trade.
  const out: OrgMemberDto[] = [];
  for (const r of rows.rows) {
    const c = await db.execute<{ n: string }>(
      sql`SELECT ${COMMITTED_BY_MEMBER(orgId, r.user_id)}::text AS n`,
    );
    out.push({
      userId: r.user_id,
      handle: r.handle,
      displayName: r.display_name,
      role: r.role,
      spendLimit: r.spend_limit != null ? Number(r.spend_limit) : null,
      committed: Number(c.rows[0]?.n ?? 0),
      joinedAt: new Date(r.joined_at).toISOString(),
    });
  }
  return out;
}

/** Add someone, or change what they're allowed to do. Owners and officers only. */
export async function setOrgMember(
  db: Db,
  opts: {
    orgId: string;
    actorId: string;
    userId: string;
    role?: (typeof ORG_SPENDING_ROLES)[number] | "member";
    spendLimit?: number | null;
  },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.actorId)));
    if (!actor || (actor.role !== "owner" && actor.role !== "officer")) {
      return { ok: false as const, error: "Only an owner or officer can manage members" };
    }

    const [target] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.userId)));

    // An officer must not be able to promote themselves past the people who appointed them,
    // nor demote an owner out of the way first.
    if (actor.role === "officer") {
      if (target?.role === "owner") return { ok: false as const, error: "Only an owner can change an owner" };
      if (opts.role === "owner") return { ok: false as const, error: "Only an owner can appoint an owner" };
    }

    const now = new Date();
    if (target) {
      await tx
        .update(orgMembers)
        .set({
          role: opts.role ?? target.role,
          spendLimit: opts.spendLimit !== undefined ? opts.spendLimit : target.spendLimit,
        })
        .where(eq(orgMembers.id, target.id));
      await tx.insert(orgEvents).values({
        orgId: opts.orgId,
        actorId: opts.actorId,
        subjectId: opts.userId,
        type: opts.role && opts.role !== target.role ? "role_changed" : "limit_changed",
        data: { role: opts.role ?? target.role, spendLimit: opts.spendLimit ?? target.spendLimit },
      });
    } else {
      await tx.insert(orgMembers).values({
        orgId: opts.orgId,
        userId: opts.userId,
        role: opts.role ?? "member",
        spendLimit: opts.spendLimit ?? null,
        invitedById: opts.actorId,
      });
      await tx.insert(orgEvents).values({
        orgId: opts.orgId,
        actorId: opts.actorId,
        subjectId: opts.userId,
        type: "member_joined",
        data: { role: opts.role ?? "member" },
      });
    }
    void now;
    return { ok: true as const, orgId: opts.orgId };
  });
}

/** Remove a member. An org must never be left with nobody able to run it. */
export async function removeOrgMember(
  db: Db,
  opts: { orgId: string; actorId: string; userId: string },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.actorId)));
    const leaving = opts.actorId === opts.userId;
    if (!actor) return { ok: false as const, error: "You're not in that org" };
    if (!leaving && actor.role !== "owner" && actor.role !== "officer") {
      return { ok: false as const, error: "Only an owner or officer can remove members" };
    }

    const [target] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.userId)));
    if (!target) return { ok: false as const, error: "They're not in that org" };
    if (!leaving && target.role === "owner" && actor.role !== "owner") {
      return { ok: false as const, error: "Only an owner can remove an owner" };
    }

    if (target.role === "owner") {
      const [{ owners } = { owners: 0 }] = await tx
        .select({ owners: sql<number>`count(*)::int` })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.role, "owner")));
      if (owners <= 1) {
        return { ok: false as const, error: "Appoint another owner first — an org can't be left without one." };
      }
    }

    // Money the leaver still has committed on the org's behalf would otherwise become an
    // obligation with nobody attached to it.
    const committed = await tx.execute<{ n: string }>(
      sql`SELECT ${COMMITTED_BY_MEMBER(opts.orgId, opts.userId)}::text AS n`,
    );
    if (Number(committed.rows[0]?.n ?? 0) > 0) {
      return {
        ok: false as const,
        error: `They still have ${Number(committed.rows[0]!.n).toLocaleString()} aUEC of the org's money committed. Settle or cancel those first.`,
      };
    }

    await tx.delete(orgMembers).where(eq(orgMembers.id, target.id));
    await tx.insert(orgEvents).values({
      orgId: opts.orgId,
      actorId: opts.actorId,
      subjectId: opts.userId,
      type: leaving ? "member_left" : "member_removed",
      data: {},
    });
    return { ok: true as const, orgId: opts.orgId };
  });
}

/**
 * Update the declared treasury.
 *
 * Refuses to drop it below what the org has already promised, exactly as a personal balance
 * does — otherwise an owner could quietly un-back every live wanted ad the org has posted.
 */
export async function setOrgTreasury(
  db: Db,
  opts: { orgId: string; actorId: string; treasury: number },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.actorId)));
    if (!actor || (actor.role !== "owner" && actor.role !== "officer")) {
      return { ok: false as const, error: "Only an owner or officer can set the treasury" };
    }
    if (opts.treasury < 0) return { ok: false as const, error: "A treasury can't be negative" };

    const committed = await tx.execute<{ n: string }>(sql`SELECT ${COMMITTED_ORG_AUEC(opts.orgId)}::text AS n`);
    const owed = Number(committed.rows[0]?.n ?? 0);
    if (opts.treasury < owed) {
      return {
        ok: false as const,
        error: `${owed.toLocaleString()} aUEC is committed to live wanted ads and unsettled purchases — clear those before lowering the treasury below it.`,
      };
    }

    await tx.update(orgs).set({ treasury: opts.treasury, updatedAt: new Date() }).where(eq(orgs.id, opts.orgId));
    await tx.insert(orgEvents).values({
      orgId: opts.orgId,
      actorId: opts.actorId,
      type: "treasury_set",
      data: { treasury: opts.treasury },
    });
    return { ok: true as const, orgId: opts.orgId };
  });
}

export type OrgStanding = {
  completed: number;
  undertaken: number;
  completionPct: number | null;
  /** aUEC settled through the org, both directions. */
  volume: number;
};

/**
 * An org's trading record, aggregated over sales it was a party to.
 *
 * Deliberately NOT the average of its members' personal standings: a member's own trades are
 * their own, and an org that has never traded should read as new rather than inheriting the
 * reputation of whoever happens to have joined it.
 */
export async function orgStanding(db: Db, orgId: string): Promise<OrgStanding> {
  const rows = await db.execute<{ completed: number; undertaken: number; volume: string }>(sql`
    SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed,
           count(*) FILTER (WHERE status IN ('completed','cancelled','expired'))::int AS undertaken,
           coalesce(sum(total_price) FILTER (WHERE status = 'completed'), 0)::text AS volume
    FROM bazaar_sales
    WHERE seller_org_id = ${orgId}::uuid OR buyer_org_id = ${orgId}::uuid
  `);
  const r = rows.rows[0];
  const completed = r?.completed ?? 0;
  const undertaken = r?.undertaken ?? 0;
  return {
    completed,
    undertaken,
    completionPct: undertaken > 0 ? Math.round((completed / undertaken) * 100) : null,
    volume: Number(r?.volume ?? 0),
  };
}
