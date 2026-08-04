import type { ChangeBasis, TickerEntry } from "@kcx/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { MARK_CONFIDENT_PAIRS } from "./mark";

/**
 * Ticker payload: every tradable commodity's current price and its change.
 *
 * Reads `commodity_marks_latest` — one row per commodity, ~200 rows — rather than deriving
 * the current state from history. The previous version ran three DISTINCT ON passes over
 * all of `commodity_reference_points` on every home page load AND every settlement; with 48
 * captures a day across 200 commodities that table gains ~3.6M rows a year, and the "24h
 * ago" lookup was a plain seq scan and sort because the PK leads with commodity_id.
 *
 * The comparison point comes from the 1h candles, which are already keyed
 * (commodity_id, period, bucket_start) and so answer "where was this a day ago" from an
 * index. Where a commodity has under a day of history the comparison falls back to its
 * oldest bucket and says so — see ChangeBasis.
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
    last_price: string | null;
    last_traded_at: Date | string | null;
    window_volume_scu: string;
    window_print_count: number;
    window_pairs: number;
    prev_day: string | null;
    prev_open: string | null;
  }>(sql`
    SELECT
      c.id AS commodity_id,
      c.slug, c.code, c.name, c.is_illegal,
      m.best_sell::text,
      m.best_buy::text,
      m.mark_price::text,
      m.last_price::text,
      m.last_traded_at,
      m.window_volume_scu::text,
      m.window_print_count,
      m.window_pairs,
      -- Newest 1h close at least 24h old.
      (SELECT rc.mkt_close::text
         FROM reference_candles rc
        WHERE rc.commodity_id = c.id AND rc.period = '1h'
          AND rc.bucket_start <= now() - interval '24 hours'
          AND rc.mkt_close IS NOT NULL
        ORDER BY rc.bucket_start DESC LIMIT 1) AS prev_day,
      -- Oldest close we hold at all, for the "since open" fallback.
      (SELECT rc.mkt_close::text
         FROM reference_candles rc
        WHERE rc.commodity_id = c.id AND rc.period = '1h' AND rc.mkt_close IS NOT NULL
        ORDER BY rc.bucket_start ASC LIMIT 1) AS prev_open
    FROM commodities c
    JOIN commodity_marks_latest m ON m.commodity_id = c.id
    WHERE c.is_tradable
    ORDER BY c.name
  `);

  const num = (v: string | null) => (v != null ? Number(v) : null);

  return result.rows.map((r) => {
    const bestSell = num(r.best_sell);
    const bestBuy = num(r.best_buy);
    const markPrice = num(r.mark_price);

    // The headline. A commodity that has traded is priced by its traders from then on; the
    // NPC baseline keeps being polled but only as context and as the chart's reference line.
    const price = markPrice ?? bestSell;
    const priceSource = markPrice != null ? "player" : "npc";

    const prevDay = num(r.prev_day);
    const prevOpen = num(r.prev_open);
    const basis: ChangeBasis = prevDay != null ? "24h" : "open";
    const prev = prevDay ?? prevOpen;
    const changePct =
      price != null && prev != null && prev > 0 ? Math.round(((price - prev) / prev) * 10_000) / 100 : null;

    const windowPairs = Number(r.window_pairs ?? 0);
    const lastTradedAt = r.last_traded_at ? new Date(r.last_traded_at).toISOString() : null;

    return {
      commodityId: r.commodity_id,
      slug: r.slug,
      code: r.code,
      name: r.name,
      isIllegal: r.is_illegal,
      bestSell,
      bestBuy,
      markPrice,
      lastPrice: num(r.last_price),
      lastTradedAt,
      price,
      priceSource,
      windowVolumeScu: Number(r.window_volume_scu ?? 0),
      windowPrintCount: Number(r.window_print_count ?? 0),
      windowPairs,
      thin: markPrice != null && windowPairs < MARK_CONFIDENT_PAIRS,
      changePct,
      changeBasis: basis,
    } satisfies TickerEntry;
  });
}
