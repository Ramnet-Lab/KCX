"use client";

import type { MakerQuoteDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtAuec } from "@/lib/countdown";

/** "3d 4h" — uptime is the whole claim, so it has to read at a glance. */
function uptime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Who is making a market in this commodity.
 *
 * The order board shows the best price right now. This shows who will still be quoting in an
 * hour — which, for anyone trying to move real volume, is the more useful fact. Spread ranks
 * the list because a tight quote is what a trader clearing now wants; uptime and honoured
 * fills sit beside it so they can tell a tight quote from one that will still be there
 * tomorrow.
 */
export function MarketMakerPanel({
  commodityId,
  commodityName,
  quotes: initial,
  signedIn,
  verified,
  markPrice,
}: {
  commodityId: number;
  commodityName: string;
  quotes: MakerQuoteDto[];
  signedIn: boolean;
  verified: boolean;
  markPrice: number | null;
}) {
  const [quotes, setQuotes] = useState(initial);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const mine = quotes.find((q) => q.isMine) ?? null;

  const refresh = async () => {
    const res = await fetch(`/api/market-makers?commodityId=${commodityId}`, { cache: "no-store" });
    if (res.ok) setQuotes((await res.json()).quotes ?? []);
    router.refresh();
  };

  const setStatus = async (quoteId: string, status: "active" | "paused" | "retired") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/market-makers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId, status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That didn't work");
      else await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-bold text-ink">Market makers</h2>
        <span className="text-[11px] text-ink-faint">
          Traders quoting both sides, backed by declared aUEC and cargo.
        </span>
        {signedIn && verified && (
          <button
            onClick={() => setComposing((v) => !v)}
            className="tap ml-auto rounded border border-accent/60 px-2 py-1 text-xs font-bold text-accent hover:bg-accent/10"
          >
            {composing ? "Close" : mine ? "Revise my quote" : "+ Make a market"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {composing && (
        <QuoteForm
          commodityId={commodityId}
          commodityName={commodityName}
          existing={mine}
          markPrice={markPrice}
          onSaved={() => {
            setComposing(false);
            void refresh();
          }}
        />
      )}

      {quotes.length === 0 ? (
        <p className="rounded border border-dashed border-line p-6 text-center text-xs text-ink-faint">
          Nobody is making a market in {commodityName} yet. A two-sided quote is how you tell
          traders you&apos;ll still be here in an hour.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                <th className="py-1 pr-3 font-normal">Maker</th>
                <th className="py-1 pr-3 text-right font-normal">Bid</th>
                <th className="py-1 pr-3 text-right font-normal">Ask</th>
                <th className="py-1 pr-3 text-right font-normal">Spread</th>
                <th className="py-1 pr-3 text-right font-normal">Size</th>
                <th className="py-1 pr-3 text-right font-normal">Quoting</th>
                <th className="py-1 text-right font-normal">Honoured</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className={`border-b border-line/50 ${q.isMine ? "bg-accent/5" : ""}`}>
                  <td className="py-1.5 pr-3">
                    <span className="text-ink">{q.displayName}</span>
                    {q.orgSid && (
                      <span className="ml-1.5 rounded bg-panel-2 px-1 py-0.5 text-[10px] font-bold text-ink-dim">
                        {q.orgSid}
                      </span>
                    )}
                    {q.status === "paused" && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wider text-ink-faint">stood down</span>
                    )}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-up">{fmtAuec(q.bidPrice)}</td>
                  <td className="num py-1.5 pr-3 text-right text-down">{fmtAuec(q.askPrice)}</td>
                  <td className="num py-1.5 pr-3 text-right text-ink-dim">
                    {fmtAuec(q.spread)}
                    <span className="ml-1 text-[10px] text-ink-faint">{q.spreadPct.toFixed(1)}%</span>
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-ink-dim">
                    {q.bidSizeScu}/{q.askSizeScu}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-ink-dim" suppressHydrationWarning>
                    {uptime(q.activeMinutes)}
                  </td>
                  <td className="num py-1.5 text-right text-ink-dim">
                    {q.fillsHonoured > 0 ? `${q.fillsHonoured} · ${q.scuHonoured} SCU` : "—"}
                    {q.isMine && (
                      <span className="ml-2">
                        <button
                          onClick={() => setStatus(q.id, q.status === "active" ? "paused" : "active")}
                          disabled={busy}
                          className="tap text-[11px] text-ink-faint hover:text-ink disabled:opacity-40"
                        >
                          {q.status === "active" ? "stand down" : "resume"}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-1 text-[11px] text-ink-faint">
        Quoting time and honoured fills are recorded by the exchange, not claimed by the maker.
        A quote is not an obligation KCX can force — settlement is still in-game and bilateral
        — but standing one down is visibly different from leaving one up you won&apos;t honour.
      </p>
    </section>
  );
}

function QuoteForm({
  commodityId,
  commodityName,
  existing,
  markPrice,
  onSaved,
}: {
  commodityId: number;
  commodityName: string;
  existing: MakerQuoteDto | null;
  markPrice: number | null;
  onSaved: () => void;
}) {
  // Seeded a couple of percent either side of the mark, which is a sane starting spread and
  // saves the maker doing arithmetic to find one.
  const seedBid = existing?.bidPrice ?? (markPrice ? Math.floor(markPrice * 0.98) : 0);
  const seedAsk = existing?.askPrice ?? (markPrice ? Math.ceil(markPrice * 1.02) : 0);

  const [bid, setBid] = useState(seedBid ? String(seedBid) : "");
  const [ask, setAsk] = useState(seedAsk ? String(seedAsk) : "");
  const [bidSize, setBidSize] = useState(String(existing?.bidSizeScu ?? 100));
  const [askSize, setAskSize] = useState(String(existing?.askSizeScu ?? 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const b = Math.round(Number(bid));
  const a = Math.round(Number(ask));
  const valid = b > 0 && a > b && Number(bidSize) > 0 && Number(askSize) > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/market-makers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commodityId,
          bidPrice: b,
          askPrice: a,
          bidSizeScu: Math.round(Number(bidSize)),
          askSizeScu: Math.round(Number(askSize)),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save the quote");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded border border-line bg-panel p-3">
      <h3 className="mb-2 text-xs font-bold text-ink">Quote {commodityName}</h3>
      <div className="flex flex-wrap gap-3">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">You&apos;ll pay</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={bid}
            onChange={(e) => setBid(e.target.value)}
            className="num mt-1 w-28 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">for (SCU)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={bidSize}
            onChange={(e) => setBidSize(e.target.value)}
            className="num mt-1 w-20 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">You&apos;ll sell at</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            className="num mt-1 w-28 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">for (SCU)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={askSize}
            onChange={(e) => setAskSize(e.target.value)}
            className="num mt-1 w-20 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
      </div>

      {a > b && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Spread <span className="num text-ink-dim">{fmtAuec(a - b)}</span> aUEC ·{" "}
          <span className="num text-ink-dim">{(((a - b) / ((a + b) / 2)) * 100).toFixed(1)}%</span>. Backing needed:{" "}
          <span className="num text-ink-dim">{fmtAuec(b * Math.round(Number(bidSize) || 0))}</span> aUEC and{" "}
          <span className="num text-ink-dim">{Math.round(Number(askSize) || 0)}</span> SCU of declared cargo.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

      <button
        onClick={submit}
        disabled={!valid || busy}
        className="tap mt-2 rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        {busy ? "…" : existing ? "Update quote" : "Start quoting"}
      </button>
      <p className="mt-1 text-[11px] text-ink-faint">
        Revising prices doesn&apos;t reset your quoting time — adjusting to the market is still
        making it. Only actually standing down stops the clock.
      </p>
    </div>
  );
}
