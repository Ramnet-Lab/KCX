import { commodities, getDb, locations, referenceCandles, terminalPricesLatest, terminals } from "@kcx/db";
import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReferenceChart, type CandlePoint } from "@/components/reference-chart";
import { fmtAuec, fmtScu, timeAgo } from "@/lib/format";

export const revalidate = 120;

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

  const [prices, paths, candles1h, candles1d] = await Promise.all([
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
  ]);

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
      <ReferenceChart candles1h={candles1h} candles1d={candles1d} />
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
