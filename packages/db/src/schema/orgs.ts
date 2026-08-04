import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./orders";

/**
 * Orgs, derived from RSI rather than invented here.
 *
 * An org is not something a user creates on KCX. It appears the moment a verified trader's
 * public RSI profile names it as their main org, and its roster is whatever set of verified
 * traders currently name it. Nobody adds or removes members — you join an org on RSI.
 *
 * That removes the whole class of abuse where somebody registers a name they have nothing to
 * do with. What it does NOT settle is who speaks for the org, which is what everything below
 * is about.
 *
 * ---------------------------------------------------------------------------------------
 * THE TWO CREDENTIALS
 *
 * 1. **Rank stars (0–5)**, read off each member's dossier. Set by the org's real leadership
 *    on RSI, not by the member, so it cannot be self-awarded. Used only to decide who is
 *    PRESUMED to lead before anything is proven, and compared strictly within one org —
 *    plenty of orgs hand everyone five stars.
 *
 * 2. **The charter code.** The org's RSI page carries a Charter/History/Manifesto that only
 *    org admins can edit. Pasting a KCX code there proves control of the org itself, exactly
 *    as pasting one in a bio proves control of a handle. Whoever completes it becomes the
 *    charter holder, and their word then overrides the star ranking entirely.
 *
 * An org cannot touch the market until (2) has happened. A roster with no proven leader is a
 * list of people, not a trading entity — so there is no window in which someone can point a
 * treasury at the board on the strength of having signed up first.
 */

export const ORG_STATUSES = [
  /** Auto-created from a member's profile. Roster only; cannot transact. */
  "derived",
  /** A leadership claim is outstanding with a code to paste into the org charter. */
  "pending",
  /** Charter proven. The org can hold a treasury and trade. */
  "verified",
  /** Withdrawn by a moderator. Trading stops; the roster stays. */
  "suspended",
] as const;

/**
 * Three roles, as asked, and each is acquired a different way — which is the point.
 *
 * `member` is derived and cannot be refused. `president` is proven. `treasurer` is granted
 * by the president and can be taken back instantly. Nobody can self-declare into the two
 * that touch money.
 */
export const ORG_ROLES = ["president", "treasurer", "member"] as const;

export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** RSI org SID, uppercase. The durable identity, and the join key from every profile. */
    sid: text("sid").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ORG_STATUSES }).notNull().default("derived"),

    /**
     * The verified leader. Null until the charter code is completed.
     *
     * Their authority is absolute inside the org and beats the derived star ranking — that
     * ranking only ever decides who is presumed to lead while nothing is proven.
     */
    charterHolderId: uuid("charter_holder_id").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Set when a moderator granted or moved leadership by hand rather than by code. */
    verifiedByModId: uuid("verified_by_mod_id").references(() => users.id),
    suspendedReason: text("suspended_reason"),

    /** Cached from RSI on verification. Bare filename, served from the `orgs` bucket. */
    logoFilename: text("logo_filename"),

    /**
     * Self-declared aUEC held by the org, on the same footing as a personal balance. KCX
     * never holds it; what it enforces is that the org can't promise more than it says.
     */
    treasury: bigint("treasury", { mode: "number" }).notNull().default(0),
    description: text("description"),

    /**
     * Board approvals.
     *
     * `boardThreshold` is how many board members OTHER than the proposer must agree before
     * an org-attributed transaction goes ahead; 0 disables the board entirely.
     * `boardMinValue` is the figure at or above which approval kicks in, so an org can let
     * small purchases through and gate the big ones.
     *
     * The president sets both. Notably they cannot approve a proposal single-handedly — a
     * board the president can bypass constrains nothing. They control the RULES, not the
     * individual outcome, and lowering the threshold is visible and only applies going
     * forward.
     */
    boardThreshold: smallint("board_threshold").notNull().default(0),
    boardMinValue: bigint("board_min_value", { mode: "number" }).notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orgs_sid").on(t.sid),
    index("orgs_status").on(t.status),
    check("orgs_treasury_non_negative", sql`${t.treasury} >= 0`),
    check("orgs_board_threshold_range", sql`${t.boardThreshold} BETWEEN 0 AND 10`),
    check("orgs_board_min_non_negative", sql`${t.boardMinValue} >= 0`),
    /**
     * Status and leadership must agree — but only where they actually can.
     *
     * `verified` requires a holder, and `derived`/`pending` must not have one. `suspended`
     * is deliberately exempt: suspension stops an org TRADING, it does not unseat its
     * president, and an org reinstated after a dispute should come back to the leader it
     * had. An earlier iff-shaped version of this rule made suspending a verified org
     * impossible, which the org checks caught.
     */
    check(
      "orgs_status_matches_holder",
      sql`(${t.status} = 'verified' AND ${t.charterHolderId} IS NOT NULL)
          OR (${t.status} IN ('derived','pending') AND ${t.charterHolderId} IS NULL)
          OR ${t.status} = 'suspended'`,
    ),
  ],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ORG_ROLES }).notNull().default("member"),

    /** Read off the member's dossier. The org's own rank name — free text, shown not compared. */
    rsiRank: text("rsi_rank"),
    /** RSI's 0–5 scale. The credential the member cannot award themselves. */
    rsiRankStars: smallint("rsi_rank_stars"),

    /**
     * Designated by the president to sit on the board. Kept separate from `role` because a
     * board seat is about approving spending, not about being able to spend — an org may
     * well want ordinary members watching the treasurer.
     */
    isBoardMember: boolean("is_board_member").notNull().default(false),

    /**
     * The most of the treasury a treasurer may have committed at once. Null = no cap, which
     * only makes sense for the president.
     */
    spendLimit: bigint("spend_limit", { mode: "number" }),

    /**
     * When we last saw this membership on their live RSI profile.
     *
     * Spending authority goes stale — see ORG_AUTHORITY_STALE_DAYS. Somebody who left the
     * org three months ago should not still be able to spend its money just because nobody
     * noticed, and re-verification is the only thing that can tell us they are still there.
     */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_members_once").on(t.orgId, t.userId),
    index("org_members_user").on(t.userId),
    /** Ranking the presumed leader: highest stars within an org. */
    index("org_members_rank").on(t.orgId, t.rsiRankStars),
    check("org_members_limit_positive", sql`${t.spendLimit} IS NULL OR ${t.spendLimit} >= 0`),
    check("org_members_stars_range", sql`${t.rsiRankStars} IS NULL OR ${t.rsiRankStars} BETWEEN 0 AND 5`),
  ],
);

