import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { marketStatsCte, playerMarkExpr } from "./mark";

/**
 * Writing market state.
 *
 * Two things can move a price: the NPC poll and a confirmed player fill. Both write the
 * same two places — an append-only `commodity_reference_points` row (what candles and the
 * sector indices are built from) and the `commodity_marks_latest` upsert (what the ticker
 * reads). Previously only the poll did this, so a settlement moved the tiles — which
 * recompute live — while the chart underneath them kept showing the pre-trade price until
 * the next half-hourly capture. A trade that doesn't appear on the chart of the thing that
 * was traded is not a market chart.
 */

/** Accepts a pool handle or an open transaction — both expose `.execute`. */
type Exec = Pick<Db, "execute">;

/**
 * The marks-table column list, in insert order.
 *
 * `mark_price` takes the PLAYER mark, which is null until a commodity's first fill —
 * that null is what "still on the seed price" means, and coalescing the baseline in here
 * would erase the distinction the whole model rests on. The reference-point row does the
 * coalescing separately, because candles need a value in every bucket.
 */
const MARKS_SELECT = sql`
  m.commodity_id,
  m.best_sell,
  m.best_buy,
  m.sell_terminals,
  m.buy_terminals,
  m.player_mark,
  m.last_price,
  m.last_traded_at,
  m.volume_scu,
  m.print_count,
  m.pairs
`;

/**
 * Full capture across every tradable commodity — the poll's write, run inside the ingest
 * transaction so a capture is all-or-nothing.
 *
 * Driven from `commodities`, not from the price table: a commodity that no terminal trades
 * any more still has a player market, and joining the other way silently dropped it.
 */
export async function captureAllMarks(tx: Exec, capturedAt: Date): Promise<void> {
  await tx.execute(sql`
    WITH baseline AS (
      SELECT
        commodity_id,
        max(nullif(price_sell, 0)) AS best_sell,
        min(nullif(price_buy, 0))  AS best_buy,
        count(*) FILTER (WHERE nullif(price_sell, 0) IS NOT NULL) AS sell_terminals,
        count(*) FILTER (WHERE nullif(price_buy, 0) IS NOT NULL)  AS buy_terminals
      FROM terminal_prices_latest
      GROUP BY commodity_id
    ),
    s AS (${marketStatsCte(capturedAt)}),
    m AS (
      SELECT
        c.id AS commodity_id,
        b.best_sell,
        b.best_buy,
        coalesce(b.sell_terminals, 0) AS sell_terminals,
        coalesce(b.buy_terminals, 0)  AS buy_terminals,
        ${playerMarkExpr("s")} AS player_mark,
        s.last_price,
        s.last_traded_at,
        coalesce(s.volume_scu, 0)  AS volume_scu,
        coalesce(s.print_count, 0) AS print_count,
        coalesce(s.pairs, 0)       AS pairs
      FROM commodities c
      LEFT JOIN baseline b ON b.commodity_id = c.id
      LEFT JOIN s ON s.commodity_id = c.id
      WHERE c.is_tradable
    ),
    ref AS (
      INSERT INTO commodity_reference_points
        (commodity_id, captured_at, best_sell, best_buy, sell_terminals, buy_terminals, market_price, print_count)
      SELECT m.commodity_id, ${capturedAt}, m.best_sell, m.best_buy, m.sell_terminals, m.buy_terminals,
             coalesce(m.player_mark, m.best_sell), m.print_count
      FROM m
      WHERE coalesce(m.player_mark, m.best_sell) IS NOT NULL OR m.best_buy IS NOT NULL
      ON CONFLICT (commodity_id, captured_at) DO NOTHING
      RETURNING 1
    )
    INSERT INTO commodity_marks_latest
      (commodity_id, best_sell, best_buy, sell_terminals, buy_terminals,
       mark_price, last_price, last_traded_at, window_volume_scu, window_print_count, window_pairs, updated_at)
    SELECT ${MARKS_SELECT}, ${capturedAt} FROM m
    ON CONFLICT (commodity_id) DO UPDATE SET
      best_sell          = excluded.best_sell,
      best_buy           = excluded.best_buy,
      sell_terminals     = excluded.sell_terminals,
      buy_terminals      = excluded.buy_terminals,
      mark_price         = excluded.mark_price,
      last_price         = excluded.last_price,
      last_traded_at     = excluded.last_traded_at,
      window_volume_scu  = excluded.window_volume_scu,
      window_print_count = excluded.window_print_count,
      window_pairs       = excluded.window_pairs,
      updated_at         = excluded.updated_at
  `);
}

/**
 * Single-commodity refresh after a fill.
 *
 * The NPC baseline is read from the marks row rather than re-aggregated from
 * `terminal_prices_latest`: the poll owns that number, this path owns the player number,
 * and keeping the two writers off each other's columns is what stops a settlement racing a
 * capture into an inconsistent row.
 *
 * `at` becomes a reference point of its own, so the fill lands in the current candle
 * bucket instead of waiting up to 30 minutes for the next capture.
 */
export async function refreshCommodityMark(tx: Exec, commodityId: number, at: Date): Promise<void> {
  await tx.execute(sql`
    WITH s AS (${marketStatsCte(at, commodityId)}),
    m AS (
      SELECT
        c.id AS commodity_id,
        l.best_sell,
        l.best_buy,
        coalesce(l.sell_terminals, 0) AS sell_terminals,
        coalesce(l.buy_terminals, 0)  AS buy_terminals,
        ${playerMarkExpr("s")} AS player_mark,
        s.last_price,
        s.last_traded_at,
        coalesce(s.volume_scu, 0)  AS volume_scu,
        coalesce(s.print_count, 0) AS print_count,
        coalesce(s.pairs, 0)       AS pairs
      FROM commodities c
      LEFT JOIN commodity_marks_latest l ON l.commodity_id = c.id
      LEFT JOIN s ON s.commodity_id = c.id
      WHERE c.id = ${commodityId}
    ),
    ref AS (
      INSERT INTO commodity_reference_points
        (commodity_id, captured_at, best_sell, best_buy, sell_terminals, buy_terminals, market_price, print_count)
      SELECT m.commodity_id, ${at}, m.best_sell, m.best_buy, m.sell_terminals, m.buy_terminals,
             coalesce(m.player_mark, m.best_sell), m.print_count
      FROM m
      WHERE coalesce(m.player_mark, m.best_sell) IS NOT NULL
      ON CONFLICT (commodity_id, captured_at) DO UPDATE SET
        market_price = excluded.market_price,
        print_count  = excluded.print_count
      RETURNING 1
    )
    INSERT INTO commodity_marks_latest
      (commodity_id, best_sell, best_buy, sell_terminals, buy_terminals,
       mark_price, last_price, last_traded_at, window_volume_scu, window_print_count, window_pairs, updated_at)
    SELECT ${MARKS_SELECT}, ${at} FROM m
    ON CONFLICT (commodity_id) DO UPDATE SET
      mark_price         = excluded.mark_price,
      last_price         = excluded.last_price,
      last_traded_at     = excluded.last_traded_at,
      window_volume_scu  = excluded.window_volume_scu,
      window_print_count = excluded.window_print_count,
      window_pairs       = excluded.window_pairs,
      updated_at         = excluded.updated_at
  `);
}
