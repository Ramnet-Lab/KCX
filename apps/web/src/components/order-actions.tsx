"use client";

import type { OrderDto } from "@kcx/shared";
import { useState } from "react";

/**
 * Board controls. Owners can cancel; everyone else claims the order into an escrow
 * contract, which locks the quantity so other traders stop chasing it.
 *
 * There is no self-fill: a trade only settles when both parties confirm the contract.
 */
export function OrderActions({ order, signedIn }: { order: OrderDto; signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = order.remainingScu - order.reservedScu;
  const fullyClaimed = available <= 0;

  const run = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: url.includes("/claim") ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      // Success needs no local refresh — the server's change feed pushes the new state
      // to every connected client, including this one.
      if (!res.ok) setError(payload.error ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (order.isMine) {
    return (
      <span className="flex items-center gap-1.5 text-[10px]">
        {order.reservedScu > 0 && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-bold text-accent">
            {order.reservedScu} SCU IN CONTRACT
          </span>
        )}
        <button
          onClick={() => run(`/api/orders/${order.id}`, { action: "cancel" })}
          disabled={busy}
          className="text-ink-faint hover:text-danger disabled:opacity-50"
          title={
            order.reservedScu > 0
              ? "Cancelling won't undo contracts already in escrow"
              : "Cancel this order"
          }
        >
          cancel
        </button>
        {error && <span className="text-danger">{error}</span>}
      </span>
    );
  }

  if (fullyClaimed) {
    return <span className="text-[10px] text-ink-faint">locked in contract</span>;
  }

  return (
    <span className="flex items-center gap-1.5 text-[10px]">
      <button
        onClick={() => run(`/api/orders/${order.id}/claim`, {})}
        disabled={busy || !signedIn}
        title={
          signedIn
            ? `Lock ${available} SCU into an escrow contract with ${order.ownerDisplayName}`
            : "Sign in to claim orders"
        }
        className="rounded bg-accent/15 px-1.5 py-0.5 font-bold text-accent hover:bg-accent/25 disabled:opacity-40"
      >
        CLAIM {available} SCU
      </button>
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}
