import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";

/**
 * Rebuild sector index points for every capture at/after `since` (epoch 0 = full backfill).
 *
 * Methodology (documented on /about later): per commodity, the baseline is its FIRST
 * reference point with a non-null best_sell; each capture's relative = best_sell / baseline;
 * a sector's index = 1000 × equal-weight mean of its constituents' relatives; KCXC spans
 * all tradable commodities. Equal weight keeps one mega-priced ore from being the index.
 */
export async function rebuildIndexSince(since: Date): Promise<void> {
  await getDb().execute(sql`
    -- Indices track the KCX mark, so player fills move the sector tickers too.
    WITH bases AS (
      SELECT DISTINCT ON (commodity_id) commodity_id, coalesce(market_price, best_sell) AS base_sell
      FROM commodity_reference_points
      WHERE coalesce(market_price, best_sell) IS NOT NULL AND coalesce(market_price, best_sell) > 0
      ORDER BY commodity_id, captured_at ASC
    ),
    pts AS (
      SELECT
        coalesce(c.sector, 'MISC') AS sector,
        p.captured_at,
        coalesce(p.market_price, p.best_sell) / b.base_sell AS rel
      FROM commodity_reference_points p
      JOIN bases b ON b.commodity_id = p.commodity_id
      JOIN commodities c ON c.id = p.commodity_id
      WHERE coalesce(p.market_price, p.best_sell) IS NOT NULL AND c.is_tradable AND p.captured_at >= ${since}
    ),
    sectors AS (
      SELECT sector, captured_at, 1000 * avg(rel) AS value, count(*) AS constituents
      FROM pts GROUP BY sector, captured_at
      UNION ALL
      SELECT 'KCXC', captured_at, 1000 * avg(rel), count(*)
      FROM pts GROUP BY captured_at
    )
    INSERT INTO market_index_points (sector, captured_at, value, constituents)
    SELECT sector, captured_at, value, constituents FROM sectors
    ON CONFLICT (sector, captured_at) DO UPDATE
      SET value = excluded.value, constituents = excluded.constituents
  `);
}
