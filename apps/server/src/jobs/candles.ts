import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";

/**
 * Rebuild NPC-baseline OHLC candles for every bucket touched at/after `since`
 * (pass epoch 0 for a full backfill). Two passes: 1h and 1d.
 *
 * Source is commodity_reference_points — the per-capture, market-wide best-sell/best-buy
 * computed from the FULL latest-price state at ingest time. (The raw snapshot table is
 * deduped to changed rows only, so aggregating it per capture would mis-state the
 * market-wide best whenever only some terminals changed.)
 */
export async function rebuildCandlesSince(since: Date): Promise<void> {
  const db = getDb();
  for (const period of ["1h", "1d"] as const) {
    const trunc = period === "1h" ? "hour" : "day";
    await db.execute(sql`
      WITH bucketed AS (
        SELECT
          commodity_id,
          -- Explicit UTC: date_trunc on timestamptz otherwise truncates in the SESSION
          -- timezone, making bucket keys environment-dependent (and part of the PK).
          date_trunc(${sql.raw(`'${trunc}'`)}, captured_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket_start,
          (array_agg(best_sell ORDER BY captured_at ASC)  FILTER (WHERE best_sell IS NOT NULL))[1] AS sell_open,
          max(best_sell)                                                                           AS sell_high,
          min(best_sell)                                                                           AS sell_low,
          (array_agg(best_sell ORDER BY captured_at DESC) FILTER (WHERE best_sell IS NOT NULL))[1] AS sell_close,
          (array_agg(best_buy ORDER BY captured_at ASC)   FILTER (WHERE best_buy IS NOT NULL))[1]  AS buy_open,
          max(best_buy)                                                                            AS buy_high,
          min(best_buy)                                                                            AS buy_low,
          (array_agg(best_buy ORDER BY captured_at DESC)  FILTER (WHERE best_buy IS NOT NULL))[1]  AS buy_close,
          -- KCX mark: baseline until players fill orders, then driven by the print VWAP.
          (array_agg(coalesce(market_price, best_sell) ORDER BY captured_at ASC)
             FILTER (WHERE coalesce(market_price, best_sell) IS NOT NULL))[1]                      AS mkt_open,
          max(coalesce(market_price, best_sell))                                                   AS mkt_high,
          min(coalesce(market_price, best_sell))                                                   AS mkt_low,
          (array_agg(coalesce(market_price, best_sell) ORDER BY captured_at DESC)
             FILTER (WHERE coalesce(market_price, best_sell) IS NOT NULL))[1]                      AS mkt_close,
          count(*)                                                                                 AS samples
        FROM commodity_reference_points
        WHERE captured_at >= date_trunc(${sql.raw(`'${trunc}'`)}, ${since}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        GROUP BY commodity_id, bucket_start
      )
      INSERT INTO reference_candles
        (commodity_id, period, bucket_start,
         sell_open, sell_high, sell_low, sell_close,
         buy_open, buy_high, buy_low, buy_close,
         mkt_open, mkt_high, mkt_low, mkt_close, samples)
      SELECT
        commodity_id, ${period}, bucket_start,
        sell_open, sell_high, sell_low, sell_close,
        buy_open, buy_high, buy_low, buy_close,
        mkt_open, mkt_high, mkt_low, mkt_close, samples
      FROM bucketed
      ON CONFLICT (commodity_id, period, bucket_start) DO UPDATE SET
        sell_open = excluded.sell_open,  sell_high = excluded.sell_high,
        sell_low  = excluded.sell_low,   sell_close = excluded.sell_close,
        buy_open  = excluded.buy_open,   buy_high = excluded.buy_high,
        buy_low   = excluded.buy_low,    buy_close = excluded.buy_close,
        mkt_open  = excluded.mkt_open,   mkt_high = excluded.mkt_high,
        mkt_low   = excluded.mkt_low,    mkt_close = excluded.mkt_close,
        samples   = excluded.samples
    `);
  }
}
