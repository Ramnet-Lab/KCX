import {
  commodities,
  commodityMarksLatest,
  commodityTape,
  BULK_SCU_THRESHOLD,
  getDb,
  locations,
  MARK_CONFIDENT_PAIRS,
  MARK_WINDOW_HOURS,
  referenceCandles,
  terminalPricesLatest,
  terminals,
  type TapePrint,
} from "@kcx/db";
import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReferenceChart, type CandlePoint } from "@/components/reference-chart";
import { TapePanel } from "@/components/tape-panel";
import { fmtAuec, fmtScu, timeAgo } from "@/lib/format";

// Live market data: never prerender at build time, when the database is empty.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const db = getDb();
    const [c] = await db.select({ name: commodities.name }).from(commodities).where(eq(commodities.slug, slug));
    return {
      title: c ? `${c.name} prices` : "Commodity",
      description: c ? `Where to buy and sell ${c.name} in Star Citizen — current NPC terminal prices.` : undefined,
    };
  } catch {
    return { title: "Commodity" };
  }
}

/** Small enough to fetch whole; builds "Terminal · Moon · Planet · System" breadcrumbs in JS. */
async function locationPaths(): Promise<Map<number, string>> {
  const db = getDb();
  const all = await db
    .select({ id: locations.id, name: locations.name, parentId: locations.parentId })
    .from(locations);
  const byId = new Map(all.map((l) => [l.id, l]));
  const paths = new Map<number, string>();
  for (const loc of all) {
    const parts: string[] = [];
    let cur: typeof loc | undefined = loc;
    let guard = 0;
    while (cur && guard++ < 6) {
      parts.push(cur.name);
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    }
    paths.set(loc.id, parts.join(" · "));
  }
  return paths;
}

