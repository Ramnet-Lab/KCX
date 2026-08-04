import { commodityTape, getDb } from "@kcx/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/prints?commodityId=13&limit=50 — the public tape for one commodity.
 *
 * Deliberately unauthenticated and deliberately including quarantined prints. The mark is a
 * public number; the trades behind it, and the ones that were refused, have to be public too
 * or there is no way for anyone to check it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const commodityId = Number(url.searchParams.get("commodityId"));
  const limit = Number(url.searchParams.get("limit")) || 50;
  if (!Number.isInteger(commodityId) || commodityId <= 0) {
    return NextResponse.json({ prints: [] }, { status: 400 });
  }

  try {
    return NextResponse.json({ prints: await commodityTape(getDb(), commodityId, limit) });
  } catch (err) {
    console.error("[prints] query failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ prints: [] }, { status: 503 });
  }
}
