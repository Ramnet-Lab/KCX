import type { RsiProfile } from "@kcx/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  ORG_PROPOSAL_KINDS,
  orgEvents,
  orgMembers,
  orgProposalApprovals,
  orgProposals,
  orgVerifications,
  orgs,
} from "../schema/orgs";
import { users } from "../schema/orders";

/**
 * Orgs: keeping the roster in step with RSI, proving leadership, and gating spending.
 *
 * Read the header of schema/orgs.ts first — it explains the two credentials (rank stars,
 * which nobody can award themselves, and the charter code, which proves control of the org)
 * and why an unverified org cannot trade at all.
 */

/**
 * How long a membership reading stays good for spending purposes.
 *
 * Someone who left the org two months ago should not still be able to commit its treasury
 * because nobody happened to notice. Re-verifying refreshes it, and only spending is
 * affected — the roster keeps showing them until their profile says otherwise.
 */
export const ORG_AUTHORITY_STALE_DAYS = 60;

/** Where the charter code has to appear. All three are org-admin-only fields on RSI. */
export const ORG_CHARTER_FIELDS = ["Charter", "History", "Manifesto"] as const;

export const ORG_CODE_TTL_MINUTES = 60;
export const ORG_VERIFY_MAX_ATTEMPTS = 20;
/** A proposal nobody votes on shouldn't sit open against the treasury forever. */
export const PROPOSAL_TTL_HOURS = 168;

export type OrgRole = "president" | "treasurer" | "member";

export type OrgDto = {
  id: string;
  sid: string;
  name: string;
  status: string;
  description: string | null;
  logoFilename: string | null;
  treasury: number;
  memberCount: number;
  charterHolderId: string | null;
  charterHolderName: string | null;
  boardThreshold: number;
  boardMinValue: number;
  boardSize: number;
  /** Viewer-relative. Null when they're not a member. */
  myRole: string | null;
  myRankStars: number | null;
  mySpendLimit: number | null;
  amBoardMember: boolean;
  /** True when the viewer is the highest-ranked member and nobody has verified yet. */
  amPresumedLeader: boolean;
  canTrade: boolean;
  verifiedAt: string | null;
  createdAt: string;
};

export type OrgMemberDto = {
  userId: string;
  handle: string;
  displayName: string;
  role: string;
  rsiRank: string | null;
  rsiRankStars: number | null;
  isBoardMember: boolean;
  spendLimit: number | null;
  committed: number;
  /** False once the reading is older than ORG_AUTHORITY_STALE_DAYS. */
  authorityFresh: boolean;
  confirmedAt: string;
  joinedAt: string;
};

export type OrgResult = { ok: true; orgId?: string; code?: string } | { ok: false; error: string };

/* ------------------------------- Roster sync -------------------------------- */

/**
 * Bring a trader's org membership into line with what their RSI profile says.
 *
 * Called on every successful handle verification, which makes RSI the only way to join or
 * leave an org here. Three things happen:
 *
 *  • The org is created if this is the first verified member to name it. It starts `derived`
 *    — a roster, not a trading entity.
 *  • Their rank is refreshed. Promotions and demotions on RSI land here automatically, which
 *    is what makes the star ranking worth anything.
 *  • Membership of any OTHER org is dropped, because RSI only shows a main org and staying
 *    on a roster you've left is exactly the stale-authority problem.
 *
 * A redacted profile is deliberately left alone rather than treated as "no org": RSI is
 * telling us there IS an org it won't name, and dropping someone off a roster on that basis
 * would silently strip a treasurer of their seat for changing a privacy setting.
 */
