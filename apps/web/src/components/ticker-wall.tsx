"use client";

import type { TickerEntry } from "@kcx/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  loadCollections,
  loadView,
  newCollectionId,
  saveCollections,
  saveView,
  type Collection,
  type WallView,
} from "@/lib/collections";

type Props = {
  entries: TickerEntry[];
  lastUpdate: string | null;
  flash: boolean;
  onPlaceOrder: (seed: { commodityId?: number; side?: "buy" | "sell" }) => void;
};

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));

function changeBadge(entry: TickerEntry) {
  const chg = entry.changePct;
  const color = chg == null ? "text-ink-faint" : chg > 0 ? "text-up" : chg < 0 ? "text-down" : "text-ink-dim";
  const text = chg == null ? "· · ·" : `${chg > 0 ? "▲" : chg < 0 ? "▼" : "•"} ${Math.abs(chg).toFixed(1)}%`;
  // A young dataset has nothing 24h old to compare against. Saying "24h" anyway would be a
  // quiet lie, and this number drives the wall's default sort.
  const title = chg == null ? "Not enough history yet" : entry.changeBasis === "24h" ? "Change over 24h" : "Change since we started tracking this commodity";
  return (
    <span className={`num text-xs ${color}`} title={title}>
      {text}
      {chg != null && entry.changeBasis === "open" && <span className="ml-0.5 text-ink-faint">*</span>}
    </span>
  );
}

/**
 * The two NPC prices with the systems they're in.
 *
 * The system rather than the terminal because it fits, and because "Pyro / Stanton" makes the
 * point instantly: these are not two sides of a spread you can capture, they are two prices
 * in two places. `bestSell` is a universe-wide max and `bestBuy` a universe-wide min, so
 * they're rarely even on the same planet. The full terminal names are in the tooltip.
 */
function npcLine(entry: TickerEntry, compact: boolean) {
  const where = (terminal: string | null, system: string | null) =>
    terminal ? `${terminal}${system ? ` · ${system}` : ""}` : "unknown terminal";
  const title =
    `Best NPC payout ${fmt(entry.bestSell)} at ${where(entry.bestSellTerminal, entry.bestSellSystem)}\n` +
    `Cheapest NPC purchase ${fmt(entry.bestBuy)} at ${where(entry.bestBuyTerminal, entry.bestBuySystem)}` +
    (entry.npcSplit ? "\n\nDifferent systems — reaching either price costs a trip." : "");
  const sys = (s: string | null) => (s && !compact ? <span className="text-ink-faint/70"> {s}</span> : null);

  return (
    <span className="num text-xs text-ink-faint" title={title}>
      npc {fmt(entry.bestSell)}
      {sys(entry.bestSellSystem)} / {fmt(entry.bestBuy)}
      {sys(entry.bestBuySystem)}
      {entry.npcSplit && (
        <span className="ml-1 text-ink-faint/70" title="These two prices are in different systems">
          ⇄
        </span>
      )}
    </span>
  );
}

/** Small badge explaining where a tile's headline price came from. */
function sourceBadge(entry: TickerEntry) {
  // No terminal quotes this at all — mostly raw ore, which terminals don't buy until it's
  // refined. Saying so is the point: it marks the commodities where a player is the only
  // counterparty there will ever be, rather than leaving them looking like missing data.
  if (!entry.npcMarket && entry.markPrice == null) {
    return (
      <span
        className="text-[9px] font-bold text-accent"
        title="No NPC terminal buys or sells this — usually raw ore, which must be refined first. Players are the only market, so the first settled trade sets the price."
      >
        NO NPC MKT
      </span>
    );
  }
  if (entry.priceSource !== "player") return null;
  return (
    <>
      <span className="text-[9px] font-bold text-accent" title="Set by settled player trades, not by terminals">
        PLR
      </span>
      {entry.thin && (
        <span
          className="text-[9px] font-bold text-danger"
          title={`Only ${entry.windowPairs} distinct counterparty pair${entry.windowPairs === 1 ? "" : "s"} behind this price`}
        >
          THIN
        </span>
      )}
    </>
  );
}

