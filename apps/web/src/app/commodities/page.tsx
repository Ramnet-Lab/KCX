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

type Mark = {
  price: number | null;
  pairs: number;
  sellTerminal: string | null;
  sellSystem: string | null;
  buyTerminal: string | null;
  buySystem: string | null;
};

/**
 * Per-commodity market state: the player mark (null while a commodity is still on its NPC
 * seed) plus where each NPC price physically is.
 */
async function loadMarks(): Promise<Map<number, Mark>> {
  const rows = await getDb().execute<{
    commodity_id: number;
    mark: string | null;
    pairs: number;
    sell_terminal: string | null;
    sell_system: string | null;
    buy_terminal: string | null;
    buy_system: string | null;
  }>(sql`
    SELECT commodity_id, mark_price::text AS mark, window_pairs AS pairs,
           best_sell_terminal AS sell_terminal, best_sell_system AS sell_system,
           best_buy_terminal  AS buy_terminal,  best_buy_system  AS buy_system
    FROM commodity_marks_latest
  `);
  return new Map(
    rows.rows.map((r) => [
      r.commodity_id,
      {
        price: r.mark != null ? Number(r.mark) : null,
        pairs: Number(r.pairs ?? 0),
        sellTerminal: r.sell_terminal,
        sellSystem: r.sell_system,
        buyTerminal: r.buy_terminal,
        buySystem: r.buy_system,
      },
    ]),
  );
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
    // No NPC-price filter. A commodity no terminal quotes still belongs in the directory —
    // 81 of 204 are in that position, mostly raw ore that terminals only buy once refined,
    // and they are precisely the ones a player exchange exists to price. They sort last and
    // say "no NPC market" rather than being omitted.
    .map((r) => {
      const npcSell = r.bestSell != null ? Number(r.bestSell) : null;
      const npcBuy = r.bestBuy != null ? Number(r.bestBuy) : null;
      const mark = marks.get(r.id) ?? null;
      const playerPrice = mark?.price ?? null;
      return {
        ...r,
        npcSell,
        npcBuy,
        // Once a commodity has traded, the players set its price. The terminal numbers stay
        // on the row as context rather than competing to be the headline.
        price: playerPrice ?? npcSell,
        priceSource: playerPrice != null ? ("player" as const) : ("npc" as const),
        thin: playerPrice != null && (mark?.pairs ?? 0) < MARK_CONFIDENT_PAIRS,
        sellAt: mark?.sellTerminal ?? null,
        sellSystem: mark?.sellSystem ?? null,
        buyAt: mark?.buyTerminal ?? null,
        buySystem: mark?.buySystem ?? null,
        npcSplit:
          mark?.sellSystem != null && mark?.buySystem != null && mark.sellSystem !== mark.buySystem,
        // Matches the wall's rule exactly: no NPC market means neither side is quoted
        // anywhere. Keying off the headline price being null instead wrongly flagged the ten
        // commodities terminals SELL but never buy — those have a market, just not a sell
        // price, and the Mark column simply shows a dash for them.
        npcMarket: npcSell != null || npcBuy != null,
      };
    });

  // Same tiering as the market wall: player-priced, then NPC-priced, then no price at all.
  // Two views of one dataset that disagreed about ordering would just look broken.
  traded.sort((a, b) => {
    const tier = (r: (typeof traded)[number]) => (r.priceSource === "player" ? 0 : r.npcMarket ? 1 : 2);
    return tier(a) - tier(b) || a.name.localeCompare(b.name);
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
              <th className="px-3 py-2 text-right">NPC sell-to / buy-from · where</th>
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
                  {!r.npcMarket && r.priceSource !== "player" && (
                    <span
                      className="text-[9px] font-bold text-accent"
                      title="No NPC terminal buys or sells this — usually raw ore, which must be refined first. Players are the only market."
                    >
                      NO NPC MKT
                    </span>
                  )}
                </td>
                {/*
                  Each NPC price with the terminal offering it. These are a universe-wide max
                  and a universe-wide min, so they are two prices in two places — not a spread
                  anyone can capture without flying between them.
                */}
                <td className="px-3 py-2 text-right">
                  <div className="num text-ink-dim">
                    {fmtAuec(r.npcSell != null ? String(r.npcSell) : null)}
                    {r.sellAt && (
                      <span className="ml-1 text-[10px] text-ink-faint">
                        @ {r.sellAt}
                        {r.sellSystem ? ` · ${r.sellSystem}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="num text-ink-dim">
                    {fmtAuec(r.npcBuy != null ? String(r.npcBuy) : null)}
                    {r.buyAt && (
                      <span className="ml-1 text-[10px] text-ink-faint">
                        @ {r.buyAt}
                        {r.buySystem ? ` · ${r.buySystem}` : ""}
                      </span>
                    )}
                  </div>
                  {r.npcSplit && (
                    <div className="text-[10px] text-ink-faint/70" title="Different systems — reaching either price costs a trip">
                      ⇄ different systems
                    </div>
                  )}
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
        Prices are aUEC per SCU, crowdsourced by UEX datarunners — may lag live servers. The
        mark is the player price where one exists, the NPC seed otherwise. The two NPC figures
        are the single best payout and the single cheapest purchase <em>anywhere</em>, which is
        why each carries the terminal offering it — they are rarely in the same place, and
        reaching either one costs a trip.
      </p>
    </>
  );
}
