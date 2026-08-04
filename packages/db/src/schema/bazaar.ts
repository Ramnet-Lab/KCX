import { BAZAAR_CATEGORIES, BAZAAR_LISTING_TYPES } from "@kcx/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gameVersions, locations } from "./market";
import { users } from "./orders";

/**
 * The bazaar — player wares that aren't commodities.
 *
 * A ship, a set of components, twenty crafted medpens, a paint. Things the commodity board
 * can't express: they have no SCU price, no NPC reference, and no place in an order book.
 * The shape here is a classifieds listing, not an exchange quote — a picture, a price, and
 * whoever wants it first.
 *
 * Three deliberate separations from the rest of KCX:
 *
 *  • **Nothing here touches the mark.** The tape and the sector indices are built from
 *    commodity fills only. A ship changing hands at 40 million says nothing about the price
 *    of Titanium, and a market number that moves on unrelated goods would be worse than no
 *    number — so a bazaar sale writes no print. See docs/market-model.md.
 *  • **Auctions are open and ascending**, the mirror image of a contract's sealed reverse
 *    auction. There, a visible book means bidders undercut each other by one aUEC and the
 *    honest first bid loses; here, the seller is the one being bid *up*, so visibility is
 *    the mechanism rather than the leak.
 *  • **Sellers post no collateral.** Cargo can be declared per commodity and checked; a
 *    "Polaris with C-tier components" cannot. Buyers still back their money — see
 *    queries/collateral.ts — because that side is a number the exchange already tracks.
 *
 * Settlement is the same bilateral handshake as everything else: the two of them meet
 * in-game, and BOTH confirm before anything is recorded as done.
 */

/**
 * Categories and pricing modes live in `@kcx/shared` because the compose form needs them in
 * the browser, and re-declaring them here is how the two copies would drift.
 *
 *   buy_now         — fixed price, first buyer takes it
 *   auction         — open ascending; highest bid when the clock runs out wins
 *   auction_buy_now — an auction carrying a standing price that ends it early
 */
export { BAZAAR_CATEGORIES, BAZAAR_LISTING_TYPES } from "@kcx/shared";

export const BAZAAR_LISTING_STATUSES = [
  "active",
  /** Hidden from the board by the seller; bids and clocks are frozen with it. */
  "paused",
  /** Every unit spoken for. Returns to `active` if a sale falls through. */
  "sold_out",
  "cancelled",
  /** Ran out its clock — a buy-now that nobody took, or an auction nobody bid on. */
  "expired",
] as const;

/** Statuses in which the listing is still on the board and its clock still runs. */
export const BAZAAR_LIVE_STATUSES = ["active", "paused"] as const;

