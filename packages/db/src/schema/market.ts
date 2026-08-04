import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Market-side schema (M1 scope): master data snapshotted from UEX + the latest-prices
 * fast path. The partitioned uex_price_snapshots time-series arrives in M2 as a raw SQL
 * migration (drizzle doesn't model declarative partitioning).
 *
 * Money convention: player-facing aUEC is integer bigint everywhere; UEX reference
 * decimals live only in price tables as numeric(12,2).
 */

/** Seasons. Every game patch is a season boundary (all patches destroy cargo). */
export const gameVersions = pgTable(
  "game_versions",
  {
    id: serial("id").primaryKey(),
    version: text("version").notNull().unique(),
    isWipe: boolean("is_wipe").notNull().default(false),
    status: text("status", { enum: ["upcoming", "active", "ended"] })
      .notNull()
      .default("upcoming"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    liveAt: timestamp("live_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("one_active_season").on(t.status).where(sql`${t.status} = 'active'`)],
);

export const commodities = pgTable("commodities", {
  id: serial("id").primaryKey(),
  uexId: integer("uex_id").unique(),
  uexUuid: text("uex_uuid"),
  /** scunpacked game-file UUID; joined in a later milestone. */
  gameUuid: text("game_uuid"),
  /** UEX ticker-style label (AGRI, GOLD…). NOT unique upstream — raw vs refined variants share codes. */
  code: text("code").notNull(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind"),
  /** Market sector code (METL, MINR, …) derived from kind at sync time — see @kcx/shared sectors. */
  sector: text("sector").notNull().default("MISC"),
  tier: smallint("tier"),
  weightScu: numeric("weight_scu", { precision: 10, scale: 4 }),
  isIllegal: boolean("is_illegal").notNull().default(false),
  isRaw: boolean("is_raw").notNull().default(false),
  isRefined: boolean("is_refined").notNull().default(false),
  /** false = present in data but hidden from the board/terminal. */
  isTradable: boolean("is_tradable").notNull().default(true),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  /** Verbatim upstream payload(s) for forward-compat; never a query target. */
  raw: jsonb("raw").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single self-referencing hierarchy: system → planet → moon; stations/outposts/cities attach wherever they orbit. */
export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    uexId: integer("uex_id").notNull(),
    type: text("type", {
      enum: ["star_system", "planet", "moon", "city", "space_station", "outpost"],
    }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    parentId: integer("parent_id"),
    isAvailable: boolean("is_available").notNull().default(true),
    raw: jsonb("raw").notNull().default({}),
  },
  (t) => [uniqueIndex("locations_type_uex").on(t.type, t.uexId), index("locations_parent").on(t.parentId)],
);

export const terminals = pgTable(
  "terminals",
  {
    id: serial("id").primaryKey(),
    uexId: integer("uex_id").unique(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    locationId: integer("location_id").references(() => locations.id),
    terminalType: text("terminal_type"),
    isAvailable: boolean("is_available").notNull().default(true),
    raw: jsonb("raw").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("terminals_location").on(t.locationId)],
);

/**
 * One row per commodity per ingest capture: the commodity's market-wide NPC baseline
 * (best sell-to payout, cheapest buy-from) computed from the FULL terminal_prices_latest
 * state — never from deduped snapshots, which only contain changed rows. Candles build
 * from this series. ~162 rows × 48 captures/day ≈ 234k rows/month.
 */
export const commodityReferencePoints = pgTable(
  "commodity_reference_points",
  {
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    bestSell: numeric("best_sell", { precision: 12, scale: 2 }),
    bestBuy: numeric("best_buy", { precision: 12, scale: 2 }),
    sellTerminals: integer("sell_terminals").notNull().default(0),
    buyTerminals: integer("buy_terminals").notNull().default(0),
    /**
     * The KCX mark: what the market says this is worth. Equals the NPC baseline until
     * players actually fill orders, then follows the volume-weighted print price.
     * This — not the raw baseline — is what the candles and sector indices track.
     */
    marketPrice: numeric("market_price", { precision: 14, scale: 2 }),
    /** How many non-excluded prints fed the mark (0 = pure NPC baseline). */
    printCount: integer("print_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.commodityId, t.capturedAt] })],
);

/**
 * NPC-baseline OHLC per commodity per bucket, derived from commodity_reference_points.
 * "sell" series = best sell-to-terminal payout across all terminals at each capture;
 * "buy" series = cheapest buy-from-terminal price. Rebuilt incrementally after each ingest.
 */
export const referenceCandles = pgTable(
  "reference_candles",
  {
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    period: text("period", { enum: ["1h", "1d"] }).notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    sellOpen: numeric("sell_open", { precision: 12, scale: 2 }),
    sellHigh: numeric("sell_high", { precision: 12, scale: 2 }),
    sellLow: numeric("sell_low", { precision: 12, scale: 2 }),
    sellClose: numeric("sell_close", { precision: 12, scale: 2 }),
    buyOpen: numeric("buy_open", { precision: 12, scale: 2 }),
    buyHigh: numeric("buy_high", { precision: 12, scale: 2 }),
    buyLow: numeric("buy_low", { precision: 12, scale: 2 }),
    buyClose: numeric("buy_close", { precision: 12, scale: 2 }),
    /** KCX mark OHLC — the candles users actually see; diverges from baseline on fills. */
    mktOpen: numeric("mkt_open", { precision: 14, scale: 2 }),
    mktHigh: numeric("mkt_high", { precision: 14, scale: 2 }),
    mktLow: numeric("mkt_low", { precision: 14, scale: 2 }),
    mktClose: numeric("mkt_close", { precision: 14, scale: 2 }),
    /** Number of ingest captures inside the bucket — honesty metric for sparse data. */
    samples: integer("samples").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commodityId, t.period, t.bucketStart] })],
);

/**
 * Market index series: base-1000 equal-weight index per sector per capture (KCXC = composite).
 * Value = 1000 × mean(best_sell / first-seen best_sell) over the sector's constituents.
 * Rebuilt alongside candles after each ingest; recomputed idempotently on conflict.
 */
export const marketIndexPoints = pgTable(
  "market_index_points",
  {
    sector: text("sector").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    value: numeric("value", { precision: 14, scale: 4 }).notNull(),
    constituents: integer("constituents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sector, t.capturedAt] })],
);

/** Poller audit trail: one row per ingest attempt, verbatim stats + error. */
export const uexPollRuns = pgTable("uex_poll_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  endpoint: text("endpoint").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowsFetched: integer("rows_fetched"),
  rowsUpserted: integer("rows_upserted"),
  status: text("status", { enum: ["ok", "partial", "error"] }).notNull(),
  error: text("error"),
});

/**
 * The fast-read path: current NPC price per (terminal, commodity). Every "current price"
 * page reads ONLY this table (≤10k rows). History/charts read the snapshot series (M2).
 */
export const terminalPricesLatest = pgTable(
  "terminal_prices_latest",
  {
    terminalId: integer("terminal_id")
      .notNull()
      .references(() => terminals.id),
    commodityId: integer("commodity_id")
      .notNull()
      .references(() => commodities.id),
    priceBuy: numeric("price_buy", { precision: 12, scale: 2 }),
    priceBuyMin: numeric("price_buy_min", { precision: 12, scale: 2 }),
    priceBuyMax: numeric("price_buy_max", { precision: 12, scale: 2 }),
    priceBuyAvg: numeric("price_buy_avg", { precision: 12, scale: 2 }),
    priceSell: numeric("price_sell", { precision: 12, scale: 2 }),
    priceSellMin: numeric("price_sell_min", { precision: 12, scale: 2 }),
    priceSellMax: numeric("price_sell_max", { precision: 12, scale: 2 }),
    priceSellAvg: numeric("price_sell_avg", { precision: 12, scale: 2 }),
    scuBuy: integer("scu_buy"),
    scuSell: integer("scu_sell"),
    scuSellStock: integer("scu_sell_stock"),
    statusBuy: smallint("status_buy"),
    statusSell: smallint("status_sell"),
    /** UEX crowdsource quality score, 0–1000. Surfaced to users as freshness/confidence. */
    sourceScore: integer("source_score"),
    gameVersion: text("game_version"),
    uexDateModified: timestamp("uex_date_modified", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.terminalId, t.commodityId] }),
    index("tpl_commodity").on(t.commodityId),
  ],
);
