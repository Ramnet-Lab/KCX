import { commodities, getDb, MARK_CONFIDENT_PAIRS, terminalPricesLatest } from "@kcx/db";
import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { fmtAuec, timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Commodities",
  description: "Current Star Citizen commodity prices across all NPC trade terminals.",
};

// Live market data: never prerender at build time, when the database is empty.
export const dynamic = "force-dynamic";

type Mark = { price: number; pairs: number };

/**
 * Player mark per commodity. Null in the marks table means the commodity has never had a
 * qualifying fill and is still on its NPC seed price — the row simply isn't in this map.
 */
async function loadMarks(): Promise<Map<number, Mark>> {
  const rows = await getDb().execute<{ commodity_id: number; mark: string | null; pairs: number }>(sql`
    SELECT commodity_id, mark_price::text AS mark, window_pairs AS pairs
    FROM commodity_marks_latest
    WHERE mark_price IS NOT NULL
  `);
  return new Map(rows.rows.map((r) => [r.commodity_id, { price: Number(r.mark), pairs: Number(r.pairs ?? 0) }]));
}

function loadRows() {
  return getDb()
    .select({
      id: commodities.id,
      name: commodities.name,
      code: commodities.code,
      slug: commodities.slug,
      kind: commodities.kind,
      isIllegal: commodities.isIllegal,
      // 0 means "not traded here" in UEX data, so NULLIF keeps it out of the aggregates.
      bestSell: sql<string | null>`max(nullif(${terminalPricesLatest.priceSell}, 0))`,
      bestBuy: sql<string | null>`min(nullif(${terminalPricesLatest.priceBuy}, 0))`,
      sellTerminals: sql<number>`count(*) filter (where nullif(${terminalPricesLatest.priceSell}, 0) is not null)`.mapWith(Number),
      buyTerminals: sql<number>`count(*) filter (where nullif(${terminalPricesLatest.priceBuy}, 0) is not null)`.mapWith(Number),
      lastUpdated: sql<Date | null>`max(${terminalPricesLatest.uexDateModified})`,
    })
    .from(commodities)
    .leftJoin(terminalPricesLatest, eq(terminalPricesLatest.commodityId, commodities.id))
    .where(eq(commodities.isTradable, true))
    .groupBy(commodities.id)
    .orderBy(commodities.name);
}

export default async function CommoditiesPage() {
  let rows: Awaited<ReturnType<typeof loadRows>> = [];
  let marks = new Map<number, Mark>();
  try {
    [rows, marks] = await Promise.all([loadRows(), loadMarks()]);
  } catch (err) {
    // DB unreachable (e.g. during `next build` in CI) → render the empty state;
    // ISR revalidation heals the page once the DB is up.
    console.error("[commodities] query failed:", err instanceof Error ? err.message : err);
  }
  const traded = rows
    .filter((r) => r.bestSell != null || r.bestBuy != null)
    .map((r) => {
      const npcSell = r.bestSell != null ? Number(r.bestSell) : null;
      const npcBuy = r.bestBuy != null ? Number(r.bestBuy) : null;
      const mark = marks.get(r.id) ?? null;
      return {
        ...r,
        npcSell,
        npcBuy,
        // Once a commodity has traded, the players set its price. The terminal numbers stay
        // on the row as context rather than competing to be the headline.
        price: mark?.price ?? npcSell,
        priceSource: mark ? ("player" as const) : ("npc" as const),
        thin: mark != null && mark.pairs < MARK_CONFIDENT_PAIRS,
      };
    });

  if (traded.length === 0) {
    return (
      <div className="rounded border border-line bg-panel p-8 text-center text-ink-dim">
        <p className="mb-2 text-ink">No price data yet.</p>
        <p>
          Run <code className="text-accent">pnpm ingest</code> to pull current UEX data.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-bold text-ink">Commodities</h1>
        <span className="text-xs text-ink-dim">
          {traded.length} tradable · NPC terminal prices via UEX
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full bg-panel text-left">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="px-3 py-2">Commodity</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2 text-right">Mark</th>
              <th className="px-3 py-2 text-right">NPC sell / buy</th>
              <th className="px-3 py-2 text-right">Sell / buy terms.</th>
              <th className="px-3 py-2 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {traded.map((r) => (
              <tr key={r.id} className="border-b border-line/50 hover:bg-panel-2">
                <td className="px-3 py-2">
                  <Link href={`/commodities/${r.slug}`} className="text-ink hover:text-accent">
                    <span className="mr-2 text-xs text-ink-faint">{r.code}</span>
                    {r.name}
                  </Link>
                  {r.isIllegal && (
                    <span className="ml-2 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-danger">
                      CONTRABAND
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-dim">{r.kind ?? "—"}</td>
                <td className={`num px-3 py-2 text-right ${r.priceSource === "player" ? "text-accent" : "text-up"}`}>
                  {fmtAuec(r.price != null ? String(r.price) : null)}
                  {r.priceSource === "player" && (
                    <span className="ml-1 text-[9px] text-accent" title="Set by player trades, not terminals">
                      PLR
                    </span>
                  )}
                  {r.thin && (
                    <span className="ml-1 text-[9px] text-danger" title="Too few distinct counterparties to be reliable">
                      THIN
                    </span>
                  )}
                </td>
                <td className="num px-3 py-2 text-right text-ink-dim">
                  {fmtAuec(r.npcSell != null ? String(r.npcSell) : null)} /{" "}
                  {fmtAuec(r.npcBuy != null ? String(r.npcBuy) : null)}
                </td>
                <td className="num px-3 py-2 text-right text-ink-dim">
                  {r.sellTerminals} / {r.buyTerminals}
                </td>
                <td className="num px-3 py-2 text-right text-ink-faint">{timeAgo(r.lastUpdated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Prices are aUEC per SCU, crowdsourced by UEX datarunners — may lag live servers. Best
        sell-to = highest NPC terminal payout; cheapest buy-from = lowest NPC purchase price.
      </p>
    </>
  );
}
