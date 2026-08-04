import { integer, numeric, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Immutable price time-series, PARTITIONED BY RANGE (captured_at) with monthly partitions.
 *
 * ⚠ This file is deliberately EXCLUDED from drizzle-kit (drizzle.config.ts points at
 * market.ts only) because drizzle-kit cannot express declarative partitioning — pushing
 * this table would create it unpartitioned. The parent table, partitions, and BRIN index
 * are created/maintained by apps/server's `ensureSnapshotInfra()` (see jobs/partitions.ts),
 * which runs at boot and monthly. This definition exists purely for typed queries.
 */
export const uexPriceSnapshots = pgTable("uex_price_snapshots", {
  terminalId: integer("terminal_id").notNull(),
  commodityId: integer("commodity_id").notNull(),
  priceBuy: numeric("price_buy", { precision: 12, scale: 2 }),
  priceSell: numeric("price_sell", { precision: 12, scale: 2 }),
  scuBuy: integer("scu_buy"),
  scuSell: integer("scu_sell"),
  scuSellStock: integer("scu_sell_stock"),
  statusBuy: smallint("status_buy"),
  statusSell: smallint("status_sell"),
  sourceScore: integer("source_score"),
  gameVersion: text("game_version"),
  uexDateModified: timestamp("uex_date_modified", { withTimezone: true }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
});
