import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  check,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { commodities, gameVersions, locations } from "./market";

/**
 * Player order board. Orders are LISTINGS, not a matching engine: they are posted,
 * discovered, and settled in-game bilaterally (see the tranche protocol). Nothing here
 * ever moves aUEC.
 *
 * Price policy: player prices are NEVER validated or clamped against the NPC baseline.
 * Any price, above or below market, is legitimate — the baseline is shown as context only.
 */

/**
 * Minimal user record. M5 extends this with Discord OAuth + RSI bio-code verification;
 * `handle` is the RSI handle (stored lowercased) and is the durable identity across wipes.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull().unique(),
  displayName: text("display_name").notNull(),
  discordId: text("discord_id").unique(),
  role: text("role", { enum: ["user", "mod", "admin"] })
    .notNull()
    .default("user"),
  /** True once the RSI handle is proven via profile-bio code (M5). Gates posting. */
  isVerified: boolean("is_verified").notNull().default(false),
  rsiVerifiedAt: timestamp("rsi_verified_at", { withTimezone: true }),
  /**
   * Signals lifted from the public RSI profile at verification time. An account enlisted
   * years ago with an org history is expensive to fabricate — this is the backbone of
   * alt-account resistance, since KCX can't see anything in-game.
   */
  enlistedAt: timestamp("enlisted_at", { withTimezone: true }),
  citizenRecord: text("citizen_record"),
  mainOrgSid: text("main_org_sid"),
  avatarUrl: text("avatar_url"),
  /**
   * Self-declared aUEC on hand. The game exposes no wallet data (verified empirically),
   * so this is the trader's own figure — but it IS the collateral the exchange enforces
   * buy orders against, so it must live server-side, not in the browser.
   */
  auecBalance: bigint("auec_balance", { mode: "number" }).notNull().default(0),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Declared cargo on hand. Sell orders are collateralised against this — no naked selling. */
export const userHoldings = pgTable(
  "user_holdings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    scu: integer("scu").notNull(),
    /** Weighted average aUEC/SCU paid; optional, powers P/L. */
    avgCost: bigint("avg_cost", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.commodityId] })],
);

export const ORDER_SIDES = ["buy", "sell"] as const;
export const ORDER_STATUSES = [
  "active",
  "paused",
  /** Fully filled — produced a print that moves the market price. */
  "filled",
  "completed",
  "cancelled",
  /** Hit its fill-by deadline with no fill: resolved with ZERO market impact. */
  "expired_unfilled",
  "expired_season",
  "removed",
] as const;

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /** Orders are patch-scoped: every game patch destroys cargo, so open orders expire. */
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    /** buy = WTB (poster wants to acquire), sell = WTS (poster has cargo to move). */
    side: text("side", { enum: ORDER_SIDES }).notNull(),
    pricePerScu: bigint("price_per_scu", { mode: "number" }).notNull(),
    quantityScu: integer("quantity_scu").notNull(),
    remainingScu: integer("remaining_scu").notNull(),
    minFillScu: integer("min_fill_scu").notNull().default(1),
    locationId: integer("location_id").references(() => locations.id),
    locationFlexible: boolean("location_flexible").notNull().default(true),
    notes: text("notes"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Board sort key; bump is rate-limited in the API. */
    bumpedAt: timestamp("bumped_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Trader-set fill-by deadline. On lapse the order resolves `expired_unfilled` and
     * contributes NOTHING to price history — only fills move the market.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    filledScu: integer("filled_scu").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    /**
     * SCU locked in open escrow contracts. Board availability is remaining − reserved, so
     * a claimed order stops attracting other traders until the contract settles or releases.
     */
    reservedScu: integer("reserved_scu").notNull().default(0),
  },
  (t) => [
    index("orders_board").on(t.commodityId, t.side, t.pricePerScu).where(sql`${t.status} = 'active'`),
    index("orders_owner").on(t.ownerId, t.status),
    index("orders_season").on(t.seasonId, t.status),
  ],
);