export async function syncMembershipFromProfile(
  db: Db,
  opts: { userId: string; profile: RsiProfile },
): Promise<{ orgId: string | null; created: boolean }> {
  const { profile } = opts;
  if (profile.mainOrgVisibility === "redacted") return { orgId: null, created: false };

  const sid = profile.mainOrgSid?.trim().toUpperCase() || null;
  const now = new Date();

  return db.transaction(async (tx) => {
    // Leaving an org: drop every membership that isn't the one they now name.
    const existing = await tx.select().from(orgMembers).where(eq(orgMembers.userId, opts.userId));
    for (const m of existing) {
      const [org] = await tx.select().from(orgs).where(eq(orgs.id, m.orgId));
      if (org && org.sid === sid) continue;
      // The charter holder walking away leaves the org without a proven leader rather than
      // with an absent one — better to stop trading than to keep honouring a dead mandate.
      if (org?.charterHolderId === opts.userId) {
        await tx
          .update(orgs)
          .set({ status: "derived", charterHolderId: null, verifiedAt: null, updatedAt: now })
          .where(eq(orgs.id, org.id));
        await tx.insert(orgEvents).values({
          orgId: org.id,
          actorId: null,
          subjectId: opts.userId,
          type: "member_left",
          data: { wasCharterHolder: true },
        });
      }
      await tx.delete(orgMembers).where(eq(orgMembers.id, m.id));
      if (org) {
        await tx.insert(orgEvents).values({
          orgId: org.id,
          actorId: null,
          subjectId: opts.userId,
          type: "member_left",
          data: {},
        });
      }
    }

    if (!sid) return { orgId: null, created: false };

    let [org] = await tx.select().from(orgs).where(eq(orgs.sid, sid));
    let created = false;
    if (!org) {
      [org] = await tx
        .insert(orgs)
        .values({ sid, name: profile.mainOrgName?.trim() || sid, status: "derived" })
        .onConflictDoNothing({ target: orgs.sid })
        .returning();
      if (!org) [org] = await tx.select().from(orgs).where(eq(orgs.sid, sid));
      created = true;
      if (org) {
        await tx.insert(orgEvents).values({
          orgId: org.id,
          actorId: null,
          subjectId: opts.userId,
          type: "discovered",
          data: { sid, name: profile.mainOrgName },
        });
      }
    } else if (profile.mainOrgName && profile.mainOrgName.trim() !== org.name) {
      // Orgs rename themselves; follow it.
      await tx.update(orgs).set({ name: profile.mainOrgName.trim(), updatedAt: now }).where(eq(orgs.id, org.id));
    }
    if (!org) return { orgId: null, created: false };

    const [member] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, opts.userId)));

    if (member) {
      const rankChanged =
        member.rsiRank !== profile.mainOrgRank || member.rsiRankStars !== profile.mainOrgRankStars;
      await tx
        .update(orgMembers)
        .set({
          rsiRank: profile.mainOrgRank,
          rsiRankStars: profile.mainOrgRankStars,
          confirmedAt: now,
        })
        .where(eq(orgMembers.id, member.id));
      if (rankChanged) {
        await tx.insert(orgEvents).values({
          orgId: org.id,
          actorId: null,
          subjectId: opts.userId,
          type: "rank_changed",
          data: { rank: profile.mainOrgRank, stars: profile.mainOrgRankStars },
        });
      }
    } else {
      await tx.insert(orgMembers).values({
        orgId: org.id,
        userId: opts.userId,
        role: "member",
        rsiRank: profile.mainOrgRank,
        rsiRankStars: profile.mainOrgRankStars,
        confirmedAt: now,
      });
      await tx.insert(orgEvents).values({
        orgId: org.id,
        actorId: null,
        subjectId: opts.userId,
        type: "member_joined",
        data: { rank: profile.mainOrgRank, stars: profile.mainOrgRankStars },
      });
    }

    return { orgId: org.id, created };
  });
}

/**
 * Who is presumed to lead, before anything is proven.
 *
 * Highest rank stars, then earliest RSI enlistment, then earliest to join KCX. Only used
 * while an org is unverified — once there is a charter holder this is irrelevant, which is
 * the whole point of having a charter step.
 */
export async function presumedLeader(db: Db, orgId: string): Promise<string | null> {
  const rows = await db.execute<{ user_id: string }>(sql`
    SELECT m.user_id::text
    FROM org_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${orgId}::uuid
    ORDER BY coalesce(m.rsi_rank_stars, 0) DESC,
             u.enlisted_at ASC NULLS LAST,
             u.created_at ASC
    LIMIT 1
  `);
  return rows.rows[0]?.user_id ?? null;
}

/* --------------------------- Charter verification --------------------------- */

/**
 * Begin a leadership claim, returning the code to paste into the org's RSI charter.
 *
 * Only the presumed leader may claim while an org is unverified. Letting the newest member
 * of a hundred-person org open a claim would mean whoever happened to try first got the
 * code — and the star ranking exists precisely so that isn't the rule.
 */
export async function startOrgVerification(
  db: Db,
  opts: { orgId: string; claimantId: string; code: string },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, opts.orgId)).for("update");
    if (!org) return { ok: false as const, error: "Org not found" };
    if (org.status === "suspended") return { ok: false as const, error: "This org is suspended." };

    const [member] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, opts.claimantId)));
    if (!member) return { ok: false as const, error: "Your RSI profile doesn't list this as your main org." };

    if (org.status === "verified" && org.charterHolderId !== opts.claimantId) {
      return {
        ok: false as const,
        error: "This org already has a verified leader. Ask them to transfer it, or contact a moderator.",
      };
    }
    if (org.status !== "verified") {
      const presumed = await presumedLeader(tx as unknown as Db, org.id);
      if (presumed && presumed !== opts.claimantId) {
        return {
          ok: false as const,
          error:
            "A higher-ranked member of this org is on KCX, so the claim is theirs to make. If your RSI rank is higher, re-verify your handle to refresh it.",
        };
      }
    }

    await tx
      .update(orgVerifications)
      .set({ status: "expired" })
      .where(and(eq(orgVerifications.orgId, org.id), eq(orgVerifications.status, "pending")));

    await tx.insert(orgVerifications).values({
      orgId: org.id,
      claimantId: opts.claimantId,
      code: opts.code,
      expiresAt: new Date(Date.now() + ORG_CODE_TTL_MINUTES * 60_000),
    });
    if (org.status === "derived") {
      await tx.update(orgs).set({ status: "pending", updatedAt: new Date() }).where(eq(orgs.id, org.id));
    }
    await tx.insert(orgEvents).values({
      orgId: org.id,
      actorId: opts.claimantId,
      type: "verification_started",
      data: {},
    });
    return { ok: true as const, orgId: org.id, code: opts.code };
  });
}

