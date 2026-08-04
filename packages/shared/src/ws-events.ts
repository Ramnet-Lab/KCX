/** Typed socket.io event contracts shared by apps/server and apps/web. */

import type { OrderSide } from "./orders";

/** Which side of the market is setting a displayed price. */
export type PriceSource = "npc" | "player";

/**
 * What the change percentage is actually measured against. A young dataset has nothing 24h
 * old to compare with, and quietly relabelling "since we started collecting" as "24h" makes
 * the number — which the market wall SORTS by — wrong in a way nobody can see.
 */
export type ChangeBasis = "24h" | "open";

export type TickerEntry = {
  commodityId: number;
  slug: string;
  code: string;
  name: string;
  isIllegal: boolean;
  /** Best NPC sell-to payout right now (aUEC/SCU), null if nowhere sells. */
  bestSell: number | null;
  /** Cheapest NPC buy-from price right now. */
  bestBuy: number | null;
  /**
   * KCX mark — the player price. Null until this commodity has ever had a qualifying fill;
   * once it has, the NPC baseline never takes the headline back.
   */
  markPrice: number | null;
  /** Most recent qualifying print, kept indefinitely so a quiet week doesn't reset the mark. */
  lastPrice: number | null;
  lastTradedAt: string | null;
  /** The headline number on the tile: the mark if there is one, else the NPC baseline. */
  price: number | null;
  priceSource: PriceSource;
  /** Qualifying player activity in the mark window. */
  windowVolumeScu: number;
  windowPrintCount: number;
  /** Distinct counterparty pairs — the honest measure of whether a price means anything. */
  windowPairs: number;
  /** Player-priced, but on too few distinct relationships to be worth much. */
  thin: boolean;
  /** % change of `price` vs the basis below; null until any history exists. */
  changePct: number | null;
  changeBasis: ChangeBasis;
};

/**
 * The reference price to pre-fill an order form with.
 *
 * Once a commodity has a player mark, that IS the market and both sides quote off it. Before
 * then there is no single price — only the two NPC edges — so the side matters.
 */
export function referencePrice(entry: TickerEntry, side: OrderSide): number | null {
  if (entry.markPrice != null) return entry.markPrice;
  return side === "buy" ? entry.bestBuy : entry.bestSell;
}

import type { IndexLatest } from "./sectors";

export type TickerUpdate = {
  /** ISO timestamp of the capture that produced this payload. */
  at: string;
  entries: TickerEntry[];
  /** Latest index value per sector (base-1000), for live chart appends. */
  indexLatest: IndexLatest[];
};

/** A change to the order book, pushed the moment it happens. */
export type MarketUpdate = {
  kind: "order" | "contract";
  commodityId?: number;
  orderId?: string;
  tradeId?: string;
  priceMoved?: boolean;
  at: string;
};

export type ServerToClientEvents = {
  "ticker:update": (payload: TickerUpdate) => void;
  /** Order book changed — clients refresh the affected views. */
  "market:update": (payload: MarketUpdate) => void;
};

export type ClientToServerEvents = {
  /** Subscribe to personal notifications (contracts you're party to). */
  identify: (userId: string) => void;
};

/**
 * socket.io endpoint path. Identical on both ends and in every environment so that no
 * reverse proxy needs a rewrite rule — forwarding it verbatim is always correct.
 */
export const WS_PATH = "/ws/socket.io";

/** Room names — single source of truth. */
export const WS_ROOMS = {
  ticker: "ticker",
  /** Everyone watching the order book. */
  market: "market",
  user: (userId: string) => `user:${userId}`,
} as const;
