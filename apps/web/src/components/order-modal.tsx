"use client";

import {
  FILL_BY_CHOICES,
  FILL_BY_DEFAULT_HOURS,
  priceVsBaselinePct,
  referencePrice,
  type OrderSide,
  type TickerEntry,
} from "@kcx/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type OrderModalSeed = {
  commodityId?: number;
  side?: OrderSide;
  quantityScu?: number;
  pricePerScu?: number;
};

type Props = {
  open: boolean;
  seed: OrderModalSeed;
  entries: TickerEntry[];
  /** Null when signed out — the form is replaced by a sign-in prompt. */
  signedIn: boolean;
  onClose: () => void;
  onPlaced?: () => void;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Place-an-order dialog, shared by every entry point (tile, list row, portfolio, toolbar).
 *
 * Price policy: the NPC baseline is shown as CONTEXT only — any premium or discount is
 * accepted and submitted verbatim. Nothing here clamps, warns-blocking, or rejects a price.
 */
export function OrderModal({ open, seed, entries, signedIn, onClose, onPlaced }: Props) {
  const [side, setSide] = useState<OrderSide>(seed.side ?? "buy");
  const [commodityId, setCommodityId] = useState<number | null>(seed.commodityId ?? null);
  const [pick, setPick] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [minFill, setMinFill] = useState("");
  const [notes, setNotes] = useState("");
  const [fillByHours, setFillByHours] = useState<number>(FILL_BY_DEFAULT_HOURS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [capacity, setCapacity] = useState<{ sellAvailable?: number; buyAvailable?: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(entries.map((e) => [e.commodityId, e])), [entries]);
  const byLabel = useMemo(() => new Map(entries.map((e) => [`${e.code} — ${e.name}`, e])), [entries]);
  const commodity = commodityId != null ? byId.get(commodityId) : undefined;

  // Seed once per open (keyed on the seed itself). Must NOT re-run when `entries` changes:
  // a live ticker update arriving mid-form would otherwise wipe what the user is typing.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    const key = JSON.stringify(seed);
    if (seededFor.current === key) return;
    seededFor.current = key;
    setSide(seed.side ?? "buy");
    setCommodityId(seed.commodityId ?? null);
    setPick(seed.commodityId != null ? (byId.get(seed.commodityId)?.name ?? "") : "");
    setQuantity(seed.quantityScu != null ? String(seed.quantityScu) : "");
    // Default the price to the market reference so the field is never empty-hostile: the
    // player mark once one exists, the side-appropriate NPC edge before that.
    const e = seed.commodityId != null ? byId.get(seed.commodityId) : undefined;
    const ref = seed.pricePerScu ?? (e ? referencePrice(e, seed.side ?? "buy") : null);
    setPrice(ref != null ? String(Math.round(ref)) : "");
    setMinFill("");
    setNotes("");
    setFillByHours(FILL_BY_DEFAULT_HOURS);
    setError(null);
    setDone(false);
  }, [open, seed, byId]);

  /** What the trader can actually back — no shorting, no margin. */
  const loadCapacity = useCallback(async () => {
    if (!open || commodityId == null) return setCapacity(null);
    try {
      const res = await fetch(`/api/orders/capacity?commodityId=${commodityId}`);
      if (!res.ok) return setCapacity(null);
      const body = await res.json();
      setCapacity({ sellAvailable: body.sell?.available, buyAvailable: body.buy?.available });
    } catch {
      setCapacity(null);
    }
  }, [open, commodityId]);
  useEffect(() => {
    void loadCapacity();
  }, [loadCapacity]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const priceNum = Number(price);
  const qtyNum = Number(quantity);
  const baseline = { bestBuy: commodity?.bestBuy ?? null, bestSell: commodity?.bestSell ?? null };
  const vsBaseline =
    commodity && Number.isFinite(priceNum) && priceNum > 0
      ? priceVsBaselinePct(side, priceNum, baseline)
      : null;
  const refPrice = side === "buy" ? baseline.bestBuy : baseline.bestSell;
  const totalValue = Number.isFinite(priceNum) && Number.isFinite(qtyNum) ? priceNum * qtyNum : 0;

  // Collateral: a sell needs the cargo, a buy needs the aUEC. Checked here for immediate
  // feedback and again server-side (which is authoritative).
  const sellAvail = capacity?.sellAvailable;
  const buyAvail = capacity?.buyAvailable;
  const orderCost = totalValue;
  const collateralError =
    side === "sell" && sellAvail != null && qtyNum > sellAvail
      ? sellAvail === 0
        ? "You don't hold any of this commodity — add it to your portfolio first."
        : `Only ${fmt(sellAvail)} SCU available (the rest is committed to other sell orders).`
      : side === "buy" && buyAvail != null && orderCost > buyAvail
        ? `Costs ${fmt(orderCost)} aUEC — you have ${fmt(buyAvail)} available.`
        : null;

  const canSubmit =
    commodityId != null &&
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    !collateralError &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commodityId,
          side,
          pricePerScu: Math.round(priceNum),
          quantityScu: Math.round(qtyNum),
          fillByHours,
          ...(minFill && Number(minFill) > 0 ? { minFillScu: Math.round(Number(minFill)) } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not place order");
        return;
      }
      setDone(true);
      onPlaced?.();
      setTimeout(onClose, 900);
    } catch {
      setError("Network error — order not placed");
    } finally {
      setSubmitting(false);
    }
  };

  const sideLabel = side === "buy" ? "BUY / WTB" : "SELL / WTS";
  const priceHint =
    side === "buy"
      ? "What you'll pay per SCU. Terminals charge:"
      : "What you're asking per SCU. Terminals pay:";

  return (
    <div
      // Bottom sheet on phones, centred dialog on desktop. `pointerdown` rather than
      // `mousedown` so a backdrop tap dismisses on touch too.
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/70 sm:items-start sm:p-4 sm:pt-[8vh]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Place an order"
    >
      <div
        ref={dialogRef}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border border-line bg-panel shadow-2xl sm:max-h-none sm:max-w-lg sm:rounded"
      >
        {/* Sticky header so Close stays reachable while the form scrolls under a keyboard. */}
        <div className="sticky top-0 z-10 flex items-center border-b border-line bg-panel px-4 py-3">
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" />
          <h2 className="text-sm font-bold text-ink">Place order</h2>
          <button
            onClick={onClose}
            className="tap ml-auto px-2 py-1 text-lg leading-none text-ink-faint hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!signedIn ? (
          // The API rejects unauthenticated orders anyway; showing the form first would
          // just waste the trader's time filling it in.
          <div className="p-6 text-center">
            <p className="mb-1 text-sm text-ink">Sign in to place orders</p>
            <p className="mb-4 text-xs text-ink-dim">
              Orders are backed by your declared holdings and balance, and settle between two
              named traders — so KCX needs to know who you are before you can post one.
            </p>
            <a
              href="/signin"
              className="inline-block rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10"
            >
              Sign in
            </a>
            <p className="mt-3 text-[11px] text-ink-faint">Browsing prices needs no account.</p>
          </div>
        ) : done ? (
          <div className="p-8 text-center">
            <div className="mb-1 text-2xl text-up">✓</div>
            <p className="text-sm text-ink">Order posted to the board.</p>
            <p className="mt-1 text-xs text-ink-faint">
              It rests until filled or its fill-by deadline, whichever comes first.
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {/* Side */}
            <div className="flex rounded border border-line">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`flex-1 px-3 py-1.5 text-xs font-bold ${
                    side === s
                      ? s === "buy"
                        ? "bg-up/15 text-up"
                        : "bg-down/15 text-down"
                      : "text-ink-faint hover:text-ink-dim"
                  }`}
                >
                  {s === "buy" ? "BUY / WTB" : "SELL / WTS"}
                </button>
              ))}
            </div>

            {/* Commodity */}
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Commodity</span>
              {seed.commodityId != null && commodity ? (
                <div className="mt-1 rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink">
                  <span className="mr-2 text-xs text-ink-faint">{commodity.code}</span>
                  {commodity.name}
                  {commodity.isIllegal && <span className="ml-2 text-[10px] font-bold text-danger">CONTRABAND</span>}
                </div>
              ) : (
                <>
                  <input
                    list="kcx-order-commodity"
                    value={pick}
                    onChange={(e) => {
                      setPick(e.target.value);
                      const match = byLabel.get(e.target.value);
                      setCommodityId(match?.commodityId ?? null);
                      if (match) {
                        const ref = referencePrice(match, side);
                        if (ref != null && !price) setPrice(String(Math.round(ref)));
                      }
                    }}
                    placeholder="Search ticker or name…"
                    className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
                  />
                  <datalist id="kcx-order-commodity">
                    {entries.map((e) => (
                      <option key={e.commodityId} value={`${e.code} — ${e.name}`} />
                    ))}
                  </datalist>
                </>
              )}
            </label>

            {/* Price + quantity */}
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Price / SCU</span>
                <input
                  type="number" inputMode="numeric"
                  min={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:border-ink-faint focus:outline-none"
                />
              </label>
              <label className="flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Quantity SCU</span>
                <input
                  type="number" inputMode="numeric"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:border-ink-faint focus:outline-none"
                />
              </label>
            </div>

            {/* Baseline context — informational only, never a constraint */}
            <div className="rounded border border-line/60 bg-panel-2 px-3 py-2 text-xs">
              <div className="flex justify-between text-ink-dim">
                <span>
                  {priceHint} <span className="num text-ink">{refPrice != null ? fmt(refPrice) : "—"}</span>
                </span>
                {vsBaseline != null && (
                  <span className={vsBaseline === 0 ? "text-ink-dim" : vsBaseline > 0 ? "text-up" : "text-down"}>
                    {vsBaseline > 0 ? "+" : ""}
                    {vsBaseline.toFixed(1)}% vs NPC
                  </span>
                )}
              </div>
              {totalValue > 0 && (
                <div className="mt-1 flex justify-between text-ink-dim">
                  <span>Order value</span>
                  <span className="num text-ink">{fmt(totalValue)} aUEC</span>
                </div>
              )}
            </div>

            {/* Fill-by deadline */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Fill by</span>
              <div className="mt-1 flex gap-1">
                {FILL_BY_CHOICES.map((c) => (
                  <button
                    key={c.hours}
                    onClick={() => setFillByHours(c.hours)}
                    className={`flex-1 rounded border px-2 py-1 text-xs ${
                      fillByHours === c.hours
                        ? "border-accent text-accent"
                        : "border-line text-ink-faint hover:text-ink-dim"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-ink-faint">
                Unfilled by then, the order closes as <span className="text-ink-dim">not filled</span> and leaves
                the market price untouched.
              </p>
            </div>

            {/* Collateral */}
            {(sellAvail != null || buyAvail != null) && (
              <div className="flex justify-between rounded border border-line/60 bg-panel-2 px-3 py-2 text-xs text-ink-dim">
                <span>{side === "sell" ? "Cargo available to list" : "aUEC available to commit"}</span>
                <span className="num text-ink">
                  {side === "sell"
                    ? sellAvail != null
                      ? `${fmt(sellAvail)} SCU`
                      : "—"
                    : buyAvail != null
                      ? fmt(buyAvail)
                      : "—"}
                </span>
              </div>
            )}
            {collateralError && (
              <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {collateralError}
              </div>
            )}

            {/* Optional details */}
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-faint hover:text-ink-dim">Optional details</summary>
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    Minimum fill (SCU)
                  </span>
                  <input
                    type="number" inputMode="numeric"
                    min={1}
                    value={minFill}
                    onChange={(e) => setMinFill(e.target.value)}
                    placeholder="1 — accept any partial fill"
                    className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-ink placeholder:text-left placeholder:text-ink-faint focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Notes</span>
                  <textarea
                    value={notes}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Delivery preferences, meeting spot, timing…"
                    className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-ink placeholder:text-ink-faint focus:outline-none"
                  />
                </label>
              </div>
            </details>

            {error && <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={submit}
                disabled={!canSubmit}
                className={`rounded px-4 py-1.5 text-sm font-bold ${
                  canSubmit
                    ? side === "buy"
                      ? "bg-up/20 text-up hover:bg-up/30"
                      : "bg-down/20 text-down hover:bg-down/30"
                    : "cursor-not-allowed bg-panel-2 text-ink-faint"
                }`}
              >
                {submitting ? "Posting…" : `Post ${sideLabel}`}
              </button>
              <span className="text-[11px] text-ink-faint">
                Settles in-game between players — KCX never holds aUEC or cargo.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