/** Market wall (presentational — live state comes from MarketDashboard): search, tile/list views, collections. */
export function TickerWall({ entries, lastUpdate, flash, onPlaceOrder }: Props) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<WallView>("tiles");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [assignMenuFor, setAssignMenuFor] = useState<number | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [playerOnly, setPlayerOnly] = useState(false);
  const [newName, setNewName] = useState("");
  // State (not ref) — a ref-based gate lets the save-effects' first run clobber stored
  // data with defaults under StrictMode's double-invoked effects.
  const [hydrated, setHydrated] = useState(false);

  // localStorage is browser-only: load after mount, save on change (post-hydration).
  useEffect(() => {
    setCollections(loadCollections());
    setView(loadView());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveCollections(collections);
  }, [collections, hydrated]);
  useEffect(() => {
    if (hydrated) saveView(view);
  }, [view, hydrated]);

  const activeCollection = collections.find((c) => c.id === activeCollectionId) ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Three tiers, in order: player-priced (a real market), NPC-priced, then the ones with no
    // price at all. Ranking a purely NPC tile above a traded one on a bigger poll-to-poll
    // wobble buries the thing a trader came here for; letting unpriced tiles float up on a
    // null change would bury both.
    const tier = (e: TickerEntry) => (e.priceSource === "player" ? 0 : e.price != null ? 1 : 2);
    let list = [...entries].sort((a, b) => {
      if (tier(a) !== tier(b)) return tier(a) - tier(b);
      const am = Math.abs(a.changePct ?? 0);
      const bm = Math.abs(b.changePct ?? 0);
      if (bm !== am) return bm - am;
      return (b.price ?? 0) - (a.price ?? 0);
    });
    if (playerOnly) list = list.filter((e) => !e.npcMarket);
    if (activeCollection) {
      const ids = new Set(activeCollection.commodityIds);
      list = list.filter((e) => ids.has(e.commodityId));
    }
    if (q) {
      list = list.filter((e) => e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
    }
    return list;
  }, [entries, query, activeCollection, playerOnly]);

  const playerOnlyCount = useMemo(() => entries.filter((e) => !e.npcMarket).length, [entries]);

  const membership = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of collections) for (const id of c.commodityIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [collections]);

  const toggleMembership = (collectionId: string, commodityId: number) => {
    setCollections((prev) =>
      prev.map((c) =>
        c.id !== collectionId
          ? c
          : c.commodityIds.includes(commodityId)
            ? { ...c, commodityIds: c.commodityIds.filter((id) => id !== commodityId) }
            : { ...c, commodityIds: [...c.commodityIds, commodityId] },
      ),
    );
  };

  const createCollection = (name: string, initialCommodityId?: number) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const collection: Collection = {
      id: newCollectionId(),
      name: trimmed,
      commodityIds: initialCommodityId != null ? [initialCommodityId] : [],
    };
    setCollections((prev) => [...prev, collection]);
    setNewName("");
    setCreatingCollection(false);
  };

  const deleteCollection = (id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
    if (activeCollectionId === id) setActiveCollectionId(null);
  };

  const AssignButton = ({ commodityId }: { commodityId: number }) => {
    const count = membership.get(commodityId) ?? 0;
    return (
      <button
        aria-label="Assign to collection"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAssignMenuFor(assignMenuFor === commodityId ? null : commodityId);
        }}
        className={`tap rounded px-2 py-1 text-base leading-none active:scale-95 ${count > 0 ? "text-accent" : "text-ink-faint hover:text-ink-dim"}`}
        title={count > 0 ? `In ${count} collection${count > 1 ? "s" : ""}` : "Add to collection"}
      >
        {count > 0 ? "★" : "☆"}
      </button>
    );
  };

  /** Compact BUY/SELL pair — the tile and row entry points into the order modal. */
  const TradeButtons = ({ commodityId, compact = false }: { commodityId: number; compact?: boolean }) => (
    <span className={`flex ${compact ? "gap-0.5" : "gap-1"}`}>
      {(["buy", "sell"] as const).map((side) => (
        <button
          key={side}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlaceOrder({ commodityId, side });
          }}
          title={side === "buy" ? "Post a WTB order" : "Post a WTS order"}
          className={`tap rounded px-2 py-1 text-[11px] font-bold active:scale-95 ${
            side === "buy" ? "bg-up/15 text-up hover:bg-up/25" : "bg-down/15 text-down hover:bg-down/25"
          }`}
        >
          {side === "buy" ? "BUY" : "SELL"}
        </button>
      ))}
    </span>
  );

  const AssignMenu = ({ commodityId }: { commodityId: number }) => (
    <div
      className="absolute right-2 top-8 z-20 w-56 rounded border border-line bg-panel-2 p-2 shadow-xl"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Collections</div>
      {collections.length === 0 && (
        <div className="mb-1 text-xs text-ink-faint">No collections yet — create one below.</div>
      )}
      {collections.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-panel">
          <input
            type="checkbox"
            checked={c.commodityIds.includes(commodityId)}
            onChange={() => toggleMembership(c.id, commodityId)}
            className="accent-[#e8b449]"
          />
          <span className="truncate">{c.name}</span>
          <span className="ml-auto text-ink-faint">{c.commodityIds.length}</span>
        </label>
      ))}
      <form
        className="mt-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          createCollection(newName, commodityId);
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New collection…"
          className="w-full rounded border border-line bg-bg px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button type="submit" className="rounded border border-line px-2 text-xs text-ink-dim hover:text-ink">
          +
        </button>
      </form>
    </div>
  );

  return (
    <div>
      {/* Search + view toggle */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker or name…  (e.g. GOLD, quantainium)"
          aria-label="Search commodities"
          className="w-full max-w-md rounded border border-line bg-panel px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
        />
        <div className="ml-auto flex rounded border border-line">
          {(["tiles", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs ${view === v ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"}`}
              aria-pressed={view === v}
            >
              {v === "tiles" ? "⊞ Tiles" : "≡ List"}
            </button>
          ))}
        </div>
      </div>

      {/* Collection chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <button
          onClick={() => setActiveCollectionId(null)}
          className={`tap rounded-full border px-3 py-1.5 ${
            activeCollectionId === null ? "border-accent text-accent" : "border-line text-ink-dim hover:text-ink"
          }`}
        >
          All ({entries.length})
        </button>
        {/*
          A way to actually find the no-terminal commodities. They sort last, which keeps the
          wall readable but also means a miner holding raw ore would have to scroll past every
          priced commodity to reach the ones they can actually sell here.
        */}
        {playerOnlyCount > 0 && (
          <button
            onClick={() => {
              setPlayerOnly((v) => !v);
              setActiveCollectionId(null);
            }}
            title="Commodities no NPC terminal trades — raw ore, gathered goods, contraband. Players are the only market."
            className={`tap rounded-full border px-3 py-1.5 ${
              playerOnly ? "border-accent text-accent" : "border-line text-ink-dim hover:text-ink"
            }`}
          >
            No NPC market ({playerOnlyCount})
          </button>
        )}
        {collections.map((c) => (
          <span key={c.id} className="inline-flex items-center">
            <button
              onClick={() => setActiveCollectionId(activeCollectionId === c.id ? null : c.id)}
              className={`tap rounded-full border px-3 py-1.5 ${
                activeCollectionId === c.id ? "border-accent text-accent" : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {c.name} ({c.commodityIds.length})
            </button>
            {activeCollectionId === c.id && (
              <button
                onClick={() => deleteCollection(c.id)}
                title={`Delete collection "${c.name}"`}
                className="ml-0.5 px-1 text-ink-faint hover:text-danger"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {creatingCollection ? (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              createCollection(newName);
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setCreatingCollection(false)}
              placeholder="Collection name"
              className="w-36 rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs text-ink focus:outline-none"
            />
            <button type="submit" className="text-ink-dim hover:text-ink">
              ✓
            </button>
          </form>
        ) : (
          <button
            onClick={() => {
              setCreatingCollection(true);
              setNewName("");
            }}
            className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-ink-faint hover:text-ink"
          >
            + New collection
          </button>
        )}
        <span className="ml-auto text-ink-faint">
          collections live in this browser until accounts arrive
        </span>
      </div>

      {/* Status line */}
      <div className="mb-3 flex items-baseline justify-between text-xs text-ink-faint">
        <span>
          {visible.length} of {entries.length} commodities
          {activeCollection ? ` · ${activeCollection.name}` : ""} · player-priced first, then by movement
          {visible.some((e) => e.changeBasis === "open" && e.changePct != null) && (
            <span className="ml-1 text-ink-faint">· * = since tracking began, not 24h</span>
          )}
        </span>
        <span className={flash ? "text-accent" : ""}>
          {lastUpdate ? `live · updated ${new Date(lastUpdate).toLocaleTimeString()}` : "live feed connected on next poll"}
        </span>
      </div>

      {visible.length === 0 && (
        <div className="rounded border border-line bg-panel p-8 text-center text-sm text-ink-faint">
          {activeCollection && activeCollection.commodityIds.length === 0
            ? "Nothing in this collection yet — click ☆ on any commodity to add it."
            : "No commodities match."}
        </div>
      )}

      {view === "tiles" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((e) => (
            <Link
              key={e.commodityId}
              href={`/commodities/${e.slug}`}
              className={`relative rounded border border-line bg-panel p-3 transition-colors hover:border-ink-faint ${
                flash ? "border-accent/40" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-xs font-bold tracking-wider text-ink-dim">{e.code}</span>
                <span className="flex items-center gap-1">
                  {changeBadge(e)}
                  <AssignButton commodityId={e.commodityId} />
                </span>
              </div>
              <div className="mt-1 truncate text-sm text-ink">
                {e.name}
                {e.isIllegal && <span className="ml-1 align-middle text-[9px] font-bold text-danger">◆</span>}
              </div>
              <div
                className={`num mt-1 flex items-baseline gap-1 text-base ${
                  e.priceSource === "player" ? "text-accent" : "text-up"
                }`}
              >
                {fmt(e.price)}
                {sourceBadge(e)}
              </div>
              <div className="flex items-center justify-between">
                {/* NPC edges stay visible as context — they're the chart's reference line. */}
                {npcLine(e, true)}
                <TradeButtons commodityId={e.commodityId} compact />
              </div>
              {assignMenuFor === e.commodityId && <AssignMenu commodityId={e.commodityId} />}
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full bg-panel text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Commodity</th>
                <th className="px-3 py-2 text-right">Mark</th>
                <th className="px-3 py-2 text-right">NPC sell / buy</th>
                <th className="px-3 py-2 text-right">Change</th>
                <th className="px-3 py-2 text-center">Trade</th>
                <th className="px-3 py-2 text-right">★</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.commodityId} className="relative border-b border-line/50 hover:bg-panel-2">
                  <td className="px-3 py-1.5 text-xs font-bold tracking-wider text-ink-dim">{e.code}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/commodities/${e.slug}`} className="text-ink hover:text-accent">
                      {e.name}
                    </Link>
                    {e.isIllegal && <span className="ml-1 text-[9px] font-bold text-danger">◆</span>}
                  </td>
                  <td
                    className={`num px-3 py-1.5 text-right ${e.priceSource === "player" ? "text-accent" : "text-up"}`}
                  >
                    <span className="inline-flex items-baseline gap-1">
                      {fmt(e.price)}
                      {sourceBadge(e)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink-dim">
                    <span className="num">
                      {fmt(e.bestSell)} / {fmt(e.bestBuy)}
                    </span>
                    <div className="text-[10px] text-ink-faint">
                      {e.bestSellSystem ?? "—"}
                      {e.npcSplit ? " ⇄ " : " / "}
                      {e.bestBuySystem ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right">{changeBadge(e)}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex justify-center">
                      <TradeButtons commodityId={e.commodityId} />
                    </span>
                  </td>
                  <td className="relative px-3 py-1.5 text-right">
                    <AssignButton commodityId={e.commodityId} />
                    {assignMenuFor === e.commodityId && <AssignMenu commodityId={e.commodityId} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* click-away closer for the assign menu */}
      {assignMenuFor !== null && (
        <div className="fixed inset-0 z-10" onClick={() => setAssignMenuFor(null)} aria-hidden />
      )}
    </div>
  );
}
