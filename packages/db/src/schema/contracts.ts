import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
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
import { gameVersions, locations } from "./market";
import { users } from "./orders";

/**
 * Service contracts — player-written work, not commodity trades.
 *
 * "Haul 400 SCU from Lorville to Area 18", "escort me through Pyro", "salvage this wreck".
 * The issuer names the job and the payout; an executor claims it, does the work in-game,
 * and both sides confirm before aUEC moves.
 *
 * Deliberately separate from `trades` (the commodity escrow): the work is freeform, the
 * payout is one-directional, and — per the exchange's design — a hauler's reliability on
 * jobs is a different reputation from a trader's reliability on cargo. Someone can be an
 * excellent merchant and an unreliable escort.
 */

export const CONTRACT_CATEGORIES = [
  "hauling",
  "escort",
  "mining",
  "salvage",
  "medical",
  "combat",
  "exploration",
  "other",
] as const;

export const CONTRACT_STATUSES = [
  /** Posted at a fixed payout, nobody has taken it. */
  "open",
  /** Out for bid; sealed bids accepted until bids_close_at. */
  "bidding",
  /** Bidding closed and a winner picked, waiting on them to accept. */
  "awarded",
  /** Claimed by an executor and locked from others. */
  "in_progress",
  /** Both sides confirmed; payout transferred. */
  "completed",
  /** Withdrawn or abandoned before completion. */
  "cancelled",
  /** Deadline passed without completion. */
  "expired",
] as const;

/** Statuses in which the issuer is still on the hook for the money. */
export const CONTRACT_LIVE_STATUSES = ["open", "bidding", "awarded", "in_progress"] as const;

export const CONTRACT_PRICING_MODES = [
  /** Issuer names the payout; first executor to claim it takes the job. */
  "fixed",
  /** Reverse auction: the payout is a ceiling and the lowest sealed bid wins. */
  "bid",
] as const;

export const CONTRACT_VISIBILITIES = [
  "public",
  /**
   * Details withheld until someone takes the job. Title, category and payout stay
   * visible — a contract nobody can see is a contract nobody can accept — but the
   * description, image and location are never sent to anyone but the issuer, the
   * executor (or awarded winner) and moderators.
   */
  "classified",
] as const;

