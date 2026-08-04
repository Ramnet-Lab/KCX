import { sql, type SQL } from "drizzle-orm";

/**
 * The KCX mark — one definition, used by every path that can produce a price: the
 * 30-minute NPC poll, a confirmed fill, and the live ticker. Two copies of this logic
 * would silently diverge, and a market whose displayed price depends on which code path
 * last touched it is not a market.
 *
 * THE LADDER (highest rung that applies wins):
 *
 *   1. Windowed VWAP  — volume-weighted price of qualifying player fills in the last 72h,
 *                       once there is enough volume for the average to mean anything.
 *   2. Last print     — the most recent qualifying fill, however long ago. Kept forever.
 *   3. NPC baseline   — the terminal price.
 *
 * Rung 3 is a SEED, not a floor. The previous design blended the baseline and the player
 * VWAP by volume and then displayed whichever was *better* for the trader; between the two
 * rules a player price could only ever surface if it beat the best terminal in the game.
 * Since terminals pay at most `best_sell` and charge at least `best_buy`, and essentially
 * all player-to-player trade clears between those two numbers, the player market was
 * invisible by construction. Now the first fill takes a commodity off the baseline
 * permanently: NPC prices continue to be polled, but only as the chart's reference line.
 */

/** How far back player fills feed the volume-weighted average. */
export const MARK_WINDOW_HOURS = 72;

/**
 * Volume below which the windowed VWAP is not an average of anything — the mark drops to
 * rung 2 (the last print) rather than letting a single token fill masquerade as a mean.
 */
export const MARK_MIN_VOLUME_SCU = 10;

/**
 * Distinct counterparty PAIRS in the window below which a mark is flagged thin in the UI.
 *
 * Deliberately pairs, not prints: one pair trading with itself repeatedly is the cheapest
 * possible way to fake a market, so counting prints would rate exactly the wrong thing
 * highly. This flag never suppresses a price — it labels it. Withholding the number would
 * just hide the manipulation instead of exposing it.
 */
export const MARK_CONFIDENT_PAIRS = 2;

/**
 * Per-commodity print statistics: the windowed aggregate plus the all-time last trade.
 * Exposes commodity_id, vwap, volume_scu, print_count, pairs, last_price, last_traded_at.
 *
 * No HAVING clause. The previous version filtered out low-volume commodities entirely,
 * which meant a commodity with real-but-small activity LEFT JOINed to print_count = 0 and
 * the ticker reported "never traded" about a commodity that had traded. Thin markets are
 * reported as thin, not as absent.
 */
export function marketStatsCte(asOf: SQL | Date = sql`now()`, commodityId?: number): SQL {
  const at = asOf instanceof Date ? sql`${asOf}::timestamptz` : asOf;
  const inWindow = sql`executed_at >= ${at} - make_interval(hours => ${MARK_WINDOW_HOURS})`;
  // Explicit rather than relying on the planner pushing a predicate through the GROUP BY:
  // the settlement path recomputes one commodity and must not aggregate the whole tape.
  const only = commodityId != null ? sql` AND commodity_id = ${commodityId}` : sql``;
  return sql`
    SELECT
      commodity_id,
      sum(price_per_scu::numeric * quantity_scu) FILTER (WHERE ${inWindow})
        / nullif(sum(quantity_scu) FILTER (WHERE ${inWindow}), 0)      AS vwap,
      coalesce(sum(quantity_scu) FILTER (WHERE ${inWindow}), 0)        AS volume_scu,
      count(*) FILTER (WHERE ${inWindow})                              AS print_count,
      -- Unordered pair key, so A→B and B→A are one relationship rather than two. Both ids
      -- must be present: prints written before parties were recorded would otherwise all
      -- collapse to a single (NULL, NULL) key that count(DISTINCT) happily counts as one
      -- real relationship, overstating confidence in exactly the oldest, least-checked data.
      count(DISTINCT (least(buyer_id, seller_id), greatest(buyer_id, seller_id)))
        FILTER (WHERE ${inWindow} AND buyer_id IS NOT NULL AND seller_id IS NOT NULL) AS pairs,
      (array_agg(price_per_scu ORDER BY executed_at DESC, id DESC))[1] AS last_price,
      max(executed_at)                                                 AS last_traded_at
    FROM trade_prints
    WHERE NOT excluded AND executed_at <= ${at}${only}
    GROUP BY commodity_id
  `;
}

/**
 * Rungs 1 and 2 — the player-side mark on its own. NULL when a commodity has never had a
 * qualifying print, which is precisely the "still on the seed price" condition.
 */
export function playerMarkExpr(statsAlias = "s"): SQL {
  const a = sql.raw(statsAlias);
  return sql`CASE
    WHEN ${a}.volume_scu >= ${MARK_MIN_VOLUME_SCU} AND ${a}.vwap IS NOT NULL THEN ${a}.vwap
    ELSE ${a}.last_price::numeric
  END`;
}

/**
 * The full ladder including the baseline seed — what actually gets displayed, and what the
 * candles and sector indices track.
 */
export function markExpr(baselineCol: string, statsAlias = "s"): SQL {
  return sql`coalesce(${playerMarkExpr(statsAlias)}, ${sql.raw(baselineCol)})`;
}