export default async function CommodityPage({ params }: Props) {
  const { slug } = await params;
  let db: ReturnType<typeof getDb>;
  let commodity: typeof commodities.$inferSelect | undefined;
  try {
    db = getDb();
    [commodity] = await db.select().from(commodities).where(eq(commodities.slug, slug));
  } catch (err) {
    console.error("[commodity] query failed:", err instanceof Error ? err.message : err);
    return (
      <div className="rounded border border-line bg-panel p-8 text-center text-ink-dim">
        Market data is temporarily unavailable — try again in a minute.
      </div>
    );
  }
  if (!commodity) notFound();

  const loadCandles = async (period: "1h" | "1d", limit: number): Promise<CandlePoint[]> => {
    const rows = await db
      .select()
      .from(referenceCandles)
      .where(and(eq(referenceCandles.commodityId, commodity.id), eq(referenceCandles.period, period)))
      .orderBy(desc(referenceCandles.bucketStart))
      .limit(limit);
    const n = (s: string | null) => (s != null ? Number(s) : null);
    return rows.reverse().map((r) => ({
      time: Math.floor(r.bucketStart.getTime() / 1000),
      // Fall back to the baseline for buckets recorded before the mark existed.
      mktOpen: n(r.mktOpen) ?? n(r.sellOpen),
      mktHigh: n(r.mktHigh) ?? n(r.sellHigh),
      mktLow: n(r.mktLow) ?? n(r.sellLow),
      mktClose: n(r.mktClose) ?? n(r.sellClose),
      sellClose: n(r.sellClose),
      buyClose: n(r.buyClose),
    }));
  };

  const [prices, paths, candles1h, candles1d, mark, tape] = await Promise.all([
    db
      .select({
        terminalName: terminals.name,
        locationId: terminals.locationId,
        priceBuy: terminalPricesLatest.priceBuy,
        priceSell: terminalPricesLatest.priceSell,
        scuBuy: terminalPricesLatest.scuBuy,
        scuSell: terminalPricesLatest.scuSell,
        sourceScore: terminalPricesLatest.sourceScore,
        uexDateModified: terminalPricesLatest.uexDateModified,
      })
      .from(terminalPricesLatest)
      .innerJoin(terminals, eq(terminalPricesLatest.terminalId, terminals.id))
      .where(eq(terminalPricesLatest.commodityId, commodity.id)),
    locationPaths(),
    loadCandles("1h", 24 * 14), // two weeks of hourly
    loadCandles("1d", 365),
    db
      .select()
      .from(commodityMarksLatest)
      .where(eq(commodityMarksLatest.commodityId, commodity.id))
      .then((rows) => rows[0] ?? null),
    commodityTape(db, commodity.id, 50).catch((): TapePrint[] => []),
  ]);

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";
  const markPrice = mark?.markPrice != null ? Number(mark.markPrice) : null;
  const windowPairs = mark?.windowPairs ?? 0;
  const npcSplit =
    mark?.bestSellSystem != null && mark?.bestBuySystem != null && mark.bestSellSystem !== mark.bestBuySystem;

  const val = (s: string | null) => (s ? Number(s) : 0);
  const sellers = prices.filter((p) => val(p.priceSell) > 0).sort((a, b) => val(b.priceSell) - val(a.priceSell));
  const buyers = prices.filter((p) => val(p.priceBuy) > 0).sort((a, b) => val(a.priceBuy) - val(b.priceBuy));

  const Table = ({
    rows,
    priceKey,
    scuKey,
    priceLabel,
    scuLabel,
    accent,
  }: {
    rows: typeof prices;
    priceKey: "priceSell" | "priceBuy";
    scuKey: "scuSell" | "scuBuy";
    priceLabel: string;
    scuLabel: string;
    accent: string;
  }) => (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full bg-panel text-left">
        <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
          <tr>
            <th className="px-3 py-2">Terminal</th>
            <th className="px-3 py-2 text-right">{priceLabel}</th>
            <th className="px-3 py-2 text-right">{scuLabel}</th>
            <th className="px-3 py-2 text-right">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-ink-faint">
                No terminals
              </td>
            </tr>
          )}
          {rows.map((p, i) => (
            <tr key={i} className="border-b border-line/50 hover:bg-panel-2">
              <td className="px-3 py-2">
                <div className="text-ink">{p.terminalName}</div>
                <div className="text-xs text-ink-faint">
                  {p.locationId != null ? (paths.get(p.locationId) ?? "") : ""}
                </div>
              </td>
              <td className={`num px-3 py-2 text-right ${accent}`}>{fmtAuec(p[priceKey])}</td>
              <td className="num px-3 py-2 text-right text-ink-dim">{fmtScu(p[scuKey])}</td>
              <td className="num px-3 py-2 text-right text-ink-faint">{timeAgo(p.uexDateModified)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <nav className="mb-3 text-xs text-ink-faint">
        <Link href="/commodities" className="hover:text-ink">
          Commodities
        </Link>{" "}
        / {commodity.name}
      </nav>
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-xl font-bold text-ink">{commodity.name}</h1>
        <span className="text-xs text-ink-faint">{commodity.code}</span>
        {commodity.kind && <span className="text-xs text-ink-dim">{commodity.kind}</span>}
        {commodity.isIllegal && (
          <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-danger">
            CONTRABAND
          </span>
        )}
      </div>
      {/*
        Where this commodity's headline price comes from. Worth stating outright: the NPC
        baseline is a seed, and after the first fill the number above the chart is set by
        traders, not by terminals.
      */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded border border-line bg-panel px-3 py-2">
        <span className="text-xs uppercase tracking-wider text-ink-faint">Mark</span>
        <span className={`num text-lg ${markPrice != null ? "text-accent" : "text-ink"}`}>
          {markPrice != null ? fmtAuec(String(markPrice)) : fmtAuec(mark?.bestSell ?? null)}
        </span>
        {markPrice != null ? (
          <span className="text-xs text-ink-dim">
            player-set · {(mark?.windowPrintCount ?? 0).toLocaleString()} print
            {(mark?.windowPrintCount ?? 0) === 1 ? "" : "s"} from {windowPairs} pair
            {windowPairs === 1 ? "" : "s"} in {MARK_WINDOW_HOURS}h
            {windowPairs < MARK_CONFIDENT_PAIRS && (
              <span className="ml-2 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-danger">
                THIN
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-ink-faint">
            NPC seed price
            {mark?.bestSellTerminal
              ? ` at ${mark.bestSellTerminal}${mark.bestSellSystem ? ` · ${mark.bestSellSystem}` : ""}`
              : ""}{" "}
            — no player trades yet. The first settled trade takes this off the terminal price.
          </span>
        )}
      </div>

      {/*
        The two NPC edges, each with the terminal offering it. They are a universe-wide max
        and a universe-wide min, so they usually aren't the same place and often aren't the
        same system — printing them bare invites reading them as a spread. A player price,
        by contrast, is quoted where the trader already is.
      */}
      <div className="mb-4 grid gap-2 text-xs sm:grid-cols-2">
        {(
          [
            {
              label: "Best NPC payout",
              price: mark?.bestSell,
              terminal: mark?.bestSellTerminal,
              system: mark?.bestSellSystem,
              bulk: mark?.bulkSell,
              bulkTerminal: mark?.bulkSellTerminal,
              bulkSystem: mark?.bulkSellSystem,
              tone: "text-up",
            },
            {
              label: "Cheapest NPC purchase",
              price: mark?.bestBuy,
              terminal: mark?.bestBuyTerminal,
              system: mark?.bestBuySystem,
              bulk: mark?.bulkBuy,
              bulkTerminal: mark?.bulkBuyTerminal,
              bulkSystem: mark?.bulkBuySystem,
              tone: "text-ink",
            },
          ] as const
        ).map((row) => {
          const differs = row.bulk != null && row.price != null && Number(row.bulk) !== Number(row.price);
          return (
            <div key={row.label} className="rounded border border-line bg-panel px-3 py-2">
              <div className="text-ink-faint">{row.label}</div>
              <div className={`num ${row.tone}`}>{fmtAuec(row.price ?? null)}</div>
              <div className="text-ink-faint">
                {row.terminal ? (
                  <>
                    {row.terminal}
                    {row.system ? <span className="text-ink-faint/70"> · {row.system}</span> : null}
                  </>
                ) : (
                  "no terminal trades this side"
                )}
              </div>
              {/*
                The headline figure is the best price at ANY terminal, and that terminal may
                hold three SCU. Anyone actually hauling needs the best price somewhere that can
                fill a hold, which is frequently a different place and a worse number.
              */}
              <div className="mt-1 border-t border-line/60 pt-1">
                {row.bulk != null ? (
                  <>
                    <span className="num text-ink-dim">{fmtAuec(String(row.bulk))}</span>
                    <span className="ml-1 text-ink-faint">
                      at {BULK_SCU_THRESHOLD}+ SCU
                      {row.bulkTerminal ? ` · ${row.bulkTerminal}` : ""}
                      {row.bulkSystem ? ` · ${row.bulkSystem}` : ""}
                    </span>
                    {differs && <span className="ml-1 text-accent" title="Bulk quantity trades at a different terminal and a different price">≠</span>}
                  </>
                ) : (
                  <span className="text-ink-faint">
                    no terminal handles {BULK_SCU_THRESHOLD}+ SCU on this side
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {npcSplit && (
        <p className="mb-4 text-xs text-ink-faint">
          ⇄ Those two terminals are in different systems, so the gap between them is not a
          spread you can capture standing still — it is the reward for the trip, minus fuel,
          time and whatever meets you on the way.
        </p>
      )}
      <ReferenceChart
        commodityId={commodity.id}
        candles1h={candles1h}
        candles1d={candles1d}
        wsUrl={wsUrl}
      />
      <TapePanel commodityId={commodity.id} initial={tape} wsUrl={wsUrl} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-bold text-up">Sell to terminal — best payout first</h2>
          <Table rows={sellers} priceKey="priceSell" scuKey="scuSell" priceLabel="Pays / SCU" scuLabel="Demand" accent="text-up" />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink">Buy from terminal — cheapest first</h2>
          <Table rows={buyers} priceKey="priceBuy" scuKey="scuBuy" priceLabel="Costs / SCU" scuLabel="Stock" accent="text-ink" />
        </section>
      </div>
    </>
  );
}
