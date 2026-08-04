import { NextResponse } from "next/server";

/**
 * Shared machinery for the public read API under /api/v1.
 *
 * The point of shipping this is strategic as much as technical. KCX consumes UEX's feed for
 * NPC terminal prices, which makes that feed a single point of failure held by someone else.
 * The one thing we produce that nobody else does is a price derived from settled
 * player-to-player trades — so publishing it, in a stable documented shape other tools can
 * build on, turns us from a consumer into a source.
 *
 * Rules for anything served here:
 *
 *  • **Versioned and stable.** /api/v1 shapes are a promise. Add fields, never repurpose or
 *    remove them; breaking changes go to /api/v2.
 *  • **CORS open.** This is public data and most consumers are browser tools. Refusing
 *    cross-origin reads would mean every one of them needs a proxy.
 *  • **Cached briefly.** Marks move on a settlement or a half-hourly poll, so a minute of
 *    staleness costs nothing and absorbs a hot loop.
 *  • **Bounded.** Every collection takes an explicit cap. There is no per-caller rate limit
 *    (this runs as one container behind Caddy, so an in-process limiter would be per-instance
 *    and reset on deploy) — the honest mitigation is small page sizes, not a counter that
 *    pretends to be a quota.
 */

export const API_VERSION = "v1";

/** Attribution and terms, echoed on every response so they travel with the data. */
export const API_NOTICE = {
  source: "KCX — Kestrel Commodities Exchange",
  about: "Player-settled prices for Star Citizen. Unofficial fan project, not affiliated with Cloud Imperium.",
  terms: "Free to use with attribution. Prices come from dual-confirmed player trades; see /api for how they are computed.",
  npcPriceCredit: "NPC terminal prices via the UEX API (uexcorp.space), used as reference only.",
} as const;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export type ApiCache = "short" | "medium" | "none";

const CACHE: Record<ApiCache, string> = {
  // Marks move on settlement; a minute of staleness is invisible and absorbs hot loops.
  short: "public, max-age=60, stale-while-revalidate=120",
  // History that only grows at the tail.
  medium: "public, max-age=300, stale-while-revalidate=600",
  none: "no-store",
};

export function apiJson(body: unknown, opts: { cache?: ApiCache; status?: number } = {}): NextResponse {
  return NextResponse.json(
    { ...(body as object), notice: API_NOTICE },
    {
      status: opts.status ?? 200,
      headers: { ...CORS, "cache-control": CACHE[opts.cache ?? "short"] },
    },
  );
}

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message, notice: API_NOTICE }, { status, headers: { ...CORS, "cache-control": "no-store" } });
}

/** Preflight, for browser tools that send one. */
export function apiOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Clamp a caller-supplied limit into something we're willing to serve. */
export function apiLimit(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Serve a CSV download.
 *
 * Bulk exports deliberately carry NO handles. The per-commodity tape shows them because
 * that is how a specific price gets checked against a specific pair, and the same names are
 * already on the site — but a whole-history file is about prices, not people, and shipping
 * one that makes mass profiling of traders trivial is a different thing than being auditable.
 */
export function apiCsv(filename: string, header: string[], rows: (string | number | null)[][]): NextResponse {
  const escape = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  return new NextResponse(body, {
    headers: {
      ...CORS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": CACHE.medium,
    },
  });
}