/** The live claim for an org, if any — the caller fetches the charter and checks the code. */
export async function liveOrgVerification(db: Db, orgId: string) {
  const [row] = await db
    .select()
    .from(orgVerifications)
    .where(and(eq(orgVerifications.orgId, orgId), eq(orgVerifications.status, "pending")))
    .orderBy(desc(orgVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

/** Record that the code was found in the charter: the claimant becomes the leader. */
export async function completeOrgVerification(
  db: Db,
  opts: { verificationId: string; logoFilename?: string | null },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [v] = await tx
      .select()
      .from(orgVerifications)
      .where(eq(orgVerifications.id, opts.verificationId))
      .for("update");
    if (!v || v.status !== "pending") return { ok: false as const, error: "That claim is no longer open" };

    const now = new Date();
    await tx
      .update(orgVerifications)
      .set({ status: "verified", verifiedAt: now })
      .where(eq(orgVerifications.id, v.id));

    await tx
      .update(orgs)
      .set({
        status: "verified",
        charterHolderId: v.claimantId,
        verifiedAt: now,
        verifiedByModId: null,
        ...(opts.logoFilename ? { logoFilename: opts.logoFilename } : {}),
        updatedAt: now,
      })
      .where(eq(orgs.id, v.orgId));

    // The proven leader is the president. Anyone else holding the role steps back to member
    // — there is exactly one presidency and it is now decided.
    await tx
      .update(orgMembers)
      .set({ role: "member" })
      .where(and(eq(orgMembers.orgId, v.orgId), eq(orgMembers.role, "president")));
    await tx
      .update(orgMembers)
      .set({ role: "president", isBoardMember: true, spendLimit: null })
      .where(and(eq(orgMembers.orgId, v.orgId), eq(orgMembers.userId, v.claimantId)));

    await tx.insert(orgEvents).values({
      orgId: v.orgId,
      actorId: v.claimantId,
      subjectId: v.claimantId,
      type: "verified",
      data: {},
    });
    return { ok: true as const, orgId: v.orgId };
  });
}

export async function noteOrgVerificationAttempt(db: Db, verificationId: string): Promise<number> {
  const [row] = await db
    .update(orgVerifications)
    .set({ attempts: sql`${orgVerifications.attempts} + 1`, lastAttemptAt: new Date() })
    .where(eq(orgVerifications.id, verificationId))
    .returning({ attempts: orgVerifications.attempts });
  return row?.attempts ?? 0;
}

/* ------------------------------- Authority ---------------------------------- */

export type OrgActionCheck = {
  allowed: boolean;
  /** True when the amount is fine but the board has to sign it off first. */
  needsBoard: boolean;
  requiredApprovals: number;
  orgAvailable: number;
  memberAvailable: number | null;
  reason: string | null;
};

/** aUEC an org has already promised. Mirrors COMMITTED_AUEC for a person. */
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
    +
    coalesce((
      -- An open proposal is money spoken for. Leaving it out would let a board approve
      -- three purchases that individually fit and together don't.
      SELECT sum(p.value)
      FROM org_proposals p
      WHERE p.org_id = ${orgId} AND p.status IN ('open','approved')
    ), 0)
)`;

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
    +
    coalesce((
      SELECT sum(p.value)
      FROM org_proposals p
      WHERE p.org_id = ${orgId} AND p.proposed_by_id = ${userId} AND p.status IN ('open','approved')
    ), 0)
)`;

/**
 * May this member commit this much of the org's money, and does the board need to agree?
 *
 * Every gate, in the order they bite:
 *
 *  1. The org is verified and not suspended — an unproven org cannot trade at all.
 *  2. They are a member, in a role that touches money.
 *  3. Their membership reading is fresh (ORG_AUTHORITY_STALE_DAYS).
 *  4. The org's uncommitted treasury covers it.
 *  5. Their delegated limit covers it — enforcing only (4) would make every limit decorative.
 *  6. Whether the board has to sign off, which is not a refusal but a different route.
 */
export async function canActForOrg(
  db: Db,
  opts: { orgId: string; userId: string; amount: number },
): Promise<OrgActionCheck> {
  const deny = (reason: string): OrgActionCheck => ({
    allowed: false,
    needsBoard: false,
    requiredApprovals: 0,
    orgAvailable: 0,
    memberAvailable: null,
    reason,
  });

  const rows = await db.execute<{
    status: string; treasury: string; org_committed: string; board_threshold: number;
    board_min_value: string; role: string | null; spend_limit: string | null;
    member_committed: string; confirmed_at: string | Date | null; board_size: number;
  }>(sql`
    SELECT o.status, o.treasury::text,
           ${COMMITTED_ORG_AUEC(opts.orgId)}::text AS org_committed,
           o.board_threshold, o.board_min_value::text,
           m.role, m.spend_limit::text, m.confirmed_at,
           ${COMMITTED_BY_MEMBER(opts.orgId, opts.userId)}::text AS member_committed,
           (SELECT count(*)::int FROM org_members bm WHERE bm.org_id = o.id AND bm.is_board_member) AS board_size
    FROM orgs o
    LEFT JOIN org_members m ON m.org_id = o.id AND m.user_id = ${opts.userId}::uuid
    WHERE o.id = ${opts.orgId}::uuid
  `);
  const r = rows.rows[0];
  if (!r) return deny("That org doesn't exist");

  if (r.status === "suspended") return deny("This org is suspended and can't trade.");
  if (r.status !== "verified") {
    return deny(
      "This org hasn't proved its leadership yet. Someone senior has to verify it through the org's RSI charter before it can trade.",
    );
  }
  if (!r.role) return deny("You're not a member of that org");
  if (r.role === "member") return deny("Only the president or a treasurer can commit org funds.");

  const confirmedAt = r.confirmed_at ? new Date(r.confirmed_at) : null;
  const staleAfter = Date.now() - ORG_AUTHORITY_STALE_DAYS * 86_400_000;
  if (!confirmedAt || confirmedAt.getTime() < staleAfter) {
    return deny(
      `Your membership hasn't been confirmed against RSI in ${ORG_AUTHORITY_STALE_DAYS} days. Re-verify your handle to restore spending authority.`,
    );
  }

  const orgAvailable = Math.max(0, Number(r.treasury) - Number(r.org_committed));
  const memberAvailable =
    r.spend_limit != null ? Math.max(0, Number(r.spend_limit) - Number(r.member_committed)) : null;

  if (opts.amount > orgAvailable) {
    return {
      ...deny(
        `The org has ${orgAvailable.toLocaleString()} aUEC uncommitted; that needs ${opts.amount.toLocaleString()}.`,
      ),
      orgAvailable,
      memberAvailable,
    };
  }
  if (memberAvailable != null && opts.amount > memberAvailable) {
    return {
      ...deny(
        `Your delegated limit leaves you ${memberAvailable.toLocaleString()} aUEC of the org's money; that needs ${opts.amount.toLocaleString()}.`,
      ),
      orgAvailable,
      memberAvailable,
    };
  }

  // The threshold counts board members OTHER than the proposer, so it can never exceed the
  // number of people actually able to vote.
  const threshold = r.board_threshold;
  const needsBoard = threshold > 0 && opts.amount >= Number(r.board_min_value);
  const required = Math.min(threshold, Math.max(0, r.board_size - 1));
  if (needsBoard && required < 1) {
    return deny(
      "This org requires board approval but has nobody else on the board. The president needs to appoint board members first.",
    );
  }

  return { allowed: true, needsBoard, requiredApprovals: required, orgAvailable, memberAvailable, reason: null };
}

