import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { commodities } from "./market";
import { orgs } from "./orgs";
import { users } from "./orders";

/**
 * Market makers: traders who commit to quoting both sides of a commodity.
 *
 * The order board already lets anyone post a buy or a sell. What it cannot express is
 * somebody saying "I will be here, on both sides, at a spread" — and that is the difference
 * between a board with prices on it and a market you can actually clear against. A trader
 * who needs to move 400 SCU of Titanium right now cares less about the best price showing
 * than about whether anyone will still be there in an hour.
 *
 * A quote is backed the way everything else on KCX is: the bid side commits aUEC, the ask
 * side commits declared cargo. What is new is that the commitment is standing, two-sided,
 * and measured.
 *
 * None of it is an obligation KCX can force — settlement happens in-game. What it can do is
 * record who actually stayed, so "reliable market maker" is a checkable claim rather than a
 * badge someone awards themselves.
 */

export const MAKER_STATUSES = [
  /** Quoting. Both sides live and collateralised. */
  "active",
  /** Stood down deliberately. Honest, and visibly different from vanishing. */
  "paused",
  "retired",
] as const;

export const marketMakerQuotes = pgTable(
  "market_maker_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Set when quoting for an org; the treasury backs the bid side. */
    orgId: uuid("org_id").references(() => orgs.id),
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),

    /** What they'll pay, and what they'll sell at. The gap is the spread. */
    bidPrice: bigint("bid_price", { mode: "number" }).notNull(),
    askPrice: bigint("ask_price", { mode: "number" }).notNull(),
    /** How much they'll do at those prices, per side. */
    bidSizeScu: integer("bid_size_scu").notNull(),
    askSizeScu: integer("ask_size_scu").notNull(),

    status: text("status", { enum: MAKER_STATUSES }).notNull().default("active"),

    /**
     * Uptime, in whole minutes.
     *
     * `activeMinutes` accumulates time spent quoting; `committedSince` marks when the
     * current stretch began and is folded in whenever the quote pauses or retires. An
     * accumulator plus one open interval, rather than a derivation over an event log,
     * because this is rendered beside every quote and needs to be a single cheap read.
     */
    activeMinutes: integer("active_minutes").notNull().default(0),
    committedSince: timestamp("committed_since", { withTimezone: true }),

    /** Fills honoured while quoting — the other half of whether the commitment was real. */
    fillsHonoured: integer("fills_honoured").notNull().default(0),
    scuHonoured: integer("scu_honoured").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One quote per maker per commodity — revising means editing it, not stacking. */
    uniqueIndex("maker_quotes_one_per_commodity").on(t.userId, t.commodityId),
    index("maker_quotes_commodity").on(t.commodityId, t.status),
    index("maker_quotes_user").on(t.userId, t.status),
    check("maker_quotes_prices_positive", sql`${t.bidPrice} > 0 AND ${t.askPrice} > 0`),
    check("maker_quotes_sizes_positive", sql`${t.bidSizeScu} > 0 AND ${t.askSizeScu} > 0`),
    /**
     * The ask must exceed the bid. A crossed quote — selling below what you'll pay — is
     * either a mistake or an invitation to be arbitraged to zero by the first person who
     * notices, and neither is worth storing.
     */
    check("maker_quotes_not_crossed", sql`${t.askPrice} > ${t.bidPrice}`),
  ],
);
