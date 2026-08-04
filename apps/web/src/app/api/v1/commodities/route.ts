import { getDb, tickerEntries } from "@kcx/db";
import { apiError, apiJson, apiLimit, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities — every commodity with its current player mark.
 *
 * `mark` is the number KCX publishes; `bestSell`/`bestBuy` are the NPC terminal references
 * it is measured against, included so a consumer can tell the two apart rather than
 * discovering later that they were quoting a terminal price back at us.
 *
 * `hasPlayerPrice` is the field most consumers actually want: false means the mark is still
 * the NPC seed and no player trade has happened yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = apiLimit(url.searchParams.get("limit"), 500, 500);
  const playerOnly = url.searchParams.get("playerPriced") === "1";

  try {
    const entries = await tickerEntries(getDb());
    const rows = entries
      .filter((e) => !playerOnly || e.markPrice != null)
      .slice(0, limit)
      .map((e) => ({
        commodityId: e.commodityId,
        slug: e.slug,
        code: e.code,
        name: e.name,
        isIllegal: e.isIllegal,
        /** The player mark. Null until this commodity has ever had a qualifying fill. */
        mark: e.markPrice,
        /** The headline: the mark where there is one, else the NPC seed. */
        price: e.price,
        priceSource: e.priceSource,
        hasPlayerPrice: e.markPrice != null,
        thin: e.thin,
        lastPrice: e.lastPrice,
        lastTradedAt: e.lastTradedAt,
        window: {
          volumeScu: e.windowVolumeScu,
          prints: e.windowPrintCount,
          /** Distinct counterparty pairs — the honest measure of whether the price means anything. */
          pairs: e.windowPairs,
        },
        changePct: e.changePct,
        // "24h" or "open" — the latter means there isn't a full day of history yet and the
        // change is measured since tracking began. Quoting that as 24h would be wrong in a
        // way no consumer could detect.
        changeBasis: e.changeBasis,
        npc: {
          bestSell: e.bestSell,
          bestSellTerminal: e.bestSellTerminal,
          bestSellSystem: e.bestSellSystem,
          bestBuy: e.bestBuy,
          bestBuyTerminal: e.bestBuyTerminal,
          bestBuySystem: e.bestBuySystem,
        },
      }));
    return apiJson({ count: rows.length, commodities: rows });
  } catch (err) {
    console.error("[api:v1:commodities]", err instanceof Error ? err.message : err);
    return apiError("Unavailable", 503);
  }
}

export const OPTIONS = apiOptions;