export const ORDER_EVENT_TYPES = [
  "created",
  "edited",
  "paused",
  "resumed",
  "bumped",
  "refreshed",
  "filled",
  "cancelled",
  "completed",
  "expired_unfilled",
  "expired_season",
  "removed_by_mod",
] as const;

/** Append-only audit spine — order state is always reconstructible from these. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /** null = system (TTL sweep, season rollover). */
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type", { enum: ORDER_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order").on(t.orderId, t.createdAt)],
);

export const TRADE_STATUSES = [
  /** Locked: quantity reserved, order hidden from other traders. */
  "escrow",
  /** Both parties confirmed — goods and aUEC moved, print written. */
  "settled",
  /** Either party backed out; reservation released, order republished. */
  "cancelled",
  /** Nobody confirmed before the deadline; released automatically. */
  "expired",
] as const;

/**
 * An escrow contract between the order's poster and the trader who claimed it.
 *
 * Claiming locks the quantity so a queue of hopefuls can't all chase the same cargo.
 * From there the contract only resolves two ways: BOTH parties confirm (settlement moves
 * goods and aUEC between them and prints to the tape), or it cancels/expires and the
 * order returns to the board untouched.
 */
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /** The order's poster. */
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /** The trader who claimed it. */
    claimerId: uuid("claimer_id")
      .notNull()
      .references(() => users.id),
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),
    /** Side from the ORDER OWNER's perspective (sell = owner ships cargo). */
    side: text("side", { enum: ORDER_SIDES }).notNull(),
    quantityScu: integer("quantity_scu").notNull(),
    pricePerScu: bigint("price_per_scu", { mode: "number" }).notNull(),
    status: text("status", { enum: TRADE_STATUSES }).notNull().default("escrow"),
    ownerConfirmedAt: timestamp("owner_confirmed_at", { withTimezone: true }),
    claimerConfirmedAt: timestamp("claimer_confirmed_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),
    /** Escrow deadline — prevents a claim from locking cargo indefinitely. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("trades_order").on(t.orderId),
    index("trades_owner").on(t.ownerId, t.status),
    index("trades_claimer").on(t.claimerId, t.status),
  ],
);

export const TRADE_EVENT_TYPES = [
  "claimed",
  "confirmed_by_owner",
  "confirmed_by_claimer",
  "settled",
  "cancelled",
  "expired",
] as const;

export const tradeEvents = pgTable(
  "trade_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tradeId: uuid("trade_id")
      .notNull()
      .references(() => trades.id),
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type", { enum: TRADE_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trade_events_trade").on(t.tradeId, t.createdAt)],
);

/**
 * The tape: one row per filled order. Prints — and only prints — pull the market price
 * away from the NPC baseline. Orders that expire unfilled never reach this table.
 *
 * `excluded` quarantines implausible prints from charts (kept for audit, never silently
 * dropped). M7 replaces owner-reported fills with dual counterparty confirmation.
 */
export const tradePrints = pgTable(
  "trade_prints",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),
    side: text("side", { enum: ORDER_SIDES }).notNull(),
    pricePerScu: bigint("price_per_scu", { mode: "number" }).notNull(),
    quantityScu: integer("quantity_scu").notNull(),
    excluded: boolean("excluded").notNull().default(false),
    exclusionReason: text("exclusion_reason"),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("prints_commodity_time").on(t.commodityId, t.executedAt).where(sql`NOT ${t.excluded}`)],
);

/**
 * Counterparty star rating, 1–5, left after a contract settles.
 *
 * Deliberately paired with the objective completion record (settled ÷ entered, computed
 * from `trades`): stars capture how someone was to deal with, the ratio captures whether
 * they actually follow through. Either alone is gameable — a trader can be charming and
 * unreliable, or reliable and abrasive.
 */
export const tradeRatings = pgTable(
  "trade_ratings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tradeId: uuid("trade_id")
      .notNull()
      .references(() => trades.id),
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
    // One rating per party per contract — no stacking votes on a single trade.
    uniqueIndex("trade_ratings_once").on(t.tradeId, t.raterId),
    index("trade_ratings_rated").on(t.ratedId),
    check("trade_ratings_stars_range", sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);
