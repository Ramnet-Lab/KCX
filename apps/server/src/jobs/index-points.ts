import { getDb } from "@kcx/db";
import { INDEX_BASE } from "@kcx/shared";
import { sql } from "drizzle-orm";

/**
 * Rebuild sector index points from `since` onward.
 *
 * METHODOLOGY — chain-linked, equal-weight.
 *
 *   index(t) = index(t−1) × mean over constituents of  value(t) / value(t−1)
 *
 * The old version computed each capture independently as the mean of every commodity's
 * price relative to its own first-ever price. Two things were wrong with that:
 *
 *   1. Constituents are not a fixed set. A commodity that entered the universe later joined
 *      the average at a relative of ~1.0 and mechanically dragged its sector back toward
 *      1000 — an index that falls because a new thing started trading is measuring its own
 *      bookkeeping, not the market.
 *   2. It grouped strictly by `captured_at`, which was safe only while every point came from
 *      the same half-hourly poll. Now a settlement writes a reference point for ONE
 *      commodity at an off-poll instant, and that commodity would have been 100% of the
 *      index at that timestamp.
 *
 * Chain-linking fixes both: a new constituent contributes nothing on the step it appears
 * (it has no previous value to return from) and starts contributing returns afterwards, and
 * every tick is gap-filled with each constituent's last known value so a single-commodity
 * tick moves the index by exactly that commodity's share of it.
 */
export async function rebuildIndexSince(since: Date): Promise<void> {
  await getDb().execute(sql`
    WITH
    -- Anchor: the last capture at or before the rebuild point. Its stored index value is what
    -- the rebuilt run chains forward from, so an incremental rebuild continues the same
    -- series rather than restarting it at base.
    anchor AS (
      SELECT coalesce(
        (SELECT max(captured_at) FROM commodity_reference_points WHERE captured_at <= ${since}),
        (SELECT min(captured_at) FROM commodity_reference_points)
      ) AS at
    ),
    ticks AS (
      SELECT DISTINCT p.captured_at
      FROM commodity_reference_points p, anchor a
      WHERE p.captured_at >= a.at
    ),
    -- Every constituent carried forward to every tick. Without this a tick written by a
    -- single settlement would look like a market where only one commodity exists.
    grid AS (
      SELECT
        t.captured_at,
        c.id AS commodity_id,
        coalesce(c.sector, 'MISC') AS sector,
        (SELECT coalesce(p.market_price, p.best_sell)
           FROM commodity_reference_points p
          WHERE p.commodity_id = c.id
            AND p.captured_at <= t.captured_at
            AND coalesce(p.market_price, p.best_sell) > 0
          ORDER BY p.captured_at DESC
          LIMIT 1) AS v
      FROM ticks t
      CROSS JOIN commodities c
      WHERE c.is_tradable
    ),
    -- WHERE is evaluated before window functions, so lag() steps over the ticks at which
    -- this commodity actually had a price — a commodity that appears mid-series simply has
    -- no previous value on its first tick and contributes no return.
    stepped AS (
      SELECT sector, commodity_id, captured_at, v,
             lag(v) OVER (PARTITION BY commodity_id ORDER BY captured_at) AS prev_v
      FROM grid
      WHERE v IS NOT NULL
    ),
    moves AS (
      SELECT sector, captured_at, v, prev_v FROM stepped WHERE prev_v IS NOT NULL AND prev_v > 0
    ),
    returns AS (
      SELECT sector, captured_at, avg(v / prev_v) AS r, count(*)::int AS n
      FROM moves GROUP BY sector, captured_at
      UNION ALL
      SELECT 'KCXC', captured_at, avg(v / prev_v), count(*)::int
      FROM moves GROUP BY captured_at
    ),
    sectors AS (SELECT DISTINCT sector FROM returns),
    seeds AS (
      SELECT
        s.sector,
        coalesce((
          SELECT mp.value FROM market_index_points mp, anchor a
          WHERE mp.sector = s.sector AND mp.captured_at <= a.at
          ORDER BY mp.captured_at DESC LIMIT 1
        ), ${INDEX_BASE}) AS value
      FROM sectors s
    ),
    -- Running product of the per-tick mean returns. exp(sum(ln)) because Postgres has no
    -- product aggregate; every r here is strictly positive by construction.
    chained AS (
      SELECT r.sector, r.captured_at, r.n,
             exp(sum(ln(r.r)) OVER (PARTITION BY r.sector ORDER BY r.captured_at)) AS factor
      FROM returns r
      WHERE r.r > 0
    ),
    -- Re-assert the anchor point itself, so a full backfill lays down a base of 1000 at the
    -- first capture instead of starting one tick late.
    base AS (
      INSERT INTO market_index_points (sector, captured_at, value, constituents)
      SELECT s.sector, a.at, s.value,
             (SELECT count(*)::int FROM grid g WHERE g.captured_at = a.at AND g.v IS NOT NULL
                AND (s.sector = 'KCXC' OR g.sector = s.sector))
      FROM seeds s, anchor a
      WHERE a.at IS NOT NULL
      ON CONFLICT (sector, captured_at) DO UPDATE
        SET value = excluded.value, constituents = excluded.constituents
      RETURNING 1
    )
    INSERT INTO market_index_points (sector, captured_at, value, constituents)
    SELECT c.sector, c.captured_at, s.value * c.factor, c.n
    FROM chained c
    JOIN seeds s ON s.sector = c.sector
    ON CONFLICT (sector, captured_at) DO UPDATE
      SET value = excluded.value, constituents = excluded.constituents
  `);
}
