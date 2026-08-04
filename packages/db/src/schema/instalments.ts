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
 * WHAT THIS IS NOT
 *
 * It is not a loan, and KCX is not a party to it. No interest, no fees, no third-party
 * lending, and aUEC only — real-money terms are banned outright by CIG and by this site.
 * The exchange holds nothing and lends nothing; it records a payment schedule two players
 * agreed and tracks whether they kept to it.
 *
 * That distinction is deliberate and load-bearing. UEX bans "banking or lending services...
 * or any system that mimics real-world monetary risk" on their marketplace, and they are
 * right to be careful. A payment schedule denominated in game currency, with no interest and
 * no lender, is a different object from a loan — but it is close enough that every guard
 * below exists to keep it on the right side of that line.
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

    /**
     * Total payable. Must equal the sale's total: an instalment plan changes WHEN the money
     * moves, never how much. Anything else is interest by another name.
     */
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
     * Between 2 and 12 payments. One isn't an instalment plan, and a schedule long enough to
     * outlive the patch it was agreed in is a dispute waiting to happen.
     */
    check("instalment_plans_count_range", sql`${t.instalmentCount} BETWEEN 2 AND 12`),
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