export const bazaarListings = pgTable(
  "bazaar_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    /** Patch-scoped like orders and contracts: a wipe ends every listing with it. */
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),

    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: BAZAAR_CATEGORIES }).notNull().default("other"),
    listingType: text("listing_type", { enum: BAZAAR_LISTING_TYPES }).notNull().default("buy_now"),

    /** Price per unit for an immediate purchase. Null on a pure auction. */
    buyNowPrice: bigint("buy_now_price", { mode: "number" }),

    /**
     * Auction fields. `startPrice` is the floor a first bid must reach — there is no hidden
     * reserve, because a reserve that nobody can see turns every bid below it into wasted
     * effort and the seller pays for that in bidders.
     */
    startPrice: bigint("start_price", { mode: "number" }),
    currentBid: bigint("current_bid", { mode: "number" }),
    currentBidderId: uuid("current_bidder_id").references(() => users.id),
    bidCount: integer("bid_count").notNull().default(0),
    auctionEndsAt: timestamp("auction_ends_at", { withTimezone: true }),

    /**
     * Units on offer, and how many are still unspoken for. An auction is always a single
     * lot: bidding on "one of twenty" has no meaning when each unit would clear at a
     * different price.
     */
    quantity: integer("quantity").notNull().default(1),
    remainingQuantity: integer("remaining_quantity").notNull().default(1),

    /** Where the handover happens, when the seller wants to pin it down. */
    locationId: integer("location_id").references(() => locations.id),

    status: text("status", { enum: BAZAAR_LISTING_STATUSES }).notNull().default("active"),
    /** Board sort key; bumping is rate-limited in the API, as on the order board. */
    bumpedAt: timestamp("bumped_at", { withTimezone: true }).notNull().defaultNow(),
    /** When an unsold buy-now listing drops off the board. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bazaar_board").on(t.status, t.bumpedAt),
    index("bazaar_seller").on(t.sellerId, t.status),
    index("bazaar_category").on(t.category, t.status),
    /** The sweep looks up auctions whose clock has run out. */
    index("bazaar_auction_end").on(t.auctionEndsAt),
    index("bazaar_expiry").on(t.expiresAt),
    check("bazaar_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "bazaar_remaining_in_range",
      sql`${t.remainingQuantity} >= 0 AND ${t.remainingQuantity} <= ${t.quantity}`,
    ),
    check("bazaar_buy_now_positive", sql`${t.buyNowPrice} IS NULL OR ${t.buyNowPrice} > 0`),
    check("bazaar_start_price_positive", sql`${t.startPrice} IS NULL OR ${t.startPrice} > 0`),
    /** A listing has to be buyable somehow: a price, a clock, or both. */
    check(
      "bazaar_pricing_present",
      sql`(${t.listingType} = 'auction') = (${t.buyNowPrice} IS NULL)`,
    ),
    check(
      "bazaar_auction_has_clock",
      sql`(${t.listingType} IN ('auction','auction_buy_now')) = (${t.auctionEndsAt} IS NOT NULL)`,
    ),
    /** An auction is one lot — see `quantity` above. */
    check(
      "bazaar_auction_single_lot",
      sql`${t.listingType} = 'buy_now' OR ${t.quantity} = 1`,
    ),
  ],
);

/**
 * Photos of the item. The first by `sortIndex` is the thumbnail the board draws.
 *
 * A separate table rather than a column because a ship sale is not one picture — it is the
 * exterior, the cockpit, and the components list — and a buyer who can only see one of
 * those is being asked to trust the description instead of the pictures.
 *
 * Filenames are generated UUIDs (see lib/uploads.ts); nothing user-supplied ever reaches a
 * filesystem path.
 */
export const bazaarListingImages = pgTable(
  "bazaar_listing_images",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => bazaarListings.id),
    filename: text("filename").notNull(),
    sortIndex: smallint("sort_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bazaar_images_listing").on(t.listingId, t.sortIndex),
    /** The upload route serves by filename, so it has to resolve to exactly one listing. */
    uniqueIndex("bazaar_images_filename").on(t.filename),
  ],
);

export const BAZAAR_BID_STATUSES = [
  /** The standing high bid. Exactly one per listing, and its money is committed. */
  "active",
  /** Beaten by a later bid; the money is released the moment that happens. */
  "outbid",
  "won",
  /** The auction ended with someone else on top, or was cancelled under them. */
  "lost",
] as const;

/**
 * Bids on an open ascending auction.
 *
 * One row per bidder, revised upward in place: the history that matters ("who is winning,
 * at what") is on the listing, and keeping every superseded number would make the bid count
 * a measure of how often one person clicked rather than how many people want the item.
 *
 * Bids are binding — there is no retraction. The high bid is collateralised against the
 * bidder's declared balance for as long as it stands, which is what makes it binding in the
 * only sense KCX can enforce.
 */
