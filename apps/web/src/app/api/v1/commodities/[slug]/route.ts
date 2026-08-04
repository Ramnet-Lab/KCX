import { getDb, tickerEntries } from "@kcx/db";
import { apiError, apiJson, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/commodities/{slug} — one commodity's current price and reference points. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const entries = await tickerEntries(getDb());
    const e = entries.find((x) => x.slug === slug);
    if (!e) return apiError("Not found", 404);
    return apiJson({
      commodity: {
        commodityId: e.commodityId,
        slug: e.slug,
        code: e.code,
        name: e.name,
        isIllegal: e.isIllegal,
        mark: e.markPrice,
        price: e.price,
        priceSource: e.priceSource,
        hasPlayerPrice: e.markPrice != null,
        thin: e.thin,
        lastPrice: e.lastPrice,
        lastTradedAt: e.lastTradedAt,
        window: {
          volumeScu: e.windowVolumeScu,
          prints: e.windowPrintCount,
          pairs: e.windowPairs,
        },
        changePct: e.changePct,
        changeBasis: e.changeBasis,
        npc: {
          bestSell: e.bestSell,
          bestSellTerminal: e.bestSellTerminal,
          bestSellSystem: e.bestSellSystem,
          bestBuy: e.bestBuy,
          bestBuyTerminal: e.bestBuyTerminal,
          bestBuySystem: e.bestBuySystem,
          // The two NPC prices are a universe-wide max and min, so they are usually in
          // different places. Flagged, because quoted together they read as a spread a
          // trader could capture rather than two prices each costing a trip.
          differentSystems: e.npcSplit,
        },
      },
    });
  } catch (err) {
    console.error("[api:v1:commodity]", err instanceof Error ? err.message : err);
    return apiError("Unavailable", 503);
  }
}

export const OPTIONS = apiOptions;