/* --------------------------------- Reads ------------------------------------ */

const ORG_SELECT = (viewerId: string | null) => sql`
  SELECT o.id::text, o.sid, o.name, o.status, o.description, o.logo_filename,
         o.treasury::text, o.charter_holder_id::text, ch.display_name AS charter_holder_name,
         o.board_threshold, o.board_min_value::text, o.verified_at, o.created_at,
         (SELECT count(*)::int FROM org_members m2 WHERE m2.org_id = o.id) AS member_count,
         (SELECT count(*)::int FROM org_members m3 WHERE m3.org_id = o.id AND m3.is_board_member) AS board_size,
         m.role, m.rsi_rank_stars, m.spend_limit::text, m.is_board_member
  FROM orgs o
  LEFT JOIN users ch ON ch.id = o.charter_holder_id
  LEFT JOIN org_members m ON m.org_id = o.id
    AND ${viewerId ? sql`m.user_id = ${viewerId}::uuid` : sql`false`}
`;

type OrgRow = {
  id: string; sid: string; name: string; status: string; description: string | null;
  logo_filename: string | null; treasury: string; charter_holder_id: string | null;
  charter_holder_name: string | null; board_threshold: number; board_min_value: string;
  verified_at: string | Date | null; created_at: string | Date; member_count: number;
  board_size: number; role: string | null; rsi_rank_stars: number | null;
  spend_limit: string | null; is_board_member: boolean | null;
};

