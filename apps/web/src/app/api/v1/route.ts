import { API_VERSION, apiJson, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1 — discovery.
 *
 * A machine-readable index of what's here and, more importantly, what the numbers MEAN.
 * A price feed without its methodology is an assertion; anyone building on this should be
 * able to find out what does and doesn't move it without reading our source.
 */
export async function GET() {
  return apiJson({
    version: API_VERSION,
    documentation: "/developers",
    methodology: {
      commodityMark:
        "Highest applicable rung: volume-weighted average of qualifying player fills over 72h (min 10 SCU), else the last qualifying fill, else the best NPC terminal price as a seed. Only dual-confirmed settlements print.",
      integrity:
        "Prints are withheld from the mark — but never deleted — when a party is unverified, the price is outside 0.25x-3.0x the same-side reference, a pair has printed more than 3 times for a commodity in 7 days, or one account exceeds 70% of 72h volume.",
      thin: "A mark backed by fewer than 2 distinct counterparty pairs is flagged thin. The flag never suppresses the price.",
      bazaarPrices:
        "Settled sales only, per unit. Asking prices are never counted — an unsold listing says only that its price was too high.",
      npcPrices: "Reference only, from the UEX API. They seed a commodity's mark and never move it again once it has traded.",
    },
    endpoints: [
      { path: "/api/v1/commodities", description: "Every commodity with its current player mark and 24h change." },
      { path: "/api/v1/commodities/{slug}", description: "One commodity, with its NPC reference prices." },
      { path: "/api/v1/commodities/{slug}/prints", description: "Settled player trades for one commodity, including withheld ones and why." },
      { path: "/api/v1/items", description: "Bazaar item catalogue. ?q= to search." },
      { path: "/api/v1/items/{id}/prices", description: "Settled bazaar sale history for one item." },
      { path: "/api/v1/prints.csv", description: "Bulk download of settled commodity trades. No handles — see /developers." },
    ],
    limits: {
      rateLimit: "None enforced. Page sizes are capped instead; please be reasonable and cache.",
      maxPageSize: { commodities: 500, prints: 1000, items: 100, csv: 50000 },
    },
  });
}

export const OPTIONS = apiOptions;
