"use client";

import type { ListingComponentDto } from "@kcx/db";
import { useState } from "react";
import { BazaarItemPicker, type PickedItem } from "@/components/bazaar-item-picker";

const MAX_COMPONENTS = 40;

/**
 * The fitted loadout, as a list rather than a sentence.
 *
 * "Fully kitted" tells a buyer nothing they can check, compare, or search. Each row here
 * points at a real catalogue entry, which is what makes "which ships are listed with this
 * quantum drive" answerable at all.
 *
 * Nothing verifies it. Star Citizen exposes no inventory API, so this is still the seller's
 * claim — just one that is specific enough to be wrong about, and therefore worth something.
 */
export function LoadoutList({ components }: { components: ListingComponentDto[] }) {
  if (components.length === 0) return null;

  // Grouping by section turns twelve rows into three short lists, which is the difference
  // between a spec sheet someone reads and one they scroll past.
  const groups = new Map<string, ListingComponentDto[]>();
  for (const c of components) {
    const key = c.section ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return (
    <section className="mt-4">
      <h2 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
        Fitted — {components.length} component{components.length === 1 ? "" : "s"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {[...groups.entries()].map(([section, rows]) => (
          <div key={section} className="rounded border border-line bg-panel-2 p-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-dim">{section}</div>
            <ul className="space-y-0.5 text-xs">
              {rows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-ink">{c.name}</span>
                  {c.quantity > 1 && <span className="num text-ink-faint">×{c.quantity}</span>}
                  {c.slotLabel && <span className="text-[10px] text-ink-faint">{c.slotLabel}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        Listed by the seller. Star Citizen exposes no inventory data, so nothing here is verified.
      </p>
    </section>
  );
}

type Draft = { itemId: number; name: string; slotLabel: string; quantity: number };

/** The seller's loadout editor: build the list, save it whole. */
export function LoadoutEditor({
  listingId,
  initial,
  onSaved,
}: {
  listingId: string;
  initial: ListingComponentDto[];
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Draft[]>(
    initial.map((c) => ({
      itemId: c.itemId,
      name: c.name,
      slotLabel: c.slotLabel ?? "",
      quantity: c.quantity,
    })),
  );
  const [picking, setPicking] = useState<PickedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const add = (item: PickedItem) => {
    // A component has to exist in the catalogue: an unmatched name is exactly the free text
    // this feature replaces, and it would answer no search.
    if (item.id == null) {
      setError("Pick a component from the catalogue — a typed name can't be searched on.");
      setPicking(null);
      return;
    }
    if (rows.length >= MAX_COMPONENTS) {
      setError(`Up to ${MAX_COMPONENTS} components.`);
      return;
    }
    setError(null);
    setRows((r) => [...r, { itemId: item.id!, name: item.name, slotLabel: "", quantity: 1 }]);
    setPicking(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bazaar/${listingId}/components`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          components: rows.map((r) => ({
            itemId: r.itemId,
            slotLabel: r.slotLabel.trim() || null,
            quantity: r.quantity,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save the loadout");
        return;
      }
      setSaved(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
        Loadout ({rows.length}/{MAX_COMPONENTS})
      </span>

      {rows.length > 0 && (
        <ul className="mt-1 space-y-1">
          {rows.map((r, i) => (
            <li key={`${r.itemId}-${i}`} className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{r.name}</span>
              <input
                value={r.slotLabel}
                onChange={(e) =>
                  setRows((prev) => prev.map((p, j) => (j === i ? { ...p, slotLabel: e.target.value } : p)))
                }
                placeholder="slot"
                aria-label="Slot"
                maxLength={60}
                className="w-24 rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <input
                type="number"
                min={1}
                value={r.quantity}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) } : p,
                    ),
                  )
                }
                aria-label="Quantity"
                className="num w-14 rounded border border-line bg-bg px-1.5 py-0.5 text-right text-[11px] text-ink focus:outline-none"
              />
              <button
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove component"
                className="tap px-1 text-[11px] text-ink-faint hover:text-danger"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <BazaarItemPicker
          value={picking}
          onChange={(item) => {
            setPicking(item);
            if (item) add(item);
          }}
        />
      </div>

      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          {busy ? "…" : "Save loadout"}
        </button>
        {saved && <span className="text-[11px] text-up">saved</span>}
      </div>
    </div>
  );
}
