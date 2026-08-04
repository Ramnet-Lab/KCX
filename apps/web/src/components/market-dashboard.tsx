"use client";

import type { IndexLatest, IndexSeries, TickerEntry, TickerUpdate } from "@kcx/shared";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { IndexPanel } from "@/components/index-panel";
import { OrderModal, type OrderModalSeed } from "@/components/order-modal";
import { TickerWall } from "@/components/ticker-wall";
import { loadPortfolio, recordPortfolioHistoryPoint } from "@/lib/portfolio";
import { useTickerFeed } from "@/lib/use-market-feed";

type Props = {
  initialEntries: TickerEntry[];
  initialSeries: IndexSeries;
  initialLatest: IndexLatest[];
  wsUrl: string;
  signedIn: boolean;
};

/** Owns the single socket.io subscription; children render its live state. */
export function MarketDashboard({ initialEntries, initialSeries, initialLatest, wsUrl, signedIn }: Props) {
  const [entries, setEntries] = useState<TickerEntry[]>(initialEntries);
  const [indexLatest, setIndexLatest] = useState<IndexLatest[]>(initialLatest);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [orderSeed, setOrderSeed] = useState<OrderModalSeed | null>(null);
  const router = useRouter();

  const openOrder = useCallback((seed: OrderModalSeed) => setOrderSeed(seed), []);

  // The shared parked socket, not a second connection of our own — see lib/use-market-feed.
  useTickerFeed(wsUrl, (payload: TickerUpdate) => {
    setEntries(payload.entries);
    setIndexLatest(payload.indexLatest ?? []);
    setLastUpdate(payload.at);
    setFlash(true);
    setTimeout(() => setFlash(false), 1200);
    // Record a true account-value point per market capture (see lib/portfolio.ts).
    try {
      const p = loadPortfolio();
      if (p.auec > 0 || p.holdings.length > 0) {
        const prices = new Map(payload.entries.map((e) => [e.commodityId, e.price]));
        const holdingsValue = p.holdings.reduce((sum, h) => {
          const price = prices.get(h.commodityId);
          return sum + (price != null ? h.scu * price : 0);
        }, 0);
        recordPortfolioHistoryPoint(Math.floor(new Date(payload.at).getTime() / 1000), p.auec + holdingsValue);
      }
    } catch {
      /* recording is best-effort */
    }
  });

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => openOrder({})}
          className="rounded border border-accent/60 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/10"
        >
          + Place order
        </button>
      </div>
      <IndexPanel
        series={initialSeries}
        latest={indexLatest}
        latestAt={lastUpdate}
        entries={entries}
        onPlaceOrder={openOrder}
      />
      <TickerWall entries={entries} lastUpdate={lastUpdate} flash={flash} onPlaceOrder={openOrder} />
      <OrderModal
        open={orderSeed !== null}
        seed={orderSeed ?? {}}
        entries={entries}
        signedIn={signedIn}
        onClose={() => setOrderSeed(null)}
        onPlaced={() => router.refresh()}
      />
    </>
  );
}
