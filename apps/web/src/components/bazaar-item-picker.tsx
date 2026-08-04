"use client";

import { ITEM_NAME_MAX, isUsableItemName, itemNameKey } from "@kcx/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtAuec } from "@/lib/countdown";

export type PickedItem = { id: number | null; name: string; section?: string | null };

type Candidate = {
  id: number;
  name: string;
  section: string | null;
  category: string | null;
  companyName: string | null;
  source: string;
  listingCount: number;
};

/**
 * Naming what you're selling.
 *
 * Two things at once, and the order matters: the seller types, sees what already exists, and
 * only falls through to "it isn't in the list" if nothing matches. Offering free text first
 * would produce a catalogue of near-duplicates, and a catalogue of near-duplicates has no
 * price history in it — every misspelling is a market of one.
 *
 * The "not in the list" option is checked against the SAME normalised key the server uses,
 * so it can't offer to create something that already exists under different punctuation.
 */
export function BazaarItemPicker({
  value,
  onChange,
}: {
  value: PickedItem | null;
  onChange: (item: PickedItem | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/bazaar/items?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setResults(res.ok ? (body.items ?? []) : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200); // debounce: one request per pause, not per keystroke
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close on an outside click, so the list doesn't sit over the rest of the form.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const typedKey = itemNameKey(query);
  const exactExists = useMemo(
    () => results.some((r) => itemNameKey(r.name) === typedKey),
    [results, typedKey],
  );
  const canCreate = isUsableItemName(query) && !exactExists;

  if (value) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-accent/40 bg-accent/5 px-2 py-1.5">
        <span className="text-sm text-ink">{value.name}</span>
        {value.section && <span className="text-[10px] uppercase tracking-wider text-ink-faint">{value.section}</span>}
        {value.id == null && (
          <span
            className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim"
            title="Not in the catalogue yet — listing it adds it for everyone else"
          >
            new entry
          </span>
        )}
        <button
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          className="tap ml-auto text-[11px] text-ink-faint hover:text-ink"
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        maxLength={ITEM_NAME_MAX}
        placeholder="Start typing — e.g. Cutlass Black, P4-AR, Hercules Armor"
        aria-label="Item"
        className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
      />

      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded border border-line bg-panel shadow-lg">
          {loading && results.length === 0 && (
            <div className="px-2 py-2 text-xs text-ink-faint">searching…</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onChange({ id: r.id, name: r.name, section: r.section });
                setOpen(false);
              }}
              className="tap flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-panel-2"
            >
              <span className="text-sm text-ink">{r.name}</span>
              <span className="text-[10px] text-ink-faint">
                {[r.section, r.companyName].filter(Boolean).join(" · ")}
              </span>
              {r.listingCount > 0 && (
                <span className="num ml-auto text-[10px] text-ink-faint">{r.listingCount} listed</span>
              )}
            </button>
          ))}
          {canCreate && (
            <button
              onClick={() => {
                onChange({ id: null, name: query.trim() });
                setOpen(false);
              }}
              className="tap flex w-full items-baseline gap-2 border-t border-line px-2 py-1.5 text-left hover:bg-panel-2"
            >
              <span className="text-sm text-accent">Use &ldquo;{query.trim()}&rdquo;</span>
              <span className="text-[10px] text-ink-faint">
                not in the list — adds it for everyone else
              </span>
            </button>
          )}
          {!loading && results.length === 0 && !canCreate && (
            <div className="px-2 py-2 text-xs text-ink-faint">No match. Type the in-game inventory name.</div>
          )}
        </div>
      )}
    </div>
  );
}

export type PriceHistory = {
  itemId: number;
  itemName: string;
  sales: number;
  pairs: number;
  lastPrice: number | null;
  lastSoldAt: string | null;
  medianPrice: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  recent: { price: number; quantity: number; soldAt: string; origin: string }[];
};

/**
 * What the item last went for.
 *
 * The empty case is written out rather than hidden, because "nobody has sold one of these
 * here yet" is the single most useful thing a first seller can be told — it means the number
 * they pick IS the history, and they should not read the blank space as agreement.
 */
export function ItemPriceHistory({ itemId, compact = false }: { itemId: number | null; compact?: boolean }) {
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (itemId == null) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/bazaar/items/${itemId}/prices`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled) setHistory(b?.history ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (itemId == null) return null;
  if (loading && !history) {
    return <p className="mt-2 text-[11px] text-ink-faint">checking what these have gone for…</p>;
  }
  if (!history) return null;

  if (history.sales === 0) {
    return (
      <div className="mt-2 rounded border border-dashed border-line px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
        <span className="font-bold text-ink-dim">No settled sales yet.</span> Nobody has traded one
        of these on KCX, so there is no market price to price against — the number is your call,
        and it becomes the first data point everyone else sees.
      </div>
    );
  }

  const thin = history.pairs < 2;

  return (
    <div className="mt-2 rounded border border-line bg-panel-2 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Last sold</span>
        <span className="num text-sm font-bold text-up">{fmtAuec(history.lastPrice ?? 0)} aUEC</span>
        {history.lastSoldAt && (
          <span className="text-[11px] text-ink-faint" suppressHydrationWarning>
            {new Date(history.lastSoldAt).toLocaleDateString()}
          </span>
        )}
        {thin && (
          <span
            className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent"
            title="Fewer than two distinct pairs of traders behind this — one pair trading with itself is not a market"
          >
            thin
          </span>
        )}
      </div>

      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span className="flex gap-1">
          <dt className="text-ink-faint">median</dt>
          <dd className="num text-ink-dim">{fmtAuec(history.medianPrice ?? 0)}</dd>
        </span>
        <span className="flex gap-1">
          <dt className="text-ink-faint">range</dt>
          <dd className="num text-ink-dim">
            {fmtAuec(history.lowPrice ?? 0)}–{fmtAuec(history.highPrice ?? 0)}
          </dd>
        </span>
        <span className="flex gap-1">
          <dt className="text-ink-faint">sales</dt>
          <dd className="num text-ink-dim">
            {history.sales} from {history.pairs} pair{history.pairs === 1 ? "" : "s"}
          </dd>
        </span>
      </dl>

      {!compact && history.recent.length > 1 && (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-1.5 text-[11px] text-ink-faint">
          {history.recent.slice(0, 5).map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="num text-ink-dim">{fmtAuec(s.price)}</span>
              {s.quantity > 1 && <span>×{s.quantity}</span>}
              <span>{s.origin === "auction" ? "auction" : "fixed"}</span>
              <span className="ml-auto" suppressHydrationWarning>
                {new Date(s.soldAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-[11px] text-ink-faint">
        Settled sales only, per unit. Asking prices nobody paid are not counted.
      </p>
    </div>
  );
}
