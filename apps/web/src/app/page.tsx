import { getDb, indexLatest, indexSeries, tickerEntries } from "@kcx/db";
import type { IndexLatest, IndexSeries, TickerEntry } from "@kcx/shared";
import { MarketDashboard } from "@/components/market-dashboard";

export const revalidate = 60;

export default async function Home() {
  let entries: TickerEntry[] = [];
  let series: IndexSeries = {};
  let latest: IndexLatest[] = [];
  try {
    const db = getDb();
    [entries, series, latest] = await Promise.all([tickerEntries(db), indexSeries(db), indexLatest(db)]);
  } catch (err) {
    // DB unreachable (e.g. during `next build` in CI) → empty dashboard; ISR heals it live.
    console.error("[home] market queries failed:", err instanceof Error ? err.message : err);
  }
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Kestrel Commodities Exchange</h1>
        <p className="text-xs text-ink-dim">
          The market at a glance — sector indices on the NPC baseline, live via the KCX feed.
          Player order flow joins the tape when the board opens.
        </p>
      </div>
      <MarketDashboard initialEntries={entries} initialSeries={series} initialLatest={latest} wsUrl={wsUrl} />
    </>
  );
}