export const bazaarBids = pgTable(
  "bazaar_bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => bazaarListings.id),
    bidderId: uuid("bidder_id")
      .notNull()
      .references(() => users.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: text("status", { enum: BAZAAR_BID_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bazaar_bids_one_per_bidder").on(t.listingId, t.bidderId),
    /** Winner selection and the "who is next" read: highest first, earliest on a tie. */
    index("bazaar_bids_ranking").on(t.listingId, t.amount, t.createdAt),
    index("bazaar_bids_bidder").on(t.bidderId, t.status),
    check("bazaar_bids_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const BAZAAR_SALE_STATUSES = [
  /** Agreed. The two of them now have to meet in-game and both confirm. */
  "pending",
  /** Both confirmed; aUEC moved between the declared balances. */
  "completed",
  /** Either side backed out; the units go back on the listing. */
  "cancelled",
  /** Nobody confirmed inside the window. Same restocking, but it counts against them. */
  "expired",
] as const;

export const BAZAAR_SALE_ORIGINS = ["buy_now", "auction"] as const;

/**
 * An agreed sale, awaiting the in-game handover.
 *
 * The exchange records what was agreed and what happened; it never holds the item or the
 * money. So a sale resolves exactly two ways — both parties confirm, or it falls through
 * and the units return to the board. One party confirming alone changes nothing, because
 * only the other one can say whether they actually got what they paid for.
 */
export const bazaarSales = pgTable(
  "bazaar_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => bazaarListings.id),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id),
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),
    origin: text("origin", { enum: BAZAAR_SALE_ORIGINS }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    /**
     * Stored rather than multiplied on read. It is what the two of them agreed, and a
     * listing edited afterwards must not be able to change the price of a sale already
     * struck against it.
     */
    totalPrice: bigint("total_price", { mode: "number" }).notNull(),
    status: text("status", { enum: BAZAAR_SALE_STATUSES }).notNull().default("pending"),
    sellerConfirmedAt: timestamp("seller_confirmed_at", { withTimezone: true }),
    buyerConfirmedAt: timestamp("buyer_confirmed_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),
    /** How long the pair have to meet up before the units go back on the board. */
    settleBy: timestamp("settle_by", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("bazaar_sales_listing").on(t.listingId),
    index("bazaar_sales_seller").on(t.sellerId, t.status),
    index("bazaar_sales_buyer").on(t.buyerId, t.status),
    /** The sweep looks up sales whose settlement window has run out. */
    index("bazaar_sales_settle_by").on(t.settleBy).where(sql`${t.status} = 'pending'`),
    check("bazaar_sales_quantity_positive", sql`${t.quantity} > 0`),
    check("bazaar_sales_price_positive", sql`${t.unitPrice} > 0 AND ${t.totalPrice} > 0`),
    check("bazaar_sales_distinct_parties", sql`${t.sellerId} <> ${t.buyerId}`),
  ],
);

export const BAZAAR_EVENT_TYPES = [
  "listed",
  "edited",
  "paused",
  "resumed",
  "bumped",
  "cancelled",
  "expired",
  "image_added",
  "image_removed",
  // --- auction ---
  "bid_placed",
  "bid_raised",
  "outbid",
  /** A late bid pushed the closing time out; see BID_SOFT_CLOSE_MINUTES. */
  "auction_extended",
  "auction_won",
  "auction_no_bids",
  // --- sale ---
  "bought",
  "confirmed_by_seller",
  "confirmed_by_buyer",
  "sale_completed",
  "sale_cancelled",
  "sale_expired",
  "removed_by_mod",
] as const;

/** Append-only audit spine — listing and sale state is reconstructible from these. */
export const bazaarEvents = pgTable(
  "bazaar_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => bazaarListings.id),
    /** Set on sale-related events so a listing's history reads per sale as well. */
    saleId: uuid("sale_id").references(() => bazaarSales.id),
    /** null = system (the expiry sweep, an auction closing). */
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type", { enum: BAZAAR_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bazaar_events_listing").on(t.listingId, t.createdAt)],
);

/**
 * Star ratings on a completed sale, in their own table for the same reason contract ratings
 * are: being a reliable ship seller is not the same claim as being a reliable hauler, and a
 * single blended score would let a good record in one buy trust in the other.
 */
export const bazaarRatings = pgTable(
  "bazaar_ratings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => bazaarSales.id),
    raterId: uuid("rater_id")
      .notNull()
      .references(() => users.id),
    ratedId: uuid("rated_id")
      .notNull()
      .references(() => users.id),
    stars: smallint("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bazaar_ratings_once").on(t.saleId, t.raterId),
    index("bazaar_ratings_rated").on(t.ratedId),
    check("bazaar_ratings_stars_range", sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);