async function toOrgDto(db: Db, r: OrgRow, viewerId: string | null): Promise<OrgDto> {
  // Only computed while nothing is proven. Once there is a charter holder the star ranking
  // decides nothing, and asking anyway would be a query per org for an answer nobody uses.
  const presumed = viewerId && r.status !== "verified" ? await presumedLeader(db, r.id) : null;
  return {
    id: r.id,
    sid: r.sid,
    name: r.name,
    status: r.status,
    description: r.description,
    logoFilename: r.logo_filename,
    treasury: Number(r.treasury),
    memberCount: r.member_count,
    charterHolderId: r.charter_holder_id,
    charterHolderName: r.charter_holder_name,
    boardThreshold: r.board_threshold,
    boardMinValue: Number(r.board_min_value),
    boardSize: r.board_size,
    myRole: r.role,
    myRankStars: r.rsi_rank_stars,
    mySpendLimit: r.spend_limit != null ? Number(r.spend_limit) : null,
    amBoardMember: r.is_board_member === true,
    amPresumedLeader: presumed != null && presumed === viewerId,
    canTrade: r.status === "verified",
    verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Orgs this trader belongs to. Derived from RSI, so in practice exactly one. */
export async function listMyOrgs(db: Db, userId: string): Promise<OrgDto[]> {
  const rows = await db.execute<OrgRow>(sql`
    ${ORG_SELECT(userId)}
    WHERE EXISTS (SELECT 1 FROM org_members mm WHERE mm.org_id = o.id AND mm.user_id = ${userId}::uuid)
    ORDER BY o.name
  `);
  return Promise.all(rows.rows.map((r) => toOrgDto(db, r, userId)));
}

export async function getOrg(db: Db, orgId: string, viewerId?: string | null): Promise<OrgDto | null> {
  const rows = await db.execute<OrgRow>(sql`${ORG_SELECT(viewerId ?? null)} WHERE o.id = ${orgId}::uuid`);
  const r = rows.rows[0];
  return r ? toOrgDto(db, r, viewerId ?? null) : null;
}

export async function getOrgBySid(db: Db, sid: string, viewerId?: string | null): Promise<OrgDto | null> {
  const rows = await db.execute<OrgRow>(sql`${ORG_SELECT(viewerId ?? null)} WHERE o.sid = ${sid.toUpperCase()}`);
  const r = rows.rows[0];
  return r ? toOrgDto(db, r, viewerId ?? null) : null;
}

/** Roster, ordered as the org itself ranks people, with each member's committed slice. */
export async function listOrgMembers(db: Db, orgId: string): Promise<OrgMemberDto[]> {
  const rows = await db.execute<{
    user_id: string; handle: string; display_name: string; role: string;
    rsi_rank: string | null; rsi_rank_stars: number | null; is_board_member: boolean;
    spend_limit: string | null; confirmed_at: string | Date; joined_at: string | Date;
  }>(sql`
    SELECT m.user_id::text, u.handle, u.display_name, m.role, m.rsi_rank, m.rsi_rank_stars,
           m.is_board_member, m.spend_limit::text, m.confirmed_at, m.joined_at
    FROM org_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${orgId}::uuid
    ORDER BY array_position(ARRAY['president','treasurer','member']::text[], m.role),
             coalesce(m.rsi_rank_stars, 0) DESC, u.display_name
  `);

  // Per-member commitment is a correlated subquery over three tables; inlining it would make
  // the roster quadratic in members. A few round trips on a rarely-read page is the better
  // trade, and only members who can actually spend need asking.
  const staleAfter = Date.now() - ORG_AUTHORITY_STALE_DAYS * 86_400_000;
  const out: OrgMemberDto[] = [];
  for (const r of rows.rows) {
    let committed = 0;
    if (r.role !== "member") {
      const c = await db.execute<{ n: string }>(sql`SELECT ${COMMITTED_BY_MEMBER(orgId, r.user_id)}::text AS n`);
      committed = Number(c.rows[0]?.n ?? 0);
    }
    out.push({
      userId: r.user_id,
      handle: r.handle,
      displayName: r.display_name,
      role: r.role,
      rsiRank: r.rsi_rank,
      rsiRankStars: r.rsi_rank_stars,
      isBoardMember: r.is_board_member,
      spendLimit: r.spend_limit != null ? Number(r.spend_limit) : null,
      committed,
      authorityFresh: new Date(r.confirmed_at).getTime() >= staleAfter,
      confirmedAt: new Date(r.confirmed_at).toISOString(),
      joinedAt: new Date(r.joined_at).toISOString(),
    });
  }
  return out;
}

/* --------------------------- The president's controls ----------------------- */

async function requirePresident(
  tx: Db,
  orgId: string,
  userId: string,
): Promise<{ error: string } | { org: typeof orgs.$inferSelect }> {
  const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) return { error: "Org not found" };
  if (org.status === "suspended") return { error: "This org is suspended." };
  if (org.charterHolderId !== userId) return { error: "Only the org's verified leader can do that." };
  return { org };
}

/**
 * Set a member's role, board seat and delegated limit.
 *
 * The president's word is final here and overrides the RSI star ranking outright — that
 * ranking only ever decided who got to make the leadership claim in the first place. This
 * is the "actual leader controls who has what, overriding all else" rule.
 */
export async function setOrgMemberRole(
  db: Db,
  opts: {
    orgId: string;
    actorId: string;
    userId: string;
    role?: OrgRole;
    isBoardMember?: boolean;
    spendLimit?: number | null;
  },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const guard = await requirePresident(tx as unknown as Db, opts.orgId, opts.actorId);
    if ("error" in guard) return { ok: false as const, error: guard.error };
    if (opts.role === "president") {
      return { ok: false as const, error: "There is one president — use transfer leadership." };
    }
    if (opts.userId === opts.actorId && opts.role) {
      return { ok: false as const, error: "Transfer leadership rather than changing your own role." };
    }

    const [member] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.userId)));
    if (!member) {
      return {
        ok: false as const,
        error: "They're not on this org's roster. Membership comes from their RSI profile, not from here.",
      };
    }

    // Money committed under a wider mandate must not be orphaned by narrowing it.
    const committed = await tx.execute<{ n: string }>(
      sql`SELECT ${COMMITTED_BY_MEMBER(opts.orgId, opts.userId)}::text AS n`,
    );
    const owed = Number(committed.rows[0]?.n ?? 0);
    if (owed > 0 && (opts.role === "member" || (opts.spendLimit != null && opts.spendLimit < owed))) {
      return {
        ok: false as const,
        error: `They still have ${owed.toLocaleString()} aUEC of org money committed. Settle or cancel those first.`,
      };
    }

    await tx
      .update(orgMembers)
      .set({
        role: opts.role ?? member.role,
        isBoardMember: opts.isBoardMember ?? member.isBoardMember,
        spendLimit: opts.spendLimit !== undefined ? opts.spendLimit : member.spendLimit,
      })
      .where(eq(orgMembers.id, member.id));
    await tx.insert(orgEvents).values({
      orgId: opts.orgId,
      actorId: opts.actorId,
      subjectId: opts.userId,
      type:
        opts.role && opts.role !== member.role
          ? "role_changed"
          : opts.isBoardMember !== undefined && opts.isBoardMember !== member.isBoardMember
            ? "board_changed"
            : "limit_changed",
      data: { role: opts.role ?? member.role, board: opts.isBoardMember, spendLimit: opts.spendLimit },
    });
    return { ok: true as const, orgId: opts.orgId };
  });
}

