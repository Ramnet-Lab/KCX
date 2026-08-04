"use client";

/**
 * Resolve the realtime endpoint from the browser's own location.
 *
 * A build-time constant can't work here: the same bundle is loaded from localhost, from a LAN
 * address, and (later) from the public domain. Deriving the host at runtime means a phone on
 * the LAN connects back to this machine rather than to itself.
 *
 * NEXT_PUBLIC_WS_URL still wins when set, for deployments where the socket lives elsewhere.
 */
export function resolveWsUrl(configured?: string | null): string {
  if (configured) return configured;
  if (typeof window === "undefined") return "http://localhost:4000";

  const { protocol, hostname, port } = window.location;
  // Behind a reverse proxy in production the socket shares the page's origin (Caddy routes
  // /ws), so only fall back to the dev port when we're clearly on the Next dev server.
  const isDevPort = port === "3000" || port === "3001";
  return isDevPort ? `${protocol}//${hostname}:4000` : window.location.origin;
}
