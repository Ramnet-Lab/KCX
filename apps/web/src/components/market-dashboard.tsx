"use client";

import type { IndexLatest, IndexSeries, TickerEntry, TickerUpdate } from "@kcx/shared";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { FeedbackPanel } from "@/components/feedback-panel";
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
      {/*
        The ideas rail goes in the page's right MARGIN, not in a column carved out of the
        content. `main` is capped at max-w-6xl and centred, so on a wide monitor there is
        dead space either side of it; the negative right margin lets this grid spill into
        that space and gives the rail a column of its own. The chart and the wall keep the
        exact width they had — nothing is squeezed to make room.

        1800px is where the spill actually fits: (1800 − 1152) / 2 = 324px of margin, plus
        main's own 16px of padding, against a 304px rail and a 24px gap. Below that there
        is no margin worth the name, so the grid collapses and the rail sits under the
        chart at full width — same place it lands on a phone.
      */}
      <div className="min-[1800px]:-mr-[20.5rem]">
        <div className="min-[1800px]:grid min-[1800px]:grid-cols-[minmax(0,1fr)_19rem] min-[1800px]:gap-6">
          <div className="mb-6 min-w-0 min-[1800px]:col-start-1 min-[1800px]:row-start-1">
            <IndexPanel
              series={initialSeries}
              latest={indexLatest}
              latestAt={lastUpdate}
              entries={entries}
              onPlaceOrder={openOrder}
            />
          </div>
          {/* Spans both rows so the rail can run the height of the chart and the wall. */}
          <div className="mb-6 min-[1800px]:col-start-2 min-[1800px]:row-span-2 min-[1800px]:row-start-1 min-[1800px]:mb-0">
            <FeedbackPanel signedIn={signedIn} />
          </div>
          <div className="min-w-0 min-[1800px]:col-start-1 min-[1800px]:row-start-2">
            <TickerWall entries={entries} lastUpdate={lastUpdate} flash={flash} onPlaceOrder={openOrder} />
          </div>
        </div>
      </div>
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
