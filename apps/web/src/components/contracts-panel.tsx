"use client";

import type { ContractDto } from "@kcx/db";
import { useCallback, useEffect, useState } from "react";
import { useMarketFeed } from "@/lib/use-market-feed";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expiring";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

/**
 * Escrow contracts the trader is party to. A contract only resolves two ways: both sides
 * confirm (goods and aUEC move, the trade prints) or someone cancels and the order goes
 * back on the board.
 */
export function ContractsPanel({
  contracts: initialContracts,
  wsUrl,
  userId,
}: {
  contracts: ContractDto[];
  wsUrl: string;
  userId: string | null;
}) {
  const [contracts, setContracts] = useState(initialContracts);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setContracts(initialContracts), [initialContracts]);

  // A counterparty claiming your order, or confirming their side, shows up immediately.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/contracts?open=1", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setContracts(body.contracts ?? []);
    } catch {
      /* transient */
    }
  }, []);
  useMarketFeed(wsUrl, refresh, userId);

  const act = async (id: string, action: "confirm" | "cancel") => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Failed");
      else await refresh();
    } finally {
      setBusy(null);
    }
  };

  const open = contracts.filter((c) => c.status === "escrow");
  if (open.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold text-accent">
        Your contracts in escrow ({open.length})
      </h2>
      {error && (
        <div className="mb-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}
      <div className="space-y-2">
        {open.map((c) => (
          <div key={c.id} className="rounded border border-accent/40 bg-panel p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-bold text-ink">
                {c.iDeliverCargo ? "You deliver" : "You receive"} {fmt(c.quantityScu)} SCU {c.commodityName}
              </span>
              <span className="num text-ink-dim">
                @ {fmt(c.pricePerScu)} = {fmt(c.value)} aUEC
              </span>
              <span className={`num ${c.iDeliverCargo ? "text-up" : "text-down"}`}>
                {c.iDeliverCargo ? `+${fmt(c.value)} aUEC to you` : `−${fmt(c.value)} aUEC from you`}
              </span>
              <span suppressHydrationWarning className="ml-auto text-xs text-ink-faint">{timeLeft(c.expiresAt)}</span>
            </div>

            <div className="mt-1 text-xs text-ink-dim">
              Counterparty <span className="text-ink">{c.counterpartyDisplayName}</span> · settle in-game, then both
              confirm here.
              {c.theyConfirmed && <span className="ml-1 text-up">They&apos;ve confirmed.</span>}
              {c.iConfirmed && !c.theyConfirmed && (
                <span className="ml-1 text-accent">Waiting on them to confirm.</span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => act(c.id, "confirm")}
                disabled={busy === c.id || c.iConfirmed}
                className={`rounded px-3 py-1 text-xs font-bold ${
                  c.iConfirmed
                    ? "cursor-default bg-panel-2 text-ink-faint"
                    : "bg-up/20 text-up hover:bg-up/30 disabled:opacity-50"
                }`}
              >
                {c.iConfirmed ? "✓ You confirmed" : "Confirm settled"}
              </button>
              <button
                onClick={() => act(c.id, "cancel")}
                disabled={busy === c.id}
                className="rounded px-3 py-1 text-xs text-ink-faint hover:text-danger disabled:opacity-50"
              >
                Cancel contract
              </button>
              <span className="text-[11px] text-ink-faint">
                Cancelling releases the lock and republishes the order.
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