/** Board rules. Copied onto each proposal at creation, so changing them never retunes a live vote. */
export async function setOrgBoardRules(
  db: Db,
  opts: { orgId: string; actorId: string; threshold: number; minValue: number },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const guard = await requirePresident(tx as unknown as Db, opts.orgId, opts.actorId);
    if ("error" in guard) return { ok: false as const, error: guard.error };
    if (opts.threshold < 0 || opts.threshold > 10) return { ok: false as const, error: "Threshold is 0–10." };
    if (opts.minValue < 0) return { ok: false as const, error: "Minimum can't be negative." };

    await tx
      .update(orgs)
      .set({ boardThreshold: opts.threshold, boardMinValue: opts.minValue, updatedAt: new Date() })
      .where(eq(orgs.id, opts.orgId));
    await tx.insert(orgEvents).values({
      orgId: opts.orgId,
      actorId: opts.actorId,
      type: "board_changed",
      data: { threshold: opts.threshold, minValue: opts.minValue },
    });
    return { ok: true as const, orgId: opts.orgId };
  });
}

/** Update the declared treasury. Never below what the org has already promised. */
export async function setOrgTreasury(
  db: Db,
  opts: { orgId: string; actorId: string; treasury: number },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const guard = await requirePresident(tx as unknown as Db, opts.orgId, opts.actorId);
    if ("error" in guard) return { ok: false as const, error: guard.error };
    if (opts.treasury < 0) return { ok: false as const, error: "A treasury can't be negative" };

    const committed = await tx.execute<{ n: string }>(sql`SELECT ${COMMITTED_ORG_AUEC(opts.orgId)}::text AS n`);
    const owed = Number(committed.rows[0]?.n ?? 0);
    if (opts.treasury < owed) {
      return {
        ok: false as const,
        error: `${owed.toLocaleString()} aUEC is committed to live ads, unsettled purchases and open proposals — clear those first.`,
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

/**
 * Hand leadership to another member.
 *
 * Direct, rather than making the successor re-prove the charter: the current holder already
 * proved control of it, and requiring proof to delegate would mean nobody ever does, leaving
 * orgs stranded behind inactive presidents. Logged loudly, and a moderator can reverse it.
 */
export async function transferOrgLeadership(
  db: Db,
  opts: { orgId: string; actorId: string; toUserId: string },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const guard = await requirePresident(tx as unknown as Db, opts.orgId, opts.actorId);
    if ("error" in guard) return { ok: false as const, error: guard.error };
    if (opts.toUserId === opts.actorId) return { ok: false as const, error: "You already lead this org." };

    const [target] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.toUserId)));
    if (!target) return { ok: false as const, error: "They're not on this org's roster." };

    const now = new Date();
    await tx
      .update(orgMembers)
      .set({ role: "member" })
      .where(and(eq(orgMembers.orgId, opts.orgId), eq(orgMembers.userId, opts.actorId)));
    await tx
      .update(orgMembers)
      .set({ role: "president", isBoardMember: true, spendLimit: null })
      .where(eq(orgMembers.id, target.id));
    await tx.update(orgs).set({ charterHolderId: opts.toUserId, updatedAt: now }).where(eq(orgs.id, opts.orgId));
    await tx.insert(orgEvents).values({
      orgId: opts.orgId,
      actorId: opts.actorId,
      subjectId: opts.toUserId,
      type: "leadership_transferred",
      data: {},
    });
    return { ok: true as const, orgId: opts.orgId };
  });
}

/* ------------------------------ Moderator override -------------------------- */

/**
 * The escape hatch.
 *
 * Charter verification settles the ordinary case with nobody's judgement involved, which is
 * why moderators are here only for what genuinely needs it: a compromised account, an org
 * whose leadership changed hands off-platform, a disputed claim, or an org that has to stop
 * trading right now. Passing `userId: null` strips leadership and returns the org to being
 * a roster.
 */
export async function modSetOrgLeadership(
  db: Db,
  opts: { orgId: string; moderatorId: string; userId: string | null; reason?: string | null },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, opts.orgId)).for("update");
    if (!org) return { ok: false as const, error: "Org not found" };
    const now = new Date();

    await tx
      .update(orgMembers)
      .set({ role: "member" })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.role, "president")));

    if (opts.userId == null) {
      await tx
        .update(orgs)
        .set({
          status: "derived",
          charterHolderId: null,
          verifiedAt: null,
          verifiedByModId: opts.moderatorId,
          updatedAt: now,
        })
        .where(eq(orgs.id, org.id));
      await tx.insert(orgEvents).values({
        orgId: org.id,
        actorId: opts.moderatorId,
        type: "mod_revoked",
        data: { reason: opts.reason ?? null },
      });
      return { ok: true as const, orgId: org.id };
    }

    const [member] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, opts.userId)));
    if (!member) return { ok: false as const, error: "They're not on this org's roster." };

    await tx
      .update(orgs)
      .set({
        status: "verified",
        charterHolderId: opts.userId,
        verifiedAt: now,
        verifiedByModId: opts.moderatorId,
        updatedAt: now,
      })
      .where(eq(orgs.id, org.id));
    await tx
      .update(orgMembers)
      .set({ role: "president", isBoardMember: true, spendLimit: null })
      .where(eq(orgMembers.id, member.id));
    await tx.insert(orgEvents).values({
      orgId: org.id,
      actorId: opts.moderatorId,
      subjectId: opts.userId,
      type: "mod_granted",
      data: { reason: opts.reason ?? null },
    });
    return { ok: true as const, orgId: org.id };
  });
}

/** Stop an org trading, or let it start again. The roster is never touched. */
export async function modSetOrgSuspended(
  db: Db,
  opts: { orgId: string; moderatorId: string; suspended: boolean; reason?: string | null },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, opts.orgId)).for("update");
    if (!org) return { ok: false as const, error: "Org not found" };
    await tx
      .update(orgs)
      .set({
        status: opts.suspended ? "suspended" : org.charterHolderId ? "verified" : "derived",
        suspendedReason: opts.suspended ? (opts.reason ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(orgs.id, org.id));
    await tx.insert(orgEvents).values({
      orgId: org.id,
      actorId: opts.moderatorId,
      type: opts.suspended ? "suspended" : "reinstated",
      data: { reason: opts.reason ?? null },
    });
    return { ok: true as const, orgId: org.id };
  });
}

