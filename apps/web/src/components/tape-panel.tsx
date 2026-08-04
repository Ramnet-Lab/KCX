"use client";

import type { TapePrint } from "@kcx/db";
import { useCallback, useEffect, useState } from "react";
import { useMarketFeed } from "@/lib/use-market-feed";

type Props = {
  commodityId: number;
  initial: TapePrint[];
  wsUrl: string;
};

/** Why a print was withheld from the mark, in words a trader can act on. */
const EXCLUSION_COPY: Record<string, string> = {
  outlier: "Price far outside the reference band",
  pair_rate_limit: "These two accounts have already set this week's prices",
  share_cap: "One account would be most of the recent volume",
  unverified: "A party was not RSI-verified",
  mod: "Withheld by a moderator",
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86_400)}d`;
}

/**
 * The tape — every settled trade in this commodity, quarantined ones included.
 *
 * Showing the excluded prints is the entire point. The mark is a public number that anyone
 * can be affected by, so the trades behind it, and the trades that were refused and why,
 * have to be inspectable. A tape that silently dropped the rejected prints would look
 * cleanest exactly when someone was trying something.
 */
export function TapePanel({ commodityId, initial, wsUrl }: Props) {
  const [prints, setPrints] = useState<TapePrint[]>(initial);
  const [showExcluded, setShowExcluded] = useState(true);

  useEffect(() => setPrints(initial), [initial]);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/prints?commodityId=${commodityId}&limit=50`, { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { prints: TapePrint[] };
    setPrints(body.prints ?? []);
  }, [commodityId]);

  useMarketFeed(wsUrl, (update) => {
    // Any contract event in this commodity can produce a print — including one that was
    // quarantined, which carries priceMoved: false but still belongs on the tape.
    if (update && update.commodityId !== commodityId) return;
    void reload().catch(() => {});
  });

  const visible = showExcluded ? prints : prints.filter((p) => !p.excluded);
  const excludedCount = prints.filter((p) => p.excluded).length;

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-bold text-ink">The tape</h2>
        <span className="text-xs text-ink-faint">
          settled player trades — what actually moves the mark
        </span>
        {excludedCount > 0 && (
          <button
            onClick={() => setShowExcluded((v) => !v)}
            className="ml-auto rounded border border-line px-2 py-0.5 text-xs text-ink-dim hover:text-ink"
          >
            {showExcluded ? "Hide" : "Show"} {excludedCount} withheld
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full bg-panel text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2 text-right">Price / SCU</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2">Seller → Buyer</th>
              <th className="px-3 py-2">Counts</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-faint">
                  No player trades yet — this commodity is still on the NPC seed price.
                </td>
              </tr>
            )}
            {visible.map((p) => (
              <tr key={p.id} className={`border-b border-line/50 ${p.excluded ? "opacity-60" : ""}`}>
                <td className="num px-3 py-1.5 text-ink-faint">{timeAgo(p.executedAt)} ago</td>
                <td className={`num px-3 py-1.5 text-right ${p.excluded ? "text-ink-dim line-through" : "text-up"}`}>
                  {fmt(p.pricePerScu)}
                </td>
                <td className="num px-3 py-1.5 text-right text-ink-dim">{fmt(p.quantityScu)}</td>
                <td className="px-3 py-1.5 text-xs text-ink-dim">
                  {p.sellerHandle ?? "—"} <span className="text-ink-faint">→</span> {p.buyerHandle ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {p.excluded ? (
                    <span className="text-danger" title={EXCLUSION_COPY[p.exclusionReason ?? ""] ?? undefined}>
                      withheld · {EXCLUSION_COPY[p.exclusionReason ?? ""] ?? p.exclusionReason}
                    </span>
                  ) : (
                    <span className="text-up">counts</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
