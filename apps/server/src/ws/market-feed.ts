import { MARKET_CHANNEL, type MarketChange } from "@kcx/db";
import { WS_ROOMS } from "@kcx/shared";
import pg from "pg";
import type { Ws } from "./server";

/**
 * Listens for order-book changes emitted by the web process (Postgres NOTIFY) and pushes
 * them to connected clients immediately.
 *
 * Uses its own dedicated connection — a LISTEN session must not be handed back to a pool,
 * or the subscription silently dies when the connection is reused.
 */
export async function startMarketFeed(
  connectionString: string,
  ws: Ws,
  onPriceMoved: () => Promise<void>,
): Promise<() => Promise<void>> {
  let client: pg.Client | null = null;
  let closed = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = async () => {
    if (closed) return;
    client = new pg.Client({ connectionString });
    client.on("error", (err: Error) => {
      console.error("[market-feed] connection error:", err.message);
      scheduleReconnect();
    });
    client.on("notification", (msg: pg.Notification) => {
      if (msg.channel !== MARKET_CHANNEL || !msg.payload) return;
      let change: MarketChange;
      try {
        change = JSON.parse(msg.payload) as MarketChange;
      } catch {
        return;
      }
      const payload = {
        kind: change.kind,
        commodityId: change.commodityId,
        orderId: change.orderId,
        tradeId: change.tradeId,
        priceMoved: change.priceMoved,
        at: new Date().toISOString(),
      };
      ws.io.to(WS_ROOMS.market).emit("market:update", payload);
      // Personal rooms so a trader hears about their own contracts even if they aren't
      // looking at the board.
      for (const userId of change.participants ?? []) {
        ws.io.to(WS_ROOMS.user(userId)).emit("market:update", payload);
      }
      // A settlement changes the printed mark — refresh the price ticker too.
      if (change.priceMoved) {
        void onPriceMoved().catch((err) => console.error("[market-feed] ticker refresh failed:", err));
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${MARKET_CHANNEL}`);
      console.log(`[market-feed] listening on ${MARKET_CHANNEL}`);
    } catch (err) {
      console.error("[market-feed] connect failed:", err instanceof Error ? err.message : err);
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void client?.end().catch(() => {});
      client = null;
      void connect();
    }, 3000);
  };

  await connect();

  return async () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    await client?.end().catch(() => {});
  };
}