export const serviceContracts = pgTable(
  "service_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => users.id),
    /** Null until claimed. */
    executorId: uuid("executor_id").references(() => users.id),
    /** Patch-scoped like everything else: cargo and context die at each game patch. */
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),

    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: CONTRACT_CATEGORIES }).notNull().default("other"),
    /**
     * Payment in aUEC, held as a commitment against the issuer's balance.
     *
     * In `fixed` mode this is the agreed price. In `bid` mode it is the CEILING — the most
     * the issuer is willing to pay — and the winning bid lands in `awardedAmount`. Both are
     * kept: the ceiling is the audit trail of what was advertised, and settlement always
     * pays `coalesce(awarded_amount, payout)`.
     */
    payout: bigint("payout", { mode: "number" }).notNull(),
    locationId: integer("location_id").references(() => locations.id),

    pricingMode: text("pricing_mode", { enum: CONTRACT_PRICING_MODES }).notNull().default("fixed"),
    visibility: text("visibility", { enum: CONTRACT_VISIBILITIES }).notNull().default("public"),

    /** Bid mode: when sealed bidding closes and a winner is picked. */
    bidsCloseAt: timestamp("bids_close_at", { withTimezone: true }),
    /** How long the winner has to accept before the award cascades to the next bidder. */
    awardResponseHours: integer("award_response_hours"),
    /** Set at award time; null again if they decline and it moves on. */
    awardedToId: uuid("awarded_to_id").references(() => users.id),
    awardedAmount: bigint("awarded_amount", { mode: "number" }),
    awardExpiresAt: timestamp("award_expires_at", { withTimezone: true }),
    /**
     * Generated filename of an attached screenshot — a target, a wreck, cargo on a pad.
     * Stored as a bare name, never a path or URL, so nothing user-supplied is ever
     * interpolated into a filesystem lookup.
     */
    imageFilename: text("image_filename"),

    status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("open"),
    /** Dual confirmation, exactly as commodity escrow works — neither side alone settles. */
    issuerConfirmedAt: timestamp("issuer_confirmed_at", { withTimezone: true }),
    executorConfirmedAt: timestamp("executor_confirmed_at", { withTimezone: true }),

    /** Deadline for the whole job: unclaimed or unfinished by then, it expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contracts_board").on(t.status, t.createdAt),
    index("contracts_issuer").on(t.issuerId, t.status),
    index("contracts_executor").on(t.executorId, t.status),
    /** The sweep looks up contracts whose bidding window or award window has run out. */
    index("contracts_bids_close").on(t.bidsCloseAt),
    index("contracts_award_expiry").on(t.awardExpiresAt),
    check("contracts_payout_positive", sql`${t.payout} > 0`),
    /** A winning bid can never exceed the advertised ceiling. */
    check("contracts_award_within_ceiling", sql`${t.awardedAmount} IS NULL OR ${t.awardedAmount} <= ${t.payout}`),
    check("contracts_award_positive", sql`${t.awardedAmount} IS NULL OR ${t.awardedAmount} > 0`),
    /** Bid mode is meaningless without a close time; fixed mode must not carry one. */
    check(
      "contracts_bid_mode_has_window",
      sql`(${t.pricingMode} = 'bid') = (${t.bidsCloseAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Sealed bids on a contract in `bid` mode.
 *
 * Sealed on purpose: bidders see the count, never each other's numbers. An open book on a
 * reverse auction turns into last-second undercutting by one aUEC, which is the same
 * dynamic the order board's price bands exist to prevent — and it punishes whoever bids
 * honestly first. Amounts become visible once bidding closes.
 *
 * Bidders post no collateral. They are selling labour, not money; the issuer is the only
 * party with something to back, and their ceiling is committed for the whole window.
 */
export const CONTRACT_BID_STATUSES = [
  "active",
  "withdrawn",
  "won",
  "lost",
  /** Won it, then declined or let the acceptance window lapse. */
  "passed",
] as const;

export const contractBids = pgTable(
  "contract_bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => serviceContracts.id),
    bidderId: uuid("bidder_id")
      .notNull()
      .references(() => users.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    note: text("note"),
    status: text("status", { enum: CONTRACT_BID_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One bid per person per contract — revising means updating it, not stacking them. */
    uniqueIndex("contract_bids_one_per_bidder").on(t.contractId, t.bidderId),
    /** Winner selection reads this: lowest amount, earliest first on a tie. */
    index("contract_bids_ranking").on(t.contractId, t.amount, t.createdAt),
    check("contract_bids_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const CONTRACT_EVENT_TYPES = [
  "created",
  "claimed",
  "released",
  "confirmed_by_executor",
  "confirmed_by_issuer",
  "completed",
  "cancelled",
  "expired",
  // --- reverse auction ---
  "bid_placed",
  "bid_revised",
  "bid_withdrawn",
  "bidding_closed",
  "awarded",
  "award_accepted",
  "award_declined",
  /** Winner never answered inside their window. */
  "award_lapsed",
  /** Every bidder declined or lapsed; nothing left to cascade to. */
  "bidding_exhausted",
] as const;

/** Append-only audit trail; contract state is always reconstructible from these. */
export const contractEvents = pgTable(
  "contract_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => serviceContracts.id),
    /** null = system (the expiry sweep). */
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type", { enum: CONTRACT_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contract_events_contract").on(t.contractId, t.createdAt)],
);

/**
 * Ratings for completed service contracts, kept in their own table so contract standing
 * never mixes with commodity-trading standing.
 */
export const contractRatings = pgTable(
  "contract_ratings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => serviceContracts.id),
    raterId: uuid("rater_id")
      .notNull()
      .references(() => users.id),
    ratedId: uuid("rated_id")
      .notNull()
      .references(() => users.id),
    stars: smallint("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contract_ratings_once").on(t.contractId, t.raterId),
    index("contract_ratings_rated").on(t.ratedId),
    check("contract_ratings_stars_range", sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);
