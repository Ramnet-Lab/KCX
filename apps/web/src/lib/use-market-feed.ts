"use client";

import type { MarketUpdate, TickerUpdate } from "@kcx/shared";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { resolveWsTarget } from "./ws-url";

/**
 * Shared connection to the live market feed.
 *
 * The socket is parked on `window`, not in module scope, and is never torn down when an
 * individual component unmounts. Module-scoped refcounting looked tidier but broke in two
 * real ways: React StrictMode double-invokes effects (drop to zero, disconnect, reconnect),
 * and dev HMR re-evaluates the module, orphaning the count while listeners believe they are
 * still subscribed. One connection per tab, cleaned up when the tab goes away.
 */
type Parked = { url: string; socket: Socket; userId?: string | null };
const KEY = "__kcxMarketFeed";

function getSocket(target: { url: string; path: string }, userId?: string | null): Socket {
  const w = window as unknown as Record<string, Parked | undefined>;
  const existing = w[KEY];
  if (existing && existing.url === target.url) {
    if (userId && existing.userId !== userId) {
      existing.socket.emit("identify", userId);
      existing.userId = userId;
    }
    return existing.socket;
  }
  existing?.socket.disconnect();
  const socket = io(target.url, { path: target.path, transports: ["websocket", "polling"] });
  const identify = () => {
    if (userId) socket.emit("identify", userId);
  };
  identify();
  socket.on("connect", identify);
  w[KEY] = { url: target.url, socket, userId };
  return socket;
}

/**
 * Calls `onChange` when the order book moves. Bursts are coalesced so a flurry of activity
 * triggers one refresh, not twenty; a reconnect also triggers one, since events that fired
 * while the socket was down were missed.
 */
export function useMarketFeed(
  configuredWsUrl: string,
  onChange: (update: MarketUpdate | null) => void,
  userId?: string | null,
) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const target = resolveWsTarget();
    const socket = getSocket(target, userId);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: MarketUpdate | null = null;
    let sawFirstConnect = socket.connected;

    const fire = (payload: MarketUpdate | null) => {
      pending = payload;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        handler.current(pending);
        pending = null;
      }, 250);
    };

    const onUpdate = (payload: MarketUpdate) => fire(payload);
    const onConnect = () => {
      setConnected(true);
      // Re-sync after a gap; the first connect is already covered by the server render.
      if (sawFirstConnect) fire(null);
      sawFirstConnect = true;
    };
    const onDisconnect = () => setConnected(false);

    socket.on("market:update", onUpdate);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    setConnected(socket.connected);

    return () => {
      if (timer) clearTimeout(timer);
      socket.off("market:update", onUpdate);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [configuredWsUrl, userId]);

  return { connected };
}

/**
 * Price-ticker subscription, on the SAME parked socket as `useMarketFeed`.
 *
 * The market dashboard used to call `io()` directly, so any tab showing both the dashboard
 * and anything order-board-shaped held two connections to the same server and got two
 * copies of every broadcast.
 */
export function useTickerFeed(configuredWsUrl: string, onTicker: (payload: TickerUpdate) => void) {
  const handler = useRef(onTicker);
  handler.current = onTicker;

  useEffect(() => {
    const socket = getSocket(resolveWsTarget());
    const onUpdate = (payload: TickerUpdate) => handler.current(payload);
    socket.on("ticker:update", onUpdate);
    return () => {
      socket.off("ticker:update", onUpdate);
    };
  }, [configuredWsUrl]);
}
