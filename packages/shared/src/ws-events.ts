/** Typed socket.io event contracts shared by apps/server and apps/web. */

/** Which side of the market is setting a displayed price. */
export type PriceSource = "npc" | "player";

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
  /** KCX mark — VWAP of recent player fills. Null until players actually trade. */
  markPrice: number | null;
  /**
   * What a trader can actually get / pay, taking the better of the player market and the
   * NPC baseline: highest payout to sell, lowest cost to buy.
   */
  effectiveSell: number | null;
  effectiveBuy: number | null;
  sellSource: PriceSource;
  buySource: PriceSource;
  /** % change of effectiveSell vs ~24h ago; null until enough history exists. */
  change24hPct: number | null;
};

/**
 * A player fill only supersedes the NPC baseline when it is genuinely better for the trader.
 * Selling: take the higher price. Buying: take the lower.
 */
export function resolveEffectivePrices(
  bestSell: number | null,
  bestBuy: number | null,
  markPrice: number | null,
): Pick<TickerEntry, "effectiveSell" | "effectiveBuy" | "sellSource" | "buySource"> {
  const playerWinsSell = markPrice != null && (bestSell == null || markPrice > bestSell);
  const playerWinsBuy = markPrice != null && (bestBuy == null || markPrice < bestBuy);
  return {
    effectiveSell: playerWinsSell ? markPrice : bestSell,
    effectiveBuy: playerWinsBuy ? markPrice : bestBuy,
    sellSource: playerWinsSell ? "player" : "npc",
    buySource: playerWinsBuy ? "player" : "npc",
  };
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

/** Room names — single source of truth. */
export const WS_ROOMS = {
  ticker: "ticker",
  /** Everyone watching the order book. */
  market: "market",
  user: (userId: string) => `user:${userId}`,
} as const;
