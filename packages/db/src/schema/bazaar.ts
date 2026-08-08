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
import { orgs } from "./orgs";
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

export const BAZAAR_ITEM_SOURCES = [
  /** From UEX's /items walk — armour, weapons, components, clothing, liveries. */
  "uex_item",
  /** From UEX's /vehicles — ships and ground vehicles. */
  "uex_vehicle",
  /** Typed in by a seller because it wasn't in the list yet. */
  "player",
] as const;

/**
 * The item catalogue: what a seller is actually selling, as opposed to how they advertised it.
 *
 * A listing title is an advertisement ("Cutlass Black — fully kitted, S4 shields") and no two
 * sellers write it the same way, so titles can never answer "what did this go for last time".
 * This table is the thing prices attach to.
 *
 * It is seeded from UEX — ~7,700 items across 66 categories plus ~280 vehicles — and grows
 * from below: a seller who can't find their item types its in-game inventory name and that
 * becomes an entry the next seller picks from. Both kinds live in one table because a buyer
 * searching for a rifle should not have to know which half of the catalogue it came from,
 * and `source` records which it was.
 *
 * `nameKey` is the normalised form (see @kcx/shared itemNameKey) and carries the uniqueness
 * constraint. Matching on the display name instead would let "P4-AR", "p4 ar" and a
 * copy-paste with a non-breaking space become three items, and then price history for the
 * rifle is split three ways and every one of them reads as thin.
 */
export const bazaarItems = pgTable(
  "bazaar_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source", { enum: BAZAAR_ITEM_SOURCES }).notNull(),
    /** The id UEX knows it by, for re-syncing. Null on player-contributed entries. */
    sourceId: integer("source_id"),
    /** UEX's uuid, which is the game's own identifier where it has one. */
    uuid: text("uuid"),
    /** As shown to people. Never used for matching. */
    name: text("name").notNull(),
    /** Normalised match key — the column uniqueness and search actually run on. */
    nameKey: text("name_key").notNull(),
    section: text("section"),
    category: text("category"),
    companyName: text("company_name"),
    slug: text("slug"),
    gameVersion: text("game_version"),
    /** Who first typed it in. Null for anything that came from UEX. */
    createdById: uuid("created_by_id").references(() => users.id),
    /**
     * Listings ever created against this item. Ranks the picker so the things people
     * actually sell surface above the 600 helmets nobody has ever listed.
     */
    listingCount: integer("listing_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bazaar_items_key").on(t.nameKey),
    /** Re-sync looks rows up by where they came from. */
    uniqueIndex("bazaar_items_source").on(t.source, t.sourceId),
    index("bazaar_items_section").on(t.section, t.category),
    /** Picker ordering: most-listed first within a search. */
    index("bazaar_items_popular").on(t.listingCount),
  ],
);

/**
 * Which way a listing points.
 *
 * `sell` is the classifieds default: I have this, here is my price. `buy` is a standing
 * wanted ad — I want this, here is what I will pay — and it is the more interesting of the
 * two, because the money behind it is committed against the poster's declared balance for
 * as long as it stands. A wanted ad nobody has to back is a wish; this one is an offer.
 */
export const BAZAAR_INTENTS = ["sell", "buy"] as const;

