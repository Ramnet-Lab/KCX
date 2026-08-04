import { z } from "zod";
import { ITEM_NAME_MAX } from "./item-key";

/**
 * Shared bazaar contracts — the same shapes the compose form validates against and the API
 * enforces, so a listing can never be rejected for a rule the form didn't know about.
 *
 * The category and type lists live here rather than in the schema package because the
 * board and the compose form need them in the browser, and importing them from `@kcx/db`
 * would drag the database client into the client bundle.
 */

export const BAZAAR_CATEGORIES = [
  "ships",
  "components",
  "weapons",
  "armor",
  "consumables",
  "crafted",
  "resources",
  "paints",
  "other",
] as const;
export type BazaarCategory = (typeof BAZAAR_CATEGORIES)[number];

export const BAZAAR_CATEGORY_LABELS: Record<BazaarCategory, string> = {
  ships: "Ships",
  components: "Components",
  weapons: "Weapons",
  armor: "Armor & suits",
  consumables: "Consumables",
  crafted: "Crafted goods",
  resources: "Raw resources",
  paints: "Paints & liveries",
  other: "Other",
};

export const BAZAAR_LISTING_TYPES = ["buy_now", "auction", "auction_buy_now"] as const;
export type BazaarListingType = (typeof BAZAAR_LISTING_TYPES)[number];

/** Which way a listing points: offering goods, or offering money for goods. */
export const BAZAAR_INTENTS = ["sell", "buy"] as const;
export type BazaarIntent = (typeof BAZAAR_INTENTS)[number];

export const BAZAAR_TITLE_MAX = 120;
export const BAZAAR_DESCRIPTION_MAX = 4000;
/** Ships and fleet packages clear well past a billion, so the ceiling is generous. */
export const BAZAAR_MAX_PRICE = 100_000_000_000;
export const BAZAAR_MAX_QUANTITY = 10_000;

/** How long a listing stays on the board, and how long an auction runs. */
export const BAZAAR_DURATIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
  { hours: 720, label: "30 days" },
] as const;
export const BAZAAR_DEFAULT_HOURS = 168;
export const BAZAAR_MAX_HOURS = 720;

const base = {
  title: z.string().trim().min(4).max(BAZAAR_TITLE_MAX),
  /**
   * What the listing is, in catalogue terms — either an entry the seller picked, or a name
   * they typed because it wasn't in the list yet. Optional so a genuine bundle can still be
   * listed, but a listing without one gets no price history and shows up nowhere an item
   * is being looked up.
   */
  itemId: z.number().int().positive().optional(),
  itemName: z.string().trim().max(ITEM_NAME_MAX).optional(),
  description: z.string().trim().max(BAZAAR_DESCRIPTION_MAX).optional(),
  category: z.enum(BAZAAR_CATEGORIES).default("other"),
  locationId: z.number().int().positive().nullable().optional(),
  runForHours: z.number().int().positive().max(BAZAAR_MAX_HOURS).default(BAZAAR_DEFAULT_HOURS),
};

/**
 * A listing needs a price, a clock, or both — the same rule the `bazaar_pricing_present`
 * and `bazaar_auction_has_clock` constraints hold at the table, restated here so the seller
 * gets a sentence instead of a constraint violation.
 */
export const bazaarCreateInput = z
  .object({
    ...base,
    intent: z.enum(BAZAAR_INTENTS).default("sell"),
    listingType: z.enum(BAZAAR_LISTING_TYPES).default("buy_now"),
    buyNowPrice: z.number().int().positive().max(BAZAAR_MAX_PRICE).optional(),
    startPrice: z.number().int().positive().max(BAZAAR_MAX_PRICE).optional(),
    /** Buy-now only: an auction is always a single lot. */
    quantity: z.number().int().positive().max(BAZAAR_MAX_QUANTITY).default(1),
  })
  .refine((v) => v.listingType === "auction" || v.buyNowPrice != null, {
    message: "Name the price you'll sell it at",
    path: ["buyNowPrice"],
  })
  .refine((v) => v.listingType === "buy_now" || v.startPrice != null, {
    message: "An auction needs a starting price",
    path: ["startPrice"],
  })
  .refine((v) => v.listingType === "buy_now" || v.quantity === 1, {
    // Bidding on "one of twenty" has no meaning when each unit would clear differently.
    message: "Auctions are a single lot — list multiples at a fixed price instead",
    path: ["quantity"],
  })
  .refine(
    (v) => v.listingType !== "auction_buy_now" || (v.buyNowPrice ?? 0) > (v.startPrice ?? 0),
    {
      message: "The buy-it-now price has to be above the starting bid",
      path: ["buyNowPrice"],
    },
  )
  .refine((v) => v.intent === "sell" || v.listingType === "buy_now", {
    // Letting sellers bid a wanted ad DOWN is a reverse auction — a different mechanism with
    // a different fairness argument, and not something to acquire by combining two flags.
    message: "A wanted ad is a fixed offer, not an auction",
    path: ["listingType"],
  })
  .refine((v) => v.intent === "sell" || v.itemId != null || (v.itemName?.length ?? 0) > 0, {
    // "I want to buy something" is not an offer anyone can fill.
    message: "Name the item you want to buy",
    path: ["itemName"],
  });
export type BazaarCreateInput = z.infer<typeof bazaarCreateInput>;

/**
 * Editing a live listing. Deliberately narrower than creation: the pricing MODE and the
 * auction clock are fixed once posted, because everyone who has already bid did so against
 * those terms.
 */
export const bazaarEditInput = z.object({
  title: z.string().trim().min(4).max(BAZAAR_TITLE_MAX).optional(),
  description: z.string().trim().max(BAZAAR_DESCRIPTION_MAX).nullable().optional(),
  category: z.enum(BAZAAR_CATEGORIES).optional(),
  locationId: z.number().int().positive().nullable().optional(),
  buyNowPrice: z.number().int().positive().max(BAZAAR_MAX_PRICE).optional(),
  quantity: z.number().int().positive().max(BAZAAR_MAX_QUANTITY).optional(),
});
export type BazaarEditInput = z.infer<typeof bazaarEditInput>;

export const bazaarActionInput = z.object({
  action: z.enum(["pause", "resume", "cancel", "bump", "relist", "edit"]),
  /** `relist` only: how long the new run lasts. */
  runForHours: z.number().int().positive().max(BAZAAR_MAX_HOURS).optional(),
  /** `edit` only. */
  edit: bazaarEditInput.optional(),
});
export type BazaarAction = z.infer<typeof bazaarActionInput>["action"];

export const bazaarBidInput = z.object({
  amount: z.number().int().positive().max(BAZAAR_MAX_PRICE),
});

export const bazaarBuyInput = z.object({
  quantity: z.number().int().positive().max(BAZAAR_MAX_QUANTITY).default(1),
});

export const bazaarSaleActionInput = z.object({
  action: z.enum(["confirm", "cancel"]),
});
