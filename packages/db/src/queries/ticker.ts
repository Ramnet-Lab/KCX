import { resolveEffectivePrices, type TickerEntry } from "@kcx/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { fillsCte, markExpr } from "./mark";

/**
 * Ticker payload: every tradable commodity's current prices plus its 24h delta.
 *
 * Displayed prices take the BETTER of the player market and the NPC baseline — a filled
 * player order supersedes the terminal price only when it actually beats it. The 24h
 * comparison uses the same effective basis so the delta matches what's on screen.
 *
 * "24h ago" is the newest reference point at least 24h old; falls back to the oldest point
 * available once at least 6h of spread exists (so early-life deltas aren't noise).
 */
export async function tickerEntries(db: Db): Promise<TickerEntry[]> {
  const result = await db.execute<{
    commodity_id: number;
    slug: string;
    code: string;
    name: string;
    is_illegal: boolean;
    best_sell: string | null;
    best_buy: string | null;
    mark_price: string | null;
    print_count: number;
    prev_sell: string | null;
    prev_mark: string | null;
  }>(sql`
    WITH fills AS (${fillsCte()}),
    latest_raw AS (
      SELECT DISTINCT ON (commodity_id)
        commodity_id, captured_at, best_sell, best_buy
      FROM commodity_reference_points
      ORDER BY commodity_id, captured_at DESC
    ),
    -- Recompute the mark live rather than reading the stored value: a settlement must move
    -- the price immediately, not at the next 30-minute poll.
    latest AS (
      SELECT
        l.commodity_id, l.captured_at, l.best_sell, l.best_buy,
        ${markExpr("l.best_sell")} AS market_price,
        coalesce(f.print_count, 0) AS print_count
      FROM latest_raw l
      LEFT JOIN fills f ON f.commodity_id = l.commodity_id
    ),
    day_ago AS (
      SELECT DISTINCT ON (commodity_id)
        commodity_id, captured_at, best_sell, market_price
      FROM commodity_reference_points
      WHERE captured_at <= now() - interval '24 hours'
      ORDER BY commodity_id, captured_at DESC
    ),
    oldest AS (
      SELECT DISTINCT ON (commodity_id)
        commodity_id, captured_at, best_sell, market_price
      FROM commodity_reference_points
      ORDER BY commodity_id, captured_at ASC
    )
    SELECT
      c.id            AS commodity_id,
      c.slug, c.code, c.name,
      c.is_illegal,
      l.best_sell     AS best_sell,
      l.best_buy      AS best_buy,
      -- market_price equals the baseline when nobody has traded; only surface it as a
      -- player price once real prints exist behind it.
      CASE WHEN l.print_count > 0 THEN l.market_price END AS mark_price,
      l.print_count,
      coalesce(d.best_sell, CASE WHEN l.captured_at - o.captured_at >= interval '6 hours' THEN o.best_sell END) AS prev_sell,
      coalesce(d.market_price, CASE WHEN l.captured_at - o.captured_at >= interval '6 hours' THEN o.market_price END) AS prev_mark
    FROM commodities c
    JOIN latest l ON l.commodity_id = c.id
    LEFT JOIN day_ago d ON d.commodity_id = c.id
    LEFT JOIN oldest o ON o.commodity_id = c.id
    WHERE c.is_tradable
    ORDER BY c.name
  `);

  const num = (v: string | null) => (v != null ? Number(v) : null);

  return result.rows.map((r) => {
    const bestSell = num(r.best_sell);
    const bestBuy = num(r.best_buy);
    const markPrice = num(r.mark_price);
    const effective = resolveEffectivePrices(bestSell, bestBuy, markPrice);

    // Compare like with like: previous effective sell, using the same better-of rule.
    const prevSell = num(r.prev_sell);
    const prevMark = num(r.prev_mark);
    const prevEffective =
      prevMark != null && (prevSell == null || prevMark > prevSell) ? prevMark : prevSell;
    const current = effective.effectiveSell;
    const change =
      current != null && prevEffective != null && prevEffective > 0
        ? ((current - prevEffective) / prevEffective) * 100
        : null;

    return {
      commodityId: r.commodity_id,
      slug: r.slug,
      code: r.code,
      name: r.name,
      isIllegal: r.is_illegal,
      bestSell,
      bestBuy,
      markPrice,
      ...effective,
      change24hPct: change != null ? Math.round(change * 100) / 100 : null,
    };
  });
}
