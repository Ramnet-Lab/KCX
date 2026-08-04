import { getDb, searchBazaarItems } from "@kcx/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bazaar/items?q=… — typeahead over the item catalogue.
 *
 * Public and unauthenticated: it is a list of things that exist in the game, seeded from
 * UEX, and gating it would only stop people finding what they came to sell.
 *
 * Matching runs on the normalised key server-side, so "p4 ar" finds "Behring P4-AR". There
 * is no create here — an item is only ever created as a side effect of actually listing
 * something, so an abandoned form can't leave an entry behind.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ items: [] });

  try {
    const items = await searchBazaarItems(getDb(), q, { limit: 20 });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[bazaar:items]", err instanceof Error ? err.message : err);
    return NextResponse.json({ items: [], error: "Unavailable" }, { status: 503 });
  }
}
