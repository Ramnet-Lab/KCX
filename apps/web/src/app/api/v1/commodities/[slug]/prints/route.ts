import { commodities, commodityTape, getDb } from "@kcx/db";
import { eq } from "drizzle-orm";
import { apiError, apiJson, apiLimit, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities/{slug}/prints — the tape for one commodity.
 *
 * Withheld prints are included, with the reason. That is the point: a mark that moved for
 * reasons nobody can inspect is an assertion, and a feed that silently dropped the
 * inconvenient trades would look cleanest exactly when something was being attempted.
 *
 * Handles are present here, as they are on the site — checking a specific price means
 * checking who traded it. The bulk CSV export deliberately omits them; see /developers.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const limit = apiLimit(new URL(request.url).searchParams.get("limit"), 100, 200);

  try {
    const db = getDb();
    const [commodity] = await db
      .select({ id: commodities.id, name: commodities.name })
      .from(commodities)
      .where(eq(commodities.slug, slug));
    if (!commodity) return apiError("Not found", 404);

    const prints = await commodityTape(db, commodity.id, limit);
    return apiJson({
      commodity: { commodityId: commodity.id, slug, name: commodity.name },
      count: prints.length,
      prints: prints.map((p) => ({
        id: p.id,
        side: p.side,
        pricePerScu: p.pricePerScu,
        quantityScu: p.quantityScu,
        buyerHandle: p.buyerHandle,
        sellerHandle: p.sellerHandle,
        /** True = kept for audit but withheld from the mark. Never deleted. */
        excluded: p.excluded,
        exclusionReason: p.exclusionReason,
        executedAt: p.executedAt,
      })),
    });
  } catch (err) {
    console.error("[api:v1:prints]", err instanceof Error ? err.message : err);
    return apiError("Unavailable", 503);
  }
}

export const OPTIONS = apiOptions;