export const ORG_VERIFICATION_STATUSES = ["pending", "verified", "failed", "expired"] as const;

/**
 * A leadership claim, proven by pasting a code into the org's public RSI charter.
 *
 * The same mechanism as handle verification, pointed at a different page: only an org admin
 * can edit the Charter, History or Manifesto, so a code appearing there proves control of
 * the org rather than merely membership of it.
 */
export const orgVerifications = pgTable(
  "org_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    /** The member claiming leadership. */
    claimantId: uuid("claimant_id")
      .notNull()
      .references(() => users.id),
    code: text("code").notNull(),
    status: text("status", { enum: ORG_VERIFICATION_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One live claim per org — a queue of competing codes helps nobody. */
    uniqueIndex("org_verifications_live").on(t.orgId).where(sql`${t.status} = 'pending'`),
    index("org_verifications_claimant").on(t.claimantId),
  ],
);

export const ORG_PROPOSAL_KINDS = [
  /** Post something for sale, or a wanted ad, in the org's name. */
  "bazaar_listing",
  /** Take a listing, or accept an offer, with org money. */
  "bazaar_purchase",
  /** Issue a service contract in the org's name. */
  "service_contract",
  /** Change the declared treasury. */
  "treasury",
] as const;

export const ORG_PROPOSAL_STATUSES = ["open", "approved", "executed", "rejected", "expired", "failed"] as const;

/**
 * Something an org member wants to do with org money, waiting on the board.
 *
 * The proposal holds the INTENT — the same payload the ordinary endpoint would have taken —
 * and the existing code path runs unchanged once quorum is reached. Wrapping the intent
 * rather than reimplementing each action means the board can never diverge from what the
 * non-board path does.
 */
export const orgProposals = pgTable(
  "org_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    proposedById: uuid("proposed_by_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ORG_PROPOSAL_KINDS }).notNull(),
    /** What it costs the org, and what the threshold is tested against. */
    value: bigint("value", { mode: "number" }).notNull().default(0),
    summary: text("summary").notNull(),
    /** The action's arguments, replayed verbatim on execution. */
    payload: jsonb("payload").notNull().default({}),

    status: text("status", { enum: ORG_PROPOSAL_STATUSES }).notNull().default("open"),
    /** Copied from the org at proposal time: changing the rules must not retune live votes. */
    requiredApprovals: smallint("required_approvals").notNull(),
    /** What executing it produced — a listing id, a sale id — for the audit trail. */
    resultRef: text("result_ref"),
    failureReason: text("failure_reason"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("org_proposals_org").on(t.orgId, t.status, t.createdAt),
    check("org_proposals_value_non_negative", sql`${t.value} >= 0`),
    check("org_proposals_required_positive", sql`${t.requiredApprovals} > 0`),
  ],
);

export const orgProposalApprovals = pgTable(
  "org_proposal_approvals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => orgProposals.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => users.id),
    /** False = an explicit objection, which is worth recording separately from silence. */
    approve: boolean("approve").notNull().default(true),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One vote each. Revising means updating it, not stacking. */
    uniqueIndex("org_proposal_approvals_once").on(t.proposalId, t.memberId),
  ],
);

export const ORG_EVENT_TYPES = [
  "discovered",
  "member_joined",
  "member_left",
  "rank_changed",
  "verification_started",
  "verified",
  "verification_failed",
  "leadership_transferred",
  "mod_granted",
  "mod_revoked",
  "suspended",
  "reinstated",
  "role_changed",
  "board_changed",
  "limit_changed",
  "treasury_set",
  "proposal_opened",
  "proposal_approved",
  "proposal_rejected",
  "proposal_executed",
  "proposal_expired",
] as const;

/** Append-only. Who let whom spend what is exactly the thing orgs argue about later. */
export const orgEvents = pgTable(
  "org_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    actorId: uuid("actor_id").references(() => users.id),
    subjectId: uuid("subject_id").references(() => users.id),
    type: text("type", { enum: ORG_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("org_events_org").on(t.orgId, t.createdAt)],
);
