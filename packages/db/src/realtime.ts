import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Cross-process change feed.
 *
 * Orders are mutated in the Next.js process, but the socket.io server lives in the worker
 * process. Postgres LISTEN/NOTIFY bridges them with no extra infrastructure and no polling:
 * writers emit on the `kcx_market` channel, the worker listens and fans out over WebSockets.
 */
export const MARKET_CHANNEL = "kcx_market";

export type MarketChange = {
  kind: "order" | "contract";
  /** Commodity touched, so clients can decide whether they care. */
  commodityId?: number;
  orderId?: string;
  tradeId?: string;
  /** Whether this change moved the printed market price (a settlement). */
  priceMoved?: boolean;
  /** User ids to notify personally (order owner, claimer). */
  participants?: string[];
};

/**
 * Announce a market change. Best-effort by design: a failed notification must never roll
 * back the trade that just succeeded — clients still reconcile on their next load.
 */
export async function notifyMarketChange(db: Db, change: MarketChange): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_notify(${MARKET_CHANNEL}, ${JSON.stringify(change)})`);
  } catch (err) {
    console.error("[realtime] notify failed:", err instanceof Error ? err.message : err);
  }
}
