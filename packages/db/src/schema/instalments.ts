import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bazaarSales } from "./bazaar";
import { users } from "./orders";

/**
 * Instalment plans on big-ticket bazaar sales.
 *
 * An economy without credit is barter. A 40-million-aUEC ship is out of reach for most
 * traders in one payment, and the deals that do happen for them happen entirely on trust in
 * a Discord DM with no record at all. This puts a schedule around that: agreed instalments,
 * each one dual-confirmed exactly like any other settlement, and a default that goes on the
 * record instead of into a screenshot.
 *
 * ------------------------------------------------------------------------------------
 * WHERE THE LINE NOW SITS
 *
 * Sellers set an interest rate. That is a deliberate change from the original design, which
 * charged nothing and leaned on "no interest" as the argument that this was a schedule
 * rather than credit. It no longer is that argument, and pretending otherwise in a comment
 * would be worse than the change itself.
 *
 * What remains true, and is what the guards below actually protect:
 *
 *  • **KCX is not a party and lends nothing.** No third party advances money; the buyer pays
 *    the seller directly, on a schedule the two of them agreed.
 *  • **aUEC only.** Real-money terms are banned outright by CIG and by this site.
 *  • **The rate is the seller's, advertised before either side agrees**, and fixed at
 *    acceptance. Nobody discovers the price of waiting after they have committed.
 *  • **Simple interest on the principal, once.** Not compounding — a headline rate you
 *    cannot check against what you end up paying is not a headline rate.
 *
 * Worth stating plainly: UEX bans "banking or lending services... or any system that mimics
 * real-world monetary risk" on their marketplace. An interest-bearing schedule is closer to
 * that line than the original design was. It is in-game currency between two players with no
 * lender in the middle, which is why it is defensible — but this is the feature most likely
 * to need withdrawing if it produces disputes faster than it produces trades.
 *
 * ------------------------------------------------------------------------------------
 * WHY THE GUARDS ARE WHERE THEY ARE
 *
 * The failure mode is obvious: someone takes delivery on a 10% deposit and vanishes. So the
 * goods do NOT change hands on the deposit. The seller keeps the item until the schedule
 * completes, exactly as layaway works, and both parties are told this in those words. A plan
 * that let a buyer walk away with the ship after one payment would be a scam generator, and
 * no amount of reputation tracking fixes that after the fact.
 *
 * Access is gated on identity and record — see INSTALMENT_MIN_* in queries/instalments.ts —
 * because the cheapest attack is a fresh account with nothing to lose.
 */

export const INSTALMENT_PLAN_STATUSES = [
  /** Proposed by one side, waiting on the other to accept the schedule. */
  "proposed",
  /** Both agreed; payments are running. */
  "active",
  /** Every instalment confirmed by both sides. The item changes hands now. */
  "completed",
  /** A payment was missed past its grace period. Counts against the buyer. */
  "defaulted",
  /** Called off by agreement before completion. */
  "cancelled",
] as const;

