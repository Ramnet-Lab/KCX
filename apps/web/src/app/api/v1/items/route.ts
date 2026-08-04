import { getDb, searchBazaarItems } from "@kcx/db";
import { apiError, apiJson, apiLimit, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/items?q= — the bazaar item catalogue.
 *
 * Seeded from UEX and grown by sellers naming things it didn't have. Matching runs on a
 * normalised key, so "p4 ar" finds "P4-AR Rifle" — a consumer doesn't need to reproduce our
 * punctuation to get a hit.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = apiLimit(url.searchParams.get("limit"), 25, 100);

  if (q.trim().length < 2) {
    return apiError("Pass ?q= with at least two characters", 400);
  }

  try {
    const items = await searchBazaarItems(getDb(), q, { limit });
    return apiJson({
      query: q,
      count: items.length,
      items: items.map((i) => ({
        itemId: i.id,
        name: i.name,
        section: i.section,
        category: i.category,
        manufacturer: i.companyName,
        /** "uex_item" / "uex_vehicle" from the upstream catalogue, "player" if a seller named it. */
        source: i.source,
        listingCount: i.listingCount,
        prices: `/api/v1/items/${i.id}/prices`,
      })),
    });
  } catch (err) {
    console.error("[api:v1:items]", err instanceof Error ? err.message : err);
    return apiError("Unavailable", 503);
  }
}

export const OPTIONS = apiOptions;
