import { sql, type SQL } from "drizzle-orm";

/**
 * The KCX mark — single definition, used by BOTH the 30-minute ingest (which persists it
 * into commodity_reference_points for candles and indices) and the live ticker (which
 * recomputes it on demand so a settled trade moves the price immediately, without waiting
 * for the next poll). Two copies of this logic would silently diverge.
 */

/** How far back player fills influence the mark. */
export const MARK_WINDOW_HOURS = 72;

/**
 * Confidence weighting. A single token fill must NOT repoint a commodity — a 1 SCU wash
 * trade at an absurd price would otherwise become "the market". Below the floor prints are
 * ignored entirely; the mark then blends toward the print VWAP in proportion to volume.
 */
export const MARK_MIN_VOLUME_SCU = 10;
export const MARK_FULL_CONFIDENCE_SCU = 200;

/**
 * CTE computing per-commodity fill statistics inside the mark window.
 * Exposes: commodity_id, vwap, volume_scu, print_count.
 */
export function fillsCte(asOf: SQL | Date = sql`now()`): SQL {
  const at = asOf instanceof Date ? sql`${asOf}::timestamptz` : asOf;
  return sql`
    SELECT
      commodity_id,
      sum(price_per_scu::numeric * quantity_scu) / nullif(sum(quantity_scu), 0) AS vwap,
      sum(quantity_scu) AS volume_scu,
      count(*) AS print_count
    FROM trade_prints
    WHERE NOT excluded
      AND executed_at >= ${at} - make_interval(hours => ${MARK_WINDOW_HOURS})
    GROUP BY commodity_id
    HAVING sum(quantity_scu) >= ${MARK_MIN_VOLUME_SCU}
  `;
}

/**
 * Blend expression: NPC baseline pulled toward the player VWAP by traded volume.
 * `baseline` and the fill columns must be in scope as the given aliases.
 */
export function markExpr(baselineCol: string, fillsAlias = "f"): SQL {
  return sql`CASE
    WHEN ${sql.raw(fillsAlias)}.vwap IS NULL OR ${sql.raw(baselineCol)} IS NULL
      THEN coalesce(${sql.raw(fillsAlias)}.vwap, ${sql.raw(baselineCol)})
    ELSE ${sql.raw(baselineCol)}
         + (${sql.raw(fillsAlias)}.vwap - ${sql.raw(baselineCol)})
           * least(1.0, ${sql.raw(fillsAlias)}.volume_scu::numeric / ${MARK_FULL_CONFIDENCE_SCU})
  END`;
}
