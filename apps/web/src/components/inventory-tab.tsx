"use client";

import type { InventoryRow } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BazaarItemPicker, type PickedItem } from "@/components/bazaar-item-picker";

/**
 * Inventory: what you're holding, and how much of it is still free to sell.
 *
 * The number that earns this tab its place is `available` — held minus whatever is already
 * promised on an active listing. Without it, a seller with one ship and three listings has no
 * way to notice until a buyer does, and "sorry, I already sold that" is the fastest way to
 * lose a reputation on a platform where reputation is the only collateral anyone has.
 *
 * Held counts are self-declared like every other position on KCX — nothing can read a hangar.
 * What the exchange CAN do is stop you promising the same unit twice.
 */
export function InventoryTab({ initial }: { initial: InventoryRow[] }) {
  const [rows, setRows] = useState<InventoryRow[]>(initial);
  const [item, setItem] = useState<PickedItem | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setRows(initial), [initial]);

  const send = async (body: Record<string, unknown>, method: "POST" | "DELETE" = "POST") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error ?? "Could not save");
        return false;
      }
      if (out.inventory) setRows(out.inventory);
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Clear the lot. Lines still promised on a live listing are kept back and reported. */
  const wipe = async () => {
    if (!confirm(`Remove all ${rows.length} inventory line(s)?

This only clears your own stock list — it does not touch any listing.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/inventory", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error ?? "Could not clear");
        return;
      }
      if (out.inventory) setRows(out.inventory);
      if (out.message) setNotice(out.message);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!item) return setError("Pick or name the item first.");
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0) return setError("How many are you holding?");
    const ok = await send({
      ...(item.id != null ? { itemId: item.id } : { itemName: item.name }),
      quantity: Math.round(n),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (ok) {
      setItem(null);
      setQty("1");
      setNote("");
    }
  };

  return (
    <div>
      <div className="mb-3 rounded border border-line bg-panel p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-dim">Add or update stock</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
          {/*
            The same picker the sell form uses: search the catalogue first, fall through to
            creating an entry only when nothing matches. One catalogue means one price history
            — two paths each inventing their own entry would split every item's market in half.
          */}
          <BazaarItemPicker value={item} onChange={setItem} />
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">Held</span>
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink focus:outline-none"
            />
          </label>
          <button
            onClick={() => void add()}
            disabled={busy || !item}
            className="tap h-9 rounded border border-accent/60 px-3 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note — where it is, condition, which ship it's fitted to"
          maxLength={300}
          className="mt-2 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <p className="mt-2 text-[11px] text-ink-faint">
          Setting a count replaces it — this is a stock take, not an adjustment. Nothing here is
          visible to anyone else.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}
      {notice && (
        <div className="mb-3 rounded border border-line bg-panel-2 px-3 py-2 text-xs text-ink-dim">{notice}</div>
      )}

      {rows.length > 0 && (
        <div className="mb-2 flex justify-end">
          {/*
            Asks first: a stock take can be a lot of typing, and there is no undo for it.
          */}
          <button
            onClick={() => void wipe()}
            disabled={busy}
            className="tap rounded px-2 py-1 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
          >
            Wipe inventory
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">Nothing on the shelf yet.</p>
          <p>Add what you&apos;re holding and you can list it in one click from here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full bg-panel text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Held</th>
                <th className="px-3 py-2 text-right">Listed</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId} className="border-b border-line/50 hover:bg-panel-2">
                  <td className="px-3 py-2">
                    <div className="text-ink">{r.name}</div>
                    {(r.section || r.note) && (
                      <div className="text-[11px] text-ink-faint">
                        {r.section}
                        {r.section && r.note ? " · " : ""}
                        {r.note}
                      </div>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right text-ink-dim">{r.held}</td>
                  <td className="num px-3 py-2 text-right text-ink-faint">
                    {r.committed > 0 ? (
                      <span title={`On ${r.listingCount} active listing${r.listingCount === 1 ? "" : "s"}`}>
                        {r.committed}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {/*
                    The whole reason the tab exists. Green while there is something left to
                    sell, red at zero — zero is the state that produces the double-sale, so it
                    should look like a warning rather than a neutral number.
                  */}
                  <td className={`num px-3 py-2 text-right font-bold ${r.available > 0 ? "text-up" : "text-danger"}`}>
                    {r.available} available
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex flex-wrap justify-end gap-1">
                      <button
                        onClick={() =>
                          router.push(
                            `/bazaar?list=${r.itemId}&qty=${r.available}&name=${encodeURIComponent(r.name)}`,
                          )
                        }
                        disabled={r.available <= 0}
                        title={
                          r.available > 0
                            ? "Open the sell form with this item already filled in"
                            : "Every one you hold is already on a listing"
                        }
                        className="tap rounded bg-up/20 px-2 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:cursor-default disabled:bg-panel-2 disabled:text-ink-faint"
                      >
                        List
                      </button>
                      <button
                        onClick={() => void send({ itemId: r.itemId }, "DELETE")}
                        disabled={busy}
                        className="tap rounded px-2 py-1 text-xs text-ink-faint hover:text-danger disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