export const instalmentPlans = pgTable(
  "instalment_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The sale this schedule pays for. One plan per sale. */
    saleId: uuid("sale_id")
      .notNull()
      .references(() => bazaarSales.id),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    /** Who put the schedule forward; the other side accepts it. */
    proposedById: uuid("proposed_by_id")
      .notNull()
      .references(() => users.id),

    /** The sale price. What the goods cost before any charge for paying over time. */
    principal: bigint("principal", { mode: "number" }).notNull(),
    /**
     * The rate the SELLER demanded, in basis points (500 = 5.00%).
     *
     * Advertised on the proposal before either side agrees, and only the seller can set it —
     * a buyer proposing their own interest rate is not a thing anyone would honour.
     */
    baseRateBps: integer("base_rate_bps").notNull().default(0),
    /**
     * What was actually charged: the seller's rate plus the per-window step.
     *
     * Stored rather than recomputed because it is a term of the agreement. Changing the step
     * later must not retroactively alter what somebody already signed up to.
     */
    effectiveRateBps: integer("effective_rate_bps").notNull().default(0),
    interestAmount: bigint("interest_amount", { mode: "number" }).notNull().default(0),
    /** principal + interest. What the buyer actually pays across the schedule. */
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    instalmentCount: smallint("instalment_count").notNull(),
    /** Days between instalments, so the schedule is reconstructible. */
    intervalDays: smallint("interval_days").notNull(),

    status: text("status", { enum: INSTALMENT_PLAN_STATUSES }).notNull().default("proposed"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    defaultedAt: timestamp("defaulted_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instalment_plans_one_per_sale").on(t.saleId),
    index("instalment_plans_buyer").on(t.buyerId, t.status),
    index("instalment_plans_seller").on(t.sellerId, t.status),
    check("instalment_plans_total_positive", sql`${t.totalAmount} > 0`),
    /**
     * Between 2 and 24 windows. Not a view on how much credit is sensible — the seller
     * decides that by pricing it. The ceiling is mechanical: every window is a row, and a
     * proposal asking for ten thousand payments is a denial-of-service dressed as a purchase.
     */
    check("instalment_plans_count_range", sql`${t.instalmentCount} BETWEEN 2 AND 24`),
    check("instalment_plans_principal_positive", sql`${t.principal} > 0`),
    check("instalment_plans_rates_non_negative", sql`${t.baseRateBps} >= 0 AND ${t.effectiveRateBps} >= 0`),
    check("instalment_plans_interest_non_negative", sql`${t.interestAmount} >= 0`),
    /** The total has to be the two parts it is made of, or the schedule means nothing. */
    check("instalment_plans_total_is_sum", sql`${t.totalAmount} = ${t.principal} + ${t.interestAmount}`),
    check("instalment_plans_interval_range", sql`${t.intervalDays} BETWEEN 1 AND 30`),
    check("instalment_plans_distinct_parties", sql`${t.buyerId} <> ${t.sellerId}`),
  ],
);

export const INSTALMENT_STATUSES = [
  "due",
  /** Buyer says they've paid; waiting on the seller to agree. */
  "buyer_confirmed",
  /** Both confirmed. aUEC has moved. */
  "paid",
  /** Past its grace period unpaid. */
  "missed",
] as const;

/**
 * One scheduled payment.
 *
 * Rows are written up front for the whole schedule, so both parties can see every date and
 * amount at the moment they agree rather than discovering the next one as it arrives.
 *
 * Each is settled by the same dual confirmation as everything else on KCX: the buyer says
 * they paid, the seller agrees, and only then does the balance move. A single confirmation
 * moves nothing — the seller cannot mark a payment received that never arrived, and the
 * buyer cannot mark one made.
 */
export const instalments = pgTable(
  "instalments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => instalmentPlans.id),
    /** 1-based position in the schedule. */
    sequence: smallint("sequence").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: INSTALMENT_STATUSES }).notNull().default("due"),
    buyerConfirmedAt: timestamp("buyer_confirmed_at", { withTimezone: true }),
    sellerConfirmedAt: timestamp("seller_confirmed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instalments_sequence").on(t.planId, t.sequence),
    /** The sweep walks unpaid instalments past their grace period. */
    index("instalments_due").on(t.dueAt).where(sql`${t.status} IN ('due','buyer_confirmed')`),
    check("instalments_amount_positive", sql`${t.amount} > 0`),
    check("instalments_sequence_positive", sql`${t.sequence} > 0`),
  ],
);

/**
 * Defaults, kept permanently and separately from ordinary standing.
 *
 * A missed sale is someone who didn't turn up once. A default is someone who took a payment
 * schedule and stopped paying partway through, having already had value committed to them —
 * a different class of fact, and averaging it into a star rating would bury exactly the
 * thing a future counterparty needs to see.
 */
export const instalmentDefaults = pgTable(
  "instalment_defaults",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => instalmentPlans.id),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    /** How far they got before stopping — context a bare count would lose. */
    paidInstalments: integer("paid_instalments").notNull(),
    totalInstalments: integer("total_instalments").notNull(),
    amountPaid: bigint("amount_paid", { mode: "number" }).notNull(),
    amountOutstanding: bigint("amount_outstanding", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instalment_defaults_once").on(t.planId),
    index("instalment_defaults_buyer").on(t.buyerId),
  ],
);
