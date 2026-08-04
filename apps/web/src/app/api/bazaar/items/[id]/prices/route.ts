import { getDb, itemPriceHistory } from "@kcx/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bazaar/items/:id/prices — what this item has actually sold for.
 *
 * Settled sales only. An asking price nobody paid is not evidence: a listing sitting unsold
 * at ten million says only that ten million was too much, and publishing it as "the price"
 * would let anyone set a market by posting a listing they never intend to honour.
 *
 * An empty history is a real answer, not an error — the caller is expected to say so
 * plainly rather than show a blank where a number goes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const history = await itemPriceHistory(getDb(), itemId);
    if (!history) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[bazaar:item-prices]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