/* --------------------------------- The board -------------------------------- */

export type OrgProposalDto = {
  id: string;
  orgId: string;
  kind: string;
  value: number;
  summary: string;
  payload: unknown;
  status: string;
  requiredApprovals: number;
  approvals: number;
  objections: number;
  proposedById: string;
  proposedByName: string;
  /** Viewer-relative, so the UI needn't work out whether they may vote. */
  isMine: boolean;
  myVote: boolean | null;
  canVote: boolean;
  resultRef: string | null;
  failureReason: string | null;
  expiresAt: string;
  createdAt: string;
};

/**
 * Put an org transaction to the board.
 *
 * The proposal holds the same payload the ordinary endpoint would have taken, so execution
 * replays the existing code path rather than reimplementing it — a board that drifted from
 * the non-board path would be worse than no board.
 */
export async function createOrgProposal(
  db: Db,
  opts: {
    orgId: string;
    proposedById: string;
    kind: (typeof ORG_PROPOSAL_KINDS)[number];
    value: number;
    summary: string;
    payload: unknown;
    requiredApprovals: number;
  },
): Promise<{ ok: true; proposalId: string } | { ok: false; error: string }> {
  const [row] = await db
    .insert(orgProposals)
    .values({
      orgId: opts.orgId,
      proposedById: opts.proposedById,
      kind: opts.kind,
      value: Math.max(0, Math.floor(opts.value)),
      summary: opts.summary.slice(0, 300),
      payload: opts.payload as never,
      requiredApprovals: opts.requiredApprovals,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_HOURS * 3_600_000),
    })
    .returning({ id: orgProposals.id });
  if (!row) return { ok: false, error: "Could not open the proposal" };

  await db.insert(orgEvents).values({
    orgId: opts.orgId,
    actorId: opts.proposedById,
    type: "proposal_opened",
    data: { proposalId: row.id, kind: opts.kind, value: opts.value },
  });
  return { ok: true, proposalId: row.id };
}

/**
 * Vote on a proposal.
 *
 * Board members other than the proposer only. Excluding the proposer is the same rule that
 * stops someone accepting their own offer on the bazaar: a quorum you can supply yourself is
 * not a quorum. The president is bound by it too — they set the threshold, but they don't
 * get to be the whole board.
 *
 * Returns `readyToExecute` when the vote has carried; the caller then replays the payload.
 */
export async function voteOnOrgProposal(
  db: Db,
  opts: { proposalId: string; userId: string; approve: boolean; note?: string | null },
): Promise<{ ok: true; readyToExecute: boolean; rejected: boolean } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(orgProposals).where(eq(orgProposals.id, opts.proposalId)).for("update");
    if (!p) return { ok: false as const, error: "Proposal not found" };
    if (p.status !== "open") return { ok: false as const, error: `That proposal is already ${p.status}` };
    if (p.expiresAt <= new Date()) return { ok: false as const, error: "That proposal has expired" };
    if (p.proposedById === opts.userId) {
      return { ok: false as const, error: "You proposed it — the rest of the board decides." };
    }

    const [member] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, p.orgId), eq(orgMembers.userId, opts.userId)));
    if (!member?.isBoardMember) return { ok: false as const, error: "You're not on this org's board." };

    await tx
      .insert(orgProposalApprovals)
      .values({ proposalId: p.id, memberId: opts.userId, approve: opts.approve, note: opts.note ?? null })
      .onConflictDoUpdate({
        target: [orgProposalApprovals.proposalId, orgProposalApprovals.memberId],
        set: { approve: opts.approve, note: opts.note ?? null },
      });

    const votes = await tx.select().from(orgProposalApprovals).where(eq(orgProposalApprovals.proposalId, p.id));
    const yes = votes.filter((v) => v.approve).length;
    const no = votes.filter((v) => !v.approve).length;

    // Objections don't merely fail to help — enough of them close it. A proposal the board
    // has actively refused should not sit open waiting for someone to change their mind.
    if (no >= p.requiredApprovals) {
      await tx.update(orgProposals).set({ status: "rejected" }).where(eq(orgProposals.id, p.id));
      await tx.insert(orgEvents).values({
        orgId: p.orgId,
        actorId: opts.userId,
        type: "proposal_rejected",
        data: { proposalId: p.id },
      });
      return { ok: true as const, readyToExecute: false, rejected: true };
    }

    if (yes >= p.requiredApprovals) {
      await tx.update(orgProposals).set({ status: "approved" }).where(eq(orgProposals.id, p.id));
      await tx.insert(orgEvents).values({
        orgId: p.orgId,
        actorId: opts.userId,
        type: "proposal_approved",
        data: { proposalId: p.id },
      });
      return { ok: true as const, readyToExecute: true, rejected: false };
    }

    return { ok: true as const, readyToExecute: false, rejected: false };
  });
}

