"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StarPicker } from "@/components/trader-standing";

export type PendingRating = {
  tradeId: string;
  counterpartyId: string;
  counterpartyName: string;
  commodityName: string;
};

/**
 * Rate the other party after a settled contract.
 *
 * Only ever offered for contracts that actually settled and that this trader was party to —
 * the server enforces both, once each. Stars sit alongside the objective completion record
 * rather than replacing it.
 */
export function RateContracts({ pending }: { pending: PendingRating[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState<Record<string, number>>({});
  const router = useRouter();

  const outstanding = pending.filter((p) => !done.has(p.tradeId));
  if (outstanding.length === 0) return null;

  const submit = async (p: PendingRating) => {
    const value = stars[p.tradeId];
    if (!value) return;
    setBusy(p.tradeId);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${p.tradeId}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stars: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save rating");
        return;
      }
      setDone((d) => new Set(d).add(p.tradeId));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold text-ink">
        Rate your counterparties ({outstanding.length})
      </h2>
      {error && (
        <div className="mb-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}
      <div className="space-y-2">
        {outstanding.map((p) => (
          <div
            key={p.tradeId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-line bg-panel p-3 text-sm"
          >
            <span className="text-ink">
              How was <span className="font-bold">{p.counterpartyName}</span>?
              <span className="ml-1 text-xs text-ink-faint">{p.commodityName}</span>
            </span>
            <span className="ml-auto flex items-center gap-2">
              <StarPicker
                value={stars[p.tradeId] ?? 0}
                onChange={(v) => setStars((s) => ({ ...s, [p.tradeId]: v }))}
                disabled={busy === p.tradeId}
              />
              <button
                onClick={() => submit(p)}
                disabled={!stars[p.tradeId] || busy === p.tradeId}
                className="tap rounded border border-accent/60 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {busy === p.tradeId ? "…" : "Submit"}
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        Stars are one half of a trader&apos;s standing; the other is their completion record,
        which is counted automatically.
      </p>
    </section>
  );
}
