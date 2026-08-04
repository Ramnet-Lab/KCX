import { z } from "zod";

/** Shared order contracts — validated identically on the client form and the API route. */

export const ORDER_SIDES = ["buy", "sell"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

/** Default fill-by window; the trader picks from FILL_BY_CHOICES at post time. */
export const ORDER_TTL_DAYS = 7;
export const ORDER_NOTES_MAX = 500;

/** Fill-by deadline options, in hours. Lapse ⇒ expired_unfilled, zero market impact. */
export const FILL_BY_CHOICES = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
] as const;
export const FILL_BY_DEFAULT_HOURS = 168;
export const FILL_BY_MAX_HOURS = 720;

/**
 * Price is deliberately unbounded above: a player may ask any premium they like.
 * The UI shows the delta vs the NPC baseline as context — it never constrains input.
 */
export const orderCreateInput = z.object({
  commodityId: z.number().int().positive(),
  side: z.enum(ORDER_SIDES),
  pricePerScu: z.number().int().positive().max(1_000_000_000),
  quantityScu: z.number().int().positive().max(1_000_000),
  minFillScu: z.number().int().positive().max(1_000_000).optional(),
  /** Fill-by window in hours; lapse ⇒ expired_unfilled with no market impact. */
  fillByHours: z.number().int().positive().max(FILL_BY_MAX_HOURS).optional(),
  locationId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(ORDER_NOTES_MAX).nullable().optional(),
});
export type OrderCreateInput = z.infer<typeof orderCreateInput>;

export const orderActionInput = z.object({
  action: z.enum(["pause", "resume", "cancel", "bump", "refresh", "fill"]),
  /** For `fill`: SCU actually traded; defaults to the full remaining quantity. */
  quantityScu: z.number().int().positive().max(1_000_000).optional(),
});
export type OrderAction = z.infer<typeof orderActionInput>["action"];

export const portfolioSaveInput = z.object({
  auec: z.number().int().min(0).max(1_000_000_000_000),
  holdings: z
    .array(
      z.object({
        commodityId: z.number().int().positive(),
        scu: z.number().int().positive().max(10_000_000),
        avgCost: z.number().int().positive().max(1_000_000_000).nullable().optional(),
      }),
    )
    .max(500),
});
export type PortfolioSaveInput = z.infer<typeof portfolioSaveInput>;

/** Order as returned to clients (money as numbers; timestamps as ISO strings). */
export type OrderDto = {
  id: string;
  side: OrderSide;
  commodityId: number;
  commodityName: string;
  commoditySlug: string;
  commodityCode: string;
  pricePerScu: number;
  quantityScu: number;
  remainingScu: number;
  /** SCU locked in open escrow contracts; board availability is remaining − reserved. */
  reservedScu: number;
  minFillScu: number;
  locationId: number | null;
  locationName: string | null;
  notes: string | null;
  status: string;
  ownerHandle: string;
  ownerDisplayName: string;
  ownerVerified: boolean;
  isMine: boolean;
  createdAt: string;
  bumpedAt: string;
  expiresAt: string;
};

/**
 * Premium/discount of a player price vs the NPC reference for that side.
 * Buy orders are compared to what terminals charge; sell orders to what terminals pay.
 * Returns null when there's no reference price — never an error, never a block.
 */
export function priceVsBaselinePct(
  side: OrderSide,
  pricePerScu: number,
  baseline: { bestBuy: number | null; bestSell: number | null },
): number | null {
  const ref = side === "buy" ? baseline.bestBuy : baseline.bestSell;
  if (ref == null || ref <= 0) return null;
  return ((pricePerScu - ref) / ref) * 100;
}
