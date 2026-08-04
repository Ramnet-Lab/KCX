"use client";

/**
 * Resolve the realtime endpoint from the browser's own location.
 *
 * Deliberately NOT from NEXT_PUBLIC_WS_URL. Next inlines `process.env.NEXT_PUBLIC_*` at
 * BUILD time, so a value supplied by the container at runtime never reaches the bundle —
 * the compiled-in fallback ships instead, and every production browser tries to open a
 * socket against itself on :4000.
 *
 * Deriving it from `window.location` also means one image works from localhost, a LAN
 * address, and the public domain with no rebuild.
 */
export type WsTarget = { url: string; path: string };

/** socket.io's default; used when the browser reaches the worker directly. */
const DEFAULT_PATH = "/socket.io";
/** Behind Caddy the worker is mounted at /ws, which strips the prefix before proxying. */
const PROXY_PATH = "/ws/socket.io";

export function resolveWsTarget(): WsTarget {
  if (typeof window === "undefined") return { url: "http://localhost:4000", path: DEFAULT_PATH };

  const { protocol, hostname, port, origin } = window.location;

  // The Next dev server runs on 3000/3001 with the worker beside it on 4000, unproxied.
  if (port === "3000" || port === "3001") {
    return { url: `${protocol}//${hostname}:4000`, path: DEFAULT_PATH };
  }

  // Anything else is a reverse proxy: same origin, socket under /ws.
  return { url: origin, path: PROXY_PATH };
}
