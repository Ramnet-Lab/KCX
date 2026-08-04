"use client";

import type { BazaarThreadDto } from "@kcx/db";
import { useCallback, useEffect, useState } from "react";
import { fmtAuec } from "@/lib/countdown";

const MESSAGE_MAX = 2000;

/**
 * One negotiation, read and written in place.
 *
 * Offers render inside the conversation rather than in a panel beside it, because an offer
 * is a thing someone said — pulling them out produces two histories that have to be
 * interleaved to make sense, and the interleaving IS the negotiation.
 */
export function BazaarThreadPanel({
  threadId,
  onChanged,
  compact = false,
}: {
  threadId: string;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [thread, setThread] = useState<BazaarThreadDto | null>(null);
  const [body, setBody] = useState("");
  const [offer, setOffer] = useState("");
  const [offerQty, setOfferQty] = useState("1");
  const [offering, setOffering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bazaar/threads/${threadId}`, { cache: "no-store" });
    if (res.ok) setThread((await res.json()).thread ?? null);
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const price = offering ? Math.round(Number(offer)) : null;
    if (!body.trim() && !(price && price > 0)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bazaar/threads/${threadId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: body.trim() || undefined,
          ...(price && price > 0
            ? { offerUnitPrice: price, offerQuantity: Math.max(1, Math.round(Number(offerQty) || 1)) }
            : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Could not send that");
        return;
      }
      setBody("");
      setOffer("");
      setOffering(false);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const actOnOffer = async (messageId: number, action: "accept" | "decline" | "withdraw") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bazaar/offers/${messageId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Could not do that");
        return;
      }
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  if (!thread) return <p className="text-xs text-ink-faint">loading conversation…</p>;

  return (
    <div>
      <div
        className={`space-y-2 overflow-y-auto rounded border border-line bg-bg p-2 ${compact ? "max-h-64" : "max-h-96"}`}
      >
        {thread.messages.length === 0 && (
          <p className="px-1 py-2 text-xs text-ink-faint">Nothing said yet.</p>
        )}
        {thread.messages.map((m) => {
          if (m.kind === "system") {
            return (
              <p key={m.id} className="px-1 text-center text-[11px] italic text-ink-faint">
                {m.body}
              </p>
            );
          }
          const mine = m.isMine;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded px-2 py-1.5 ${
                  mine ? "bg-accent/10 text-ink" : "bg-panel-2 text-ink"
                }`}
              >
                <div className="text-[10px] text-ink-faint">
                  {mine ? "you" : m.senderName}
                  <span className="ml-2" suppressHydrationWarning>
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
                {m.body && <p className="mt-0.5 whitespace-pre-wrap text-xs">{m.body}</p>}

                {m.offerStatus && (
                  <div
                    className={`mt-1.5 rounded border px-2 py-1.5 ${
                      m.offerStatus === "open" ? "border-accent/50 bg-accent/5" : "border-line"
                    }`}
                  >
                    <div className="num text-sm font-bold text-up">
                      {fmtAuec(m.offerUnitPrice ?? 0)} aUEC
                      {(m.offerQuantity ?? 1) > 1 && (
                        <span className="text-xs font-normal text-ink-dim"> each × {m.offerQuantity}</span>
                      )}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint">
                      {m.offerStatus === "open" ? "offer on the table" : `offer ${m.offerStatus}`}
                    </div>

                    {m.offerStatus === "open" && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                        {mine ? (
                          <button
                            onClick={() => actOnOffer(m.id, "withdraw")}
                            disabled={busy}
                            className="tap rounded border border-line px-2 py-0.5 text-ink-faint hover:text-danger disabled:opacity-40"
                          >
                            withdraw
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => actOnOffer(m.id, "accept")}
                              disabled={busy}
                              className="tap rounded bg-up/20 px-2 py-0.5 font-bold text-up hover:bg-up/30 disabled:opacity-40"
                            >
                              accept
                            </button>
                            <button
                              onClick={() => actOnOffer(m.id, "decline")}
                              disabled={busy}
                              className="tap rounded border border-line px-2 py-0.5 text-ink-faint hover:text-danger disabled:opacity-40"
                            >
                              decline
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-2 rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}

      <div className="mt-2 space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={MESSAGE_MAX}
          placeholder="Ask a question, or say where you'll meet…"
          aria-label="Message"
          className="w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />

        {offering && (
          <div className="flex flex-wrap items-end gap-2 rounded border border-accent/40 bg-accent/5 p-2">
            <label className="flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                Price each (aUEC)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
              />
            </label>
            <label className="w-20">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Qty</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={offerQty}
                onChange={(e) => setOfferQty(e.target.value)}
                className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
              />
            </label>
            <p className="w-full text-[11px] text-ink-faint">
              Only they can accept it. Accepting strikes the sale and commits the buyer&apos;s
              aUEC — you still meet in-game and both confirm.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={send}
            disabled={busy || (!body.trim() && !(Number(offer) > 0))}
            className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            {busy ? "…" : offering ? "Send offer" : "Send"}
          </button>
          <button
            onClick={() => setOffering((v) => !v)}
            className="tap rounded border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          >
            {offering ? "drop the offer" : "attach an offer"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * First contact from a listing page.
 *
 * Opening the conversation and sending the first message are one action: a thread with
 * nothing in it is a notification the seller can do nothing with.
 */
export function StartBazaarThread({
  listingId,
  existingThreadId,
  signedIn,
  verified,
  isOwner,
  intent,
}: {
  listingId: string;
  existingThreadId: string | null;
  signedIn: boolean;
  verified: boolean;
  isOwner: boolean;
  intent: string;
}) {
  const [threadId, setThreadId] = useState(existingThreadId);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The owner's own conversations live on their desk — there may be a dozen of them, and a
  // listing page is the wrong place to try to hold all of them at once.
  if (isOwner) return null;

  if (threadId) {
    return (
      <div className="rounded border border-line bg-panel p-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Your conversation</h2>
        <BazaarThreadPanel threadId={threadId} compact />
      </div>
    );
  }

  const start = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bazaar/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, body: body.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Could not send that");
        return;
      }
      setThreadId(payload.threadId);
    } finally {
      setBusy(false);
    }
  };

  const verb = intent === "buy" ? "the buyer" : "the seller";

  return (
    <div className="rounded border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-bold text-ink">Questions?</h2>
      {!signedIn ? (
        <p className="text-[11px] text-ink-faint">Sign in to message {verb}.</p>
      ) : !verified ? (
        <p className="text-[11px] text-ink-faint">Verify your RSI handle to message {verb}.</p>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          className="tap w-full rounded border border-accent/60 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10"
        >
          Message {verb}
        </button>
      ) : (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={MESSAGE_MAX}
            placeholder="Does it come with the S4 shields? Where would you hand it over?"
            aria-label="Message"
            className="w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {error && <p className="text-[11px] text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={start}
              disabled={busy || !body.trim()}
              className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
            <button onClick={() => setOpen(false)} className="tap text-[11px] text-ink-faint hover:text-ink">
              cancel
            </button>
          </div>
          <p className="text-[11px] text-ink-faint">
            Private between the two of you. You can attach a price once the conversation is open.
          </p>
        </div>
      )}
    </div>
  );
}
