import { commodities, fillsCte, getDb, markExpr, terminalPricesLatest, terminals, uexPriceSnapshots } from "@kcx/db";
import { uexPriceRow } from "@kcx/shared";
import { sql } from "drizzle-orm";
import { audit, fetchUexRows, int, num, parseRows } from "../lib/uex";
import { rebuildCandlesSince } from "./candles";
import { rebuildIndexSince } from "./index-points";
import { ensureSnapshotInfra } from "./partitions";

/**
 * The 30-minute poll: /commodities_prices_all → (in ONE transaction, serialized by an
 * advisory xact lock) snapshot changed rows, upsert latest, drop vanished pairs, write
 * the per-commodity reference point → then refresh candles.
 *
 * Concurrency: pg_advisory_xact_lock serializes captures across processes (scheduled job
 * vs one-off script vs a second instance). The dedupe baseline is read INSIDE the locked
 * transaction, so a second writer that waited sees the first writer's committed state and
 * snapshots only genuinely-new changes.
 */
export async function ingestPrices(): Promise<{ upserted: number; snapshotted: number }> {
  const db = getDb();
  const startedAt = new Date();

  try {
    // Idempotent and cheap — guarantees partition coverage even if the monthly cron was missed.
    await ensureSnapshotInfra();

    const raw = await fetchUexRows("/commodities_prices_all");
    const rows = parseRows(raw, uexPriceRow, "prices");

    const [commodityRows, terminalRows] = await Promise.all([
      db.select({ id: commodities.id, uexId: commodities.uexId }).from(commodities),
      db.select({ id: terminals.id, uexId: terminals.uexId }).from(terminals),
    ]);
    const commodityIds = new Map(commodityRows.filter((r) => r.uexId != null).map((r) => [r.uexId!, r.id]));
    const terminalIds = new Map(terminalRows.filter((r) => r.uexId != null).map((r) => [r.uexId!, r.id]));

    const capturedAt = new Date();
    const seen = new Set<string>();
    let skippedUnknownRefs = 0;
    const latestValues: (typeof terminalPricesLatest.$inferInsert)[] = [];

    for (const row of rows) {
      const commodityId = commodityIds.get(row.id_commodity);
      const terminalId = terminalIds.get(row.id_terminal);
      if (!commodityId || !terminalId) {
        skippedUnknownRefs++;
        continue;
      }
      const key = `${terminalId}:${commodityId}`;
      if (seen.has(key)) continue; // defensive: upstream duplicates would break multi-row upsert
      seen.add(key);
      latestValues.push({
        terminalId,
        commodityId,
        priceBuy: num(row.price_buy),
        priceBuyMin: num(row.price_buy_min),
        priceBuyMax: num(row.price_buy_max),
        priceBuyAvg: num(row.price_buy_avg),
        priceSell: num(row.price_sell),
        priceSellMin: num(row.price_sell_min),
        priceSellMax: num(row.price_sell_max),
        priceSellAvg: num(row.price_sell_avg),
        scuBuy: int(row.scu_buy),
        scuSell: int(row.scu_sell),
        scuSellStock: int(row.scu_sell_stock),
        statusBuy: int(row.status_buy),
        statusSell: int(row.status_sell),
        sourceScore: int(row.quality),
        gameVersion: row.game_version ?? null,
        uexDateModified: row.date_modified ? new Date(row.date_modified * 1000) : null,
        capturedAt,
      });
    }

    let snapshotted = 0;
    const CHUNK = 500;
    const excluded = (col: string) => sql.raw(`excluded."${col}"`);

    await db.transaction(async (tx) => {
      // Serialize whole captures across processes; auto-released at commit/rollback.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('kcx_ingest'))`);

      // Dedupe baseline read under the lock → reflects any concurrent writer that just committed.
      const latestRows = await tx
        .select({
          terminalId: terminalPricesLatest.terminalId,
          commodityId: terminalPricesLatest.commodityId,
          uexDateModified: terminalPricesLatest.uexDateModified,
        })
        .from(terminalPricesLatest);
      const lastModified = new Map(
        latestRows.map((r) => [`${r.terminalId}:${r.commodityId}`, r.uexDateModified?.getTime() ?? 0]),
      );

      const firstRunProbe = await tx.execute(sql`SELECT 1 AS n FROM uex_price_snapshots LIMIT 1`);
      const isFirstRun = firstRunProbe.rows.length === 0;

      // Snapshot only rows whose UEX-side modification time moved (first run: everything).
      const snapshotValues: (typeof uexPriceSnapshots.$inferInsert)[] = [];
      for (const v of latestValues) {
        const prev = lastModified.get(`${v.terminalId}:${v.commodityId}`);
        const cur = v.uexDateModified?.getTime() ?? 0;
        if (isFirstRun || prev === undefined || cur !== prev) {
          snapshotValues.push({
            terminalId: v.terminalId,
            commodityId: v.commodityId,
            priceBuy: v.priceBuy,
            priceSell: v.priceSell,
            scuBuy: v.scuBuy,
            scuSell: v.scuSell,
            scuSellStock: v.scuSellStock,
            statusBuy: v.statusBuy,
            statusSell: v.statusSell,
            sourceScore: v.sourceScore,
            gameVersion: v.gameVersion,
            uexDateModified: v.uexDateModified,
            capturedAt,
          });
        }
      }
      snapshotted = snapshotValues.length;

      for (let i = 0; i < snapshotValues.length; i += CHUNK) {
        await tx.insert(uexPriceSnapshots).values(snapshotValues.slice(i, i + CHUNK));
      }

      for (let i = 0; i < latestValues.length; i += CHUNK) {
        await tx
          .insert(terminalPricesLatest)
          .values(latestValues.slice(i, i + CHUNK))
          .onConflictDoUpdate({
            target: [terminalPricesLatest.terminalId, terminalPricesLatest.commodityId],
            set: {
              priceBuy: excluded("price_buy"),
              priceBuyMin: excluded("price_buy_min"),
              priceBuyMax: excluded("price_buy_max"),
              priceBuyAvg: excluded("price_buy_avg"),
              priceSell: excluded("price_sell"),
              priceSellMin: excluded("price_sell_min"),
              priceSellMax: excluded("price_sell_max"),
              priceSellAvg: excluded("price_sell_avg"),
              scuBuy: excluded("scu_buy"),
              scuSell: excluded("scu_sell"),
              scuSellStock: excluded("scu_sell_stock"),
              statusBuy: excluded("status_buy"),
              statusSell: excluded("status_sell"),
              sourceScore: excluded("source_score"),
              gameVersion: excluded("game_version"),
              uexDateModified: excluded("uex_date_modified"),
              capturedAt: excluded("captured_at"),
            },
          });
      }

      // The feed is a full dump: pairs absent from it no longer exist in-game (terminal
      // removed, commodity delisted) and must not keep pinning "best price" aggregates.
      // Guarded so a bogus near-empty feed can never wipe the table.
      if (latestValues.length >= 500) {
        await tx.execute(sql`DELETE FROM terminal_prices_latest WHERE captured_at <> ${capturedAt}`);
      }

      // Per-commodity baseline from the COMPLETE, freshly-cleaned latest state, plus the
      // KCX mark: the volume-weighted price of player fills in the trailing window, falling
      // back to the NPC baseline when nobody has traded. Only fills move it — expired
      // orders never reach trade_prints, so an unfilled listing cannot touch the market.
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
        fills AS (${fillsCte(capturedAt)})
        INSERT INTO commodity_reference_points
          (commodity_id, captured_at, best_sell, best_buy, sell_terminals, buy_terminals, market_price, print_count)
        SELECT
          b.commodity_id,
          ${capturedAt},
          b.best_sell,
          b.best_buy,
          b.sell_terminals,
          b.buy_terminals,
          -- Volume-weighted blend between the NPC baseline and the player VWAP.
          ${markExpr("b.best_sell")},
          coalesce(f.print_count, 0)
        FROM baseline b
        LEFT JOIN fills f ON f.commodity_id = b.commodity_id
        ON CONFLICT (commodity_id, captured_at) DO NOTHING
      `);
    });

    // Widened window: if a prior run crashed between commit and rebuild, any bucket in the
    // last 26h self-heals here instead of staying permanently short of samples.
    const rebuildFrom = new Date(capturedAt.getTime() - 26 * 3_600_000);
    await rebuildCandlesSince(rebuildFrom);
    await rebuildIndexSince(rebuildFrom);

    const status = skippedUnknownRefs > 0 || rows.length < raw.length ? "partial" : "ok";
    await audit("/commodities_prices_all", startedAt, raw.length, latestValues.length, status);
    console.log(
      `[ingest] ${latestValues.length} latest upserted, ${snapshotted} snapshotted (${skippedUnknownRefs} unknown refs skipped)`,
    );
    return { upserted: latestValues.length, snapshotted };
  } catch (err) {
    await audit("/commodities_prices_all", startedAt, 0, 0, "error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
