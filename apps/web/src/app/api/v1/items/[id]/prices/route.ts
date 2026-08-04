import { getDb, itemPriceHistory } from "@kcx/db";
import { apiError, apiJson, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/items/{id}/prices — what a bazaar item has actually sold for.
 *
 * This is the number nobody else has. Marketplace "trends" elsewhere are built from asking
 * prices, which means they can be moved by posting a listing you never intend to honour.
 * These are dual-confirmed sales only, per unit.
 *
 * An empty history is a 200 with `sales: 0`, not a 404 — "nobody has traded one of these"
 * is a real and useful answer, and consumers should be able to say so rather than showing a
 * blank where a number goes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) return apiError("Not found", 404);

  try {
    const history = await itemPriceHistory(getDb(), itemId);
    if (!history) return apiError("Not found", 404);
    return apiJson({
      item: { itemId: history.itemId, name: history.itemName },
      sales: history.sales,
      /** Distinct trading pairs. Under 2 and the price rests on one relationship. */
      pairs: history.pairs,
      /**
       * Only meaningful once something has sold. An item with no history is not a thin
       * market — it is no market, which `sales: 0` already says. Reporting thin here would
       * have consumers badging "thin price" over a blank.
       */
      thin: history.sales > 0 && history.pairs < 2,
      lastPrice: history.lastPrice,
      lastSoldAt: history.lastSoldAt,
      medianPrice: history.medianPrice,
      lowPrice: history.lowPrice,
      highPrice: history.highPrice,
      recent: history.recent,
    });
  } catch (err) {
    console.error("[api:v1:item-prices]", err instanceof Error ? err.message : err);
    return apiError("Unavailable", 503);
  }
}

export const OPTIONS = apiOptions;