/** Record what executing an approved proposal produced — or why it didn't. */
export async function settleOrgProposal(
  db: Db,
  opts: { proposalId: string; resultRef?: string | null; failureReason?: string | null },
): Promise<void> {
  const failed = opts.failureReason != null;
  const [p] = await db
    .update(orgProposals)
    .set({
      status: failed ? "failed" : "executed",
      resultRef: opts.resultRef ?? null,
      failureReason: opts.failureReason ?? null,
      executedAt: new Date(),
    })
    .where(eq(orgProposals.id, opts.proposalId))
    .returning({ orgId: orgProposals.orgId });
  if (p) {
    await db.insert(orgEvents).values({
      orgId: p.orgId,
      actorId: null,
      type: "proposal_executed",
      data: { proposalId: opts.proposalId, failed, reason: opts.failureReason ?? null },
    });
  }
}

/** The president may pull a proposal, but may never carry one alone. */
export async function cancelOrgProposal(
  db: Db,
  opts: { proposalId: string; userId: string },
): Promise<OrgResult> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(orgProposals).where(eq(orgProposals.id, opts.proposalId)).for("update");
    if (!p) return { ok: false as const, error: "Proposal not found" };
    if (p.status !== "open") return { ok: false as const, error: `That proposal is already ${p.status}` };

    const [org] = await tx.select().from(orgs).where(eq(orgs.id, p.orgId));
    const isPresident = org?.charterHolderId === opts.userId;
    if (!isPresident && p.proposedById !== opts.userId) {
      return { ok: false as const, error: "Only the proposer or the president can withdraw it." };
    }

    await tx.update(orgProposals).set({ status: "rejected" }).where(eq(orgProposals.id, p.id));
    await tx.insert(orgEvents).values({
      orgId: p.orgId,
      actorId: opts.userId,
      type: "proposal_rejected",
      data: { proposalId: p.id, withdrawn: true },
    });
    return { ok: true as const, orgId: p.orgId };
  });
}

/** Proposals for an org, newest first, with the viewer's own vote resolved. */
export async function listOrgProposals(
  db: Db,
  orgId: string,
  viewerId: string | null,
  opts: { openOnly?: boolean } = {},
): Promise<OrgProposalDto[]> {
  const rows = await db.execute<{
    id: string; org_id: string; kind: string; value: string; summary: string; payload: unknown;
    status: string; required_approvals: number; approvals: number; objections: number;
    proposed_by_id: string; proposed_by_name: string; my_vote: boolean | null;
    is_board: boolean | null; result_ref: string | null; failure_reason: string | null;
    expires_at: string | Date; created_at: string | Date;
  }>(sql`
    SELECT p.id::text, p.org_id::text, p.kind, p.value::text, p.summary, p.payload,
           p.status, p.required_approvals,
           (SELECT count(*)::int FROM org_proposal_approvals a WHERE a.proposal_id = p.id AND a.approve) AS approvals,
           (SELECT count(*)::int FROM org_proposal_approvals a WHERE a.proposal_id = p.id AND NOT a.approve) AS objections,
           p.proposed_by_id::text, u.display_name AS proposed_by_name,
           mine.approve AS my_vote, bm.is_board_member AS is_board,
           p.result_ref, p.failure_reason, p.expires_at, p.created_at
    FROM org_proposals p
    JOIN users u ON u.id = p.proposed_by_id
    LEFT JOIN org_proposal_approvals mine ON mine.proposal_id = p.id
      AND ${viewerId ? sql`mine.member_id = ${viewerId}::uuid` : sql`false`}
    LEFT JOIN org_members bm ON bm.org_id = p.org_id
      AND ${viewerId ? sql`bm.user_id = ${viewerId}::uuid` : sql`false`}
    WHERE p.org_id = ${orgId}::uuid
      ${opts.openOnly ? sql`AND p.status = 'open'` : sql``}
    ORDER BY p.created_at DESC
    LIMIT 100
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    kind: r.kind,
    value: Number(r.value),
    summary: r.summary,
    payload: r.payload,
    status: r.status,
    requiredApprovals: r.required_approvals,
    approvals: r.approvals,
    objections: r.objections,
    proposedById: r.proposed_by_id,
    proposedByName: r.proposed_by_name,
    isMine: viewerId != null && r.proposed_by_id === viewerId,
    myVote: r.my_vote,
    canVote: r.status === "open" && r.is_board === true && r.proposed_by_id !== viewerId,
    resultRef: r.result_ref,
    failureReason: r.failure_reason,
    expiresAt: new Date(r.expires_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function getOrgProposal(db: Db, proposalId: string) {
  const [row] = await db.select().from(orgProposals).where(eq(orgProposals.id, proposalId));
  return row ?? null;
}

/** Close proposals nobody voted on, releasing the treasury they were holding. */
export async function expireOrgProposals(db: Db): Promise<number> {
  const expired = await db
    .update(orgProposals)
    .set({ status: "expired" })
    .where(and(eq(orgProposals.status, "open"), sql`${orgProposals.expiresAt} <= now()`))
    .returning({ id: orgProposals.id, orgId: orgProposals.orgId });
  if (expired.length > 0) {
    await db.insert(orgEvents).values(
      expired.map((p) => ({
        orgId: p.orgId,
        actorId: null,
        type: "proposal_expired" as const,
        data: { proposalId: p.id },
      })),
    );
  }
  return expired.length;
}

/* -------------------------------- Standing ---------------------------------- */

export type OrgStanding = {
  completed: number;
  undertaken: number;
  completionPct: number | null;
  volume: number;
};

/**
 * An org's trading record, over sales it was a party to.
 *
 * Deliberately not averaged from members' personal records: their trades are their own, and
 * an org that has never traded should read as new rather than inheriting the reputation of
 * whoever happened to join it.
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