export const bazaarListings = pgTable(
  "bazaar_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intent: text("intent", { enum: BAZAAR_INTENTS }).notNull().default("sell"),
    /**
     * What this listing is, in catalogue terms. Nullable because listings predate the
     * catalogue and because a bundle genuinely isn't one item — but it is what price
     * history hangs off, so a listing without it gets none.
     */
    itemId: bigint("item_id", { mode: "number" }).references(() => bazaarItems.id),
    /**
     * Whoever POSTED the listing — the seller on a WTS, and the BUYER on a WTB.
     *
     * The column keeps its original name because renaming it would touch every query, index
     * and DTO for a board that is still overwhelmingly sell-side. Read it as "poster", check
     * `intent` before assuming which side of the trade they are on, and note that
     * `bazaar_sales` records the real buyer and seller per sale — that, not this, is what
     * settlement and collateral run on.
     */
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    /**
     * Set when the poster is acting for an org rather than themselves.
     *
     * It changes WHOSE money is on the hook: a wanted ad posted for an org commits the org's
     * treasury, not the poster's balance. The person stays recorded either way — an org
     * cannot itself click anything, and "which member did this" is the first question asked
     * when an org's money moves.
     */
    orgId: uuid("org_id").references(() => orgs.id),
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
    /**
     * Filed away by the seller, so their desk shows what they are working on rather than
     * everything they have ever posted.
     *
     * Deliberately not a status: archiving is a view preference belonging to the seller,
     * while status describes what the listing IS to everyone else. Folding it into the enum
     * would have made "archived" a thing buyers could observe, and would have destroyed the
     * record of how the listing actually ended.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
    index("bazaar_listings_archived").on(t.sellerId, t.archivedAt),
    index("bazaar_category").on(t.category, t.status),
    /** "What did this item last go for" walks listings by item, newest first. */
    index("bazaar_listings_item").on(t.itemId, t.createdAt),
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
    /**
     * A wanted ad is a fixed offer. Letting sellers bid a wanted ad DOWN is a reverse
     * auction, which is a different mechanism with a different fairness argument (see the
     * sealed bidding on service contracts) — not something to get by accident from a flag.
     */
    check("bazaar_wtb_is_fixed", sql`${t.intent} = 'sell' OR ${t.listingType} = 'buy_now'`),
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

/**
 * A ship's loadout, as data rather than as the words "fully kitted".
 *
 * Every component points at the same catalogue the listing itself does, so a buyer can see
 * that the shields really are S4 and — later — search for ships carrying a part they want.
 * The seller's prose stays in `description`; this is the part a machine can read.
 *
 * Nothing verifies it. Star Citizen exposes no inventory API, so this is the seller's claim
 * in a structured form: easier to compare, easier to be caught misstating, and no more
 * enforceable than the description was.
 */
export const bazaarListingComponents = pgTable(
  "bazaar_listing_components",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => bazaarListings.id),
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => bazaarItems.id),
    /** Free text — "nose turret", "size 3 shield". The game's slot names aren't in the feed. */
    slotLabel: text("slot_label"),
    quantity: integer("quantity").notNull().default(1),
    sortIndex: smallint("sort_index").notNull().default(0),
  },
  (t) => [
    index("bazaar_components_listing").on(t.listingId, t.sortIndex),
    /** "Which ships are listed with this part" — the search this table exists to enable. */
    index("bazaar_components_item").on(t.itemId),
    check("bazaar_components_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const BAZAAR_THREAD_STATUSES = ["open", "closed"] as const;

/**
 * One conversation between a listing's owner and one interested trader.
 *
 * This is the piece the bazaar was missing. Settlement assumed two people had already
 * agreed — but there was nowhere in the product to do the agreeing, so it happened on
 * Discord where nothing could be recorded, priced, or held against anyone. A price that
 * emerges from a conversation nobody can see is a price we cannot stand behind.
 *
 * Private to the two parties and moderators. Deliberately not a public comment section:
 * public Q&A is a moderation surface with its own staffing cost, and the blocking problem
 * was that a buyer could not reach a seller at all.
 */
export const bazaarThreads = pgTable(
  "bazaar_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => bazaarListings.id),
    /** The listing's owner — seller on a WTS, buyer on a WTB. */
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /** The one who got in touch. */
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: BAZAAR_THREAD_STATUSES }).notNull().default("open"),
    /** Sort key for the desk, and half of the unread test. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    ownerReadAt: timestamp("owner_read_at", { withTimezone: true }),
    counterpartyReadAt: timestamp("counterparty_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One thread per interested trader per listing — messages stack, threads don't. */
    uniqueIndex("bazaar_threads_one_per_pair").on(t.listingId, t.counterpartyId),
    index("bazaar_threads_owner").on(t.ownerId, t.lastMessageAt),
    index("bazaar_threads_counterparty").on(t.counterpartyId, t.lastMessageAt),
    check("bazaar_threads_distinct_parties", sql`${t.ownerId} <> ${t.counterpartyId}`),
  ],
);

export const BAZAAR_MESSAGE_KINDS = ["message", "offer", "system"] as const;

export const BAZAAR_OFFER_STATUSES = [
  /** On the table. At most one per thread — a new offer supersedes the last. */
  "open",
  /** Taken by the other side; a sale exists as of that moment. */
  "accepted",
  "declined",
  "withdrawn",
  /** Replaced by a later offer from either side. */
  "superseded",
] as const;

/**
 * A message in a thread, which may carry a price.
 *
 * Offers live on messages rather than in their own table because an offer IS a thing
 * someone said — splitting them apart produces two histories that have to be interleaved to
 * be read, and the interleaving is the conversation.
 *
 * Either side may offer, and only the OTHER side may accept. That rules out the move where
 * someone offers and immediately accepts their own number, which would turn a negotiation
 * into a unilateral price change.
 */
export const bazaarMessages = pgTable(
  "bazaar_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => bazaarThreads.id),
    /** null = system (an offer superseded, a listing sold out from under the thread). */
    senderId: uuid("sender_id").references(() => users.id),
    kind: text("kind", { enum: BAZAAR_MESSAGE_KINDS }).notNull().default("message"),
    body: text("body"),
    /** Offer fields, all null on a plain message. Per unit, like every other bazaar price. */
    offerUnitPrice: bigint("offer_unit_price", { mode: "number" }),
    offerQuantity: integer("offer_quantity"),
    offerStatus: text("offer_status", { enum: BAZAAR_OFFER_STATUSES }),
    /** The sale struck when this offer was accepted. */
    saleId: uuid("sale_id").references(() => bazaarSales.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bazaar_messages_thread").on(t.threadId, t.createdAt),
    /** Finding the live offer in a thread, which acceptance and supersession both need. */
    index("bazaar_messages_open_offer").on(t.threadId).where(sql`${t.offerStatus} = 'open'`),
    check(
      "bazaar_messages_offer_shape",
      sql`(${t.kind} = 'offer') = (${t.offerUnitPrice} IS NOT NULL AND ${t.offerStatus} IS NOT NULL)`,
    ),
    check("bazaar_messages_offer_positive", sql`${t.offerUnitPrice} IS NULL OR ${t.offerUnitPrice} > 0`),
    check("bazaar_messages_offer_qty", sql`${t.offerQuantity} IS NULL OR ${t.offerQuantity} > 0`),
    /** A message has to say something or offer something. */
    check(
      "bazaar_messages_not_empty",
      sql`${t.body} IS NOT NULL OR ${t.offerUnitPrice} IS NOT NULL`,
    ),
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
    /**
     * Which side, if either, was acting for an org — and therefore whose aUEC moves at
     * settlement. Recorded on the sale rather than looked up from the listing because a
     * listing can be edited afterwards and a struck deal cannot.
     */
    sellerOrgId: uuid("seller_org_id").references(() => orgs.id),
    buyerOrgId: uuid("buyer_org_id").references(() => orgs.id),
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
