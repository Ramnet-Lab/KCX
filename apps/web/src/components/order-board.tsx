"use client";

import type { OrderDto } from "@kcx/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OrderActions } from "@/components/order-actions";
import { useMarketFeed } from "@/lib/use-market-feed";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expiring";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

type SortKey = "recent" | "price-asc" | "price-desc" | "value-desc" | "expiring" | "quantity-desc";
type SideFilter = "all" | "buy" | "sell";
type View = "book" | "list";

const PAGE_SIZE = 50;

/**
 * The order board at scale. A flat two-column dump stops working past a few dozen orders,
 * so this defaults to a per-commodity BOOK summary (best bid/ask/spread/depth) and drills
 * into a filterable order list.
 */
export function OrderBoard({
  orders: initialOrders,
  signedIn,
  wsUrl,
  userId,
}: {
  orders: OrderDto[];
  signedIn: boolean;
  wsUrl: string;
  userId: string | null;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [flash, setFlash] = useState(false);
  const [view, setView] = useState<View>("book");
  const [query, setQuery] = useState("");
  const [side, setSide] = useState<SideFilter>("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [mineOnly, setMineOnly] = useState(false);
  const [commodityFilter, setCommodityFilter] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  // Server-rendered orders are only a starting point; the feed keeps them current.
  useEffect(() => setOrders(initialOrders), [initialOrders]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setOrders(body.orders ?? []);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    } catch {
      /* transient — the next event will retry */
    }
  }, []);
  const { connected } = useMarketFeed(wsUrl, refresh, userId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lo = minPrice ? Number(minPrice) : null;
    const hi = maxPrice ? Number(maxPrice) : null;
    const rows = orders.filter((o) => {
      if (side !== "all" && o.side !== side) return false;
      if (mineOnly && !o.isMine) return false;
      if (commodityFilter != null && o.commodityId !== commodityFilter) return false;
      if (lo != null && o.pricePerScu < lo) return false;
      if (hi != null && o.pricePerScu > hi) return false;
      if (q && !o.commodityName.toLowerCase().includes(q) && !o.commodityCode.toLowerCase().includes(q)) {
        // Also let traders search by counterparty handle.
        if (!o.ownerDisplayName.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const available = (o: OrderDto) => o.remainingScu - o.reservedScu;
    switch (sort) {
      case "price-asc":
        return rows.sort((a, b) => a.pricePerScu - b.pricePerScu);
      case "price-desc":
        return rows.sort((a, b) => b.pricePerScu - a.pricePerScu);
      case "value-desc":
        return rows.sort((a, b) => b.pricePerScu * available(b) - a.pricePerScu * available(a));
      case "quantity-desc":
        return rows.sort((a, b) => available(b) - available(a));
      case "expiring":
        return rows.sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
      default:
        return rows.sort((a, b) => new Date(b.bumpedAt).getTime() - new Date(a.bumpedAt).getTime());
    }
  }, [orders, query, side, minPrice, maxPrice, sort, mineOnly, commodityFilter]);

  /** Per-commodity book: best bid, best ask, spread and depth — the exchange summary view. */
  const book = useMemo(() => {
    const map = new Map<
      number,
      {
        commodityId: number;
        name: string;
        code: string;
        slug: string;
        bestBid: number | null;
        bestAsk: number | null;
        bidScu: number;
        askScu: number;
        orders: number;
      }
    >();
    for (const o of filtered) {
      const avail = o.remainingScu - o.reservedScu;
      const row =
        map.get(o.commodityId) ??
        {
          commodityId: o.commodityId,
          name: o.commodityName,
          code: o.commodityCode,
          slug: o.commoditySlug,
          bestBid: null,
          bestAsk: null,
          bidScu: 0,
          askScu: 0,
          orders: 0,
        };
      row.orders++;
      if (o.side === "buy") {
        row.bidScu += avail;
        row.bestBid = row.bestBid == null ? o.pricePerScu : Math.max(row.bestBid, o.pricePerScu);
      } else {
        row.askScu += avail;
        row.bestAsk = row.bestAsk == null ? o.pricePerScu : Math.min(row.bestAsk, o.pricePerScu);
      }
      map.set(o.commodityId, row);
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));
  }, [filtered]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const activeFilters = query || side !== "all" || minPrice || maxPrice || mineOnly || commodityFilter != null;
  const reset = () => {
    setQuery("");
    setSide("all");
    setMinPrice("");
    setMaxPrice("");
    setMineOnly(false);
    setCommodityFilter(null);
    setPage(0);
  };

  const focusCommodity = (id: number) => {
    setCommodityFilter(id);
    setView("list");
    setPage(0);
  };

  return (
    <div>
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search commodity, ticker, or trader…"
          aria-label="Search orders"
          className="w-full max-w-xs rounded border border-line bg-panel px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
        />
        <div className="flex rounded border border-line">
          {(["all", "buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSide(s);
                setPage(0);
              }}
              className={`tap px-3 py-2 ${
                side === s
                  ? s === "buy"
                    ? "bg-up/15 text-up"
                    : s === "sell"
                      ? "bg-down/15 text-down"
                      : "bg-panel-2 text-ink"
                  : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {s === "all" ? "All" : s === "buy" ? "WTB" : "WTS"}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1">
          <input
            type="number" inputMode="numeric"
            value={minPrice}
            onChange={(e) => {
              setMinPrice(e.target.value);
              setPage(0);
            }}
            placeholder="min"
            aria-label="Minimum price per SCU"
            className="num w-20 rounded border border-line bg-panel px-2 py-1 text-right text-ink placeholder:text-left placeholder:text-ink-faint focus:outline-none"
          />
          <span className="text-ink-faint">–</span>
          <input
            type="number" inputMode="numeric"
            value={maxPrice}
            onChange={(e) => {
              setMaxPrice(e.target.value);
              setPage(0);
            }}
            placeholder="max"
            aria-label="Maximum price per SCU"
            className="num w-20 rounded border border-line bg-panel px-2 py-1 text-right text-ink placeholder:text-left placeholder:text-ink-faint focus:outline-none"
          />
          <span className="text-ink-faint">/SCU</span>
        </span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort orders"
          className="rounded border border-line bg-panel px-2 py-1 text-ink focus:outline-none"
        >
          <option value="recent">Newest</option>
          <option value="price-desc">Price: high → low</option>
          <option value="price-asc">Price: low → high</option>
          <option value="value-desc">Order value</option>
          <option value="quantity-desc">Quantity</option>
          <option value="expiring">Expiring soonest</option>
        </select>
        {signedIn && (
          <label className="flex items-center gap-1 text-ink-dim">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="accent-[#e8b449]" />
            Mine only
          </label>
        )}
        <div className="ml-auto flex rounded border border-line">
          {(["book", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`tap px-3 py-2 ${view === v ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"}`}
            >
              {v === "book" ? "☰ By commodity" : "≡ All orders"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 flex items-baseline gap-2 text-xs text-ink-faint">
        <span className={flash ? "text-accent" : ""}>
          {filtered.length} of {orders.length} orders
          {commodityFilter != null && filtered[0] && ` · ${filtered[0].commodityName}`}
        </span>
        {activeFilters && (
          <button onClick={reset} className="text-accent hover:underline">
            clear filters
          </button>
        )}
        <span className="ml-auto flex items-center gap-1" title={connected ? "Live — updates as orders change" : "Reconnecting…"}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-up" : "bg-ink-faint"}`} />
          {connected ? "live" : "offline"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded border border-dashed border-line p-8 text-center text-sm text-ink-faint">
          No orders match these filters.
        </div>
      ) : view === "book" ? (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full min-w-[42rem] bg-panel text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-3 py-2">Commodity</th>
                <th className="px-3 py-2 text-right">Best bid</th>
                <th className="px-3 py-2 text-right">Best ask</th>
                <th className="px-3 py-2 text-right">Spread</th>
                <th className="px-3 py-2 text-right">Depth (buy / sell)</th>
                <th className="px-3 py-2 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {book.map((b) => {
                const spread = b.bestBid != null && b.bestAsk != null ? b.bestAsk - b.bestBid : null;
                return (
                  <tr
                    key={b.commodityId}
                    onClick={() => focusCommodity(b.commodityId)}
                    className="cursor-pointer border-b border-line/50 hover:bg-panel-2"
                  >
                    <td className="px-3 py-1.5">
                      <span className="mr-2 text-xs text-ink-faint">{b.code}</span>
                      <span className="text-ink">{b.name}</span>
                    </td>
                    <td className="num px-3 py-1.5 text-right text-up">{b.bestBid != null ? fmt(b.bestBid) : "—"}</td>
                    <td className="num px-3 py-1.5 text-right text-down">{b.bestAsk != null ? fmt(b.bestAsk) : "—"}</td>
                    <td className={`num px-3 py-1.5 text-right ${spread != null && spread < 0 ? "text-accent" : "text-ink-dim"}`}>
                      {spread != null ? fmt(spread) : "—"}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-ink-dim">
                      {fmt(b.bidScu)} / {fmt(b.askScu)} SCU
                    </td>
                    <td className="num px-3 py-1.5 text-right text-ink-faint">{b.orders}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-faint">
            Click a row to see its orders. A negative spread means a buyer is bidding above the
            cheapest ask — an immediate trade for whoever claims first.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full min-w-[52rem] bg-panel text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Commodity</th>
                  <th className="px-3 py-2 text-right">Price / SCU</th>
                  <th className="px-3 py-2 text-right">Available</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Fill by</th>
                  <th className="px-3 py-2">Trader</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((o) => {
                  const avail = o.remainingScu - o.reservedScu;
                  return (
                    <tr key={o.id} className={`border-b border-line/50 ${o.isMine ? "bg-accent/5" : ""}`}>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            o.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                          }`}
                        >
                          {o.side === "buy" ? "WTB" : "WTS"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <Link href={`/commodities/${o.commoditySlug}`} className="text-ink hover:text-accent">
                          <span className="mr-2 text-xs text-ink-faint">{o.commodityCode}</span>
                          {o.commodityName}
                        </Link>
                        {o.notes && <div className="text-[11px] text-ink-faint">{o.notes}</div>}
                      </td>
                      <td className={`num px-3 py-1.5 text-right ${o.side === "buy" ? "text-up" : "text-down"}`}>
                        {fmt(o.pricePerScu)}
                      </td>
                      <td className="num px-3 py-1.5 text-right text-ink-dim">
                        {fmt(avail)} SCU
                        {o.reservedScu > 0 && <span className="text-accent"> ({fmt(o.reservedScu)} locked)</span>}
                        {o.minFillScu > 1 && <span className="text-ink-faint"> · min {fmt(o.minFillScu)}</span>}
                      </td>
                      <td className="num px-3 py-1.5 text-right text-ink">{fmt(o.pricePerScu * avail)}</td>
                      <td className="num px-3 py-1.5 text-right text-ink-faint">{timeLeft(o.expiresAt)}</td>
                      <td className="px-3 py-1.5 text-ink-dim">
                        {o.ownerDisplayName}
                        {o.ownerVerified && (
                          <span className="ml-1 text-accent" title="Verified RSI handle">
                            ✓
                          </span>
                        )}
                        <div className="mt-0.5">
                          <OrderActions order={o} signedIn={signedIn} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="mt-2 flex items-center justify-center gap-3 text-xs">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded border border-line px-2 py-1 text-ink-dim hover:text-ink disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-ink-faint">
                Page {page + 1} of {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="rounded border border-line px-2 py-1 text-ink-dim hover:text-ink disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
