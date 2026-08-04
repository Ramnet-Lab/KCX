import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  bazaarBids,
  bazaarEvents,
  bazaarListingImages,
  bazaarListings,
  bazaarRatings,
  bazaarSales,
} from "../schema/bazaar";
import { users } from "../schema/orders";
import { committedAuecSql } from "./collateral";

/**
 * Bazaar mechanics: listing the board, bidding, buying, and settling.
 *
 * The money rules are the same ones the rest of the exchange runs on — a buyer's obligation
 * is backed by their declared balance, and nothing changes hands until both parties say it
 * did. What's different is that nothing here feeds the market price: see schema/bazaar.ts.
 */

/** How long the pair have to meet in-game before the units go back on the board. */
export const BAZAAR_SETTLE_HOURS = 48;

/**
 * A bid inside this window pushes the close out to this many minutes from now.
 *
 * Without it the winning strategy is to bid once, in the last second, at the top of your
 * range — which is a worse price for the seller and a worse experience for everyone who
 * bid honestly for three days. Extending on late action makes the clock a measure of when
 * bidding actually stops rather than a race condition.
 */
export const BID_SOFT_CLOSE_MINUTES = 5;

/** A raise has to be a real raise; 2% keeps a 40M ship from being nudged 1 aUEC at a time. */
export const MIN_BID_INCREMENT_PCT = 0.02;
export const MIN_BID_INCREMENT_ABS = 1;

/** Minimum gap between bumps, matching the order board. */
export const BAZAAR_BUMP_COOLDOWN_MS = 8 * 3_600_000;

/** Photos per listing. Enough for a ship walkthrough, not enough to be an album. */
export const MAX_LISTING_IMAGES = 6;

/** The least a next bid may be: the start price if nobody has bid, else a real raise. */
export function minimumBid(listing: { currentBid: number | null; startPrice: number | null }): number {
  if (listing.currentBid == null) return Math.max(1, listing.startPrice ?? 1);
  const step = Math.max(MIN_BID_INCREMENT_ABS, Math.ceil(listing.currentBid * MIN_BID_INCREMENT_PCT));
  return listing.currentBid + step;
}

/**
 * Whether a listing can still be bought outright.
 *
 * On a listing that carries both a clock and a price, the buy-now option retires as soon as
 * somebody bids: taking an item out from under a live bidder is the one move that would
 * make bidding early irrational, and bidding early is the whole point of the soft close.
 */
export function buyNowAvailable(listing: {
  listingType: string;
  buyNowPrice: number | null;
  bidCount: number;
  remainingQuantity: number;
  status: string;
}): boolean {
  if (listing.status !== "active" || listing.buyNowPrice == null) return false;
  if (listing.remainingQuantity <= 0) return false;
  return !(listing.listingType === "auction_buy_now" && listing.bidCount > 0);
}

export type BazaarStanding = {
  completed: number;
  undertaken: number;
  completionPct: number | null;
  stars: number | null;
  ratingCount: number;
};

export const EMPTY_BAZAAR_STANDING: BazaarStanding = {
  completed: 0,
  undertaken: 0,
  completionPct: null,
  stars: null,
  ratingCount: 0,
};

export type BazaarListingDto = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  listingType: string;
  buyNowPrice: number | null;
  /** False once bidding has started on a listing that had both — see buyNowAvailable. */
  canBuyNow: boolean;
  startPrice: number | null;
  currentBid: number | null;
  currentBidderName: string | null;
  /** Total bids placed, raises included, and how many distinct people are behind them. */
  bidCount: number;
  bidderCount: number;
  /** What the next bid must reach, precomputed so the form and the server agree. */
  minimumBid: number;
  auctionEndsAt: string | null;
  quantity: number;
  remainingQuantity: number;
  locationId: number | null;
  locationName: string | null;
  status: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  sellerVerified: boolean;
  sellerStanding: BazaarStanding;
  /** Filenames, thumbnail first. Served through /api/uploads/bazaar/<filename>. */
  images: string[];
  /** Viewer-relative flags, so the UI needn't re-derive them. */
  isSeller: boolean;
  isHighBidder: boolean;
  myBid: number | null;
  createdAt: string;
  bumpedAt: string;
  expiresAt: string;
};

export type BazaarListOptions = {
  viewerId?: string | null;
  category?: string | null;
  /** Free-text match on title and description. */
  search?: string | null;
  listingType?: string | null;
  statuses?: string[];
  sellerId?: string | null;
  mineOnly?: boolean;
  sort?: "newest" | "ending" | "price_asc" | "price_desc";
  limit?: number;
};

type ListingRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  listing_type: string;
  buy_now_price: string | null;
  start_price: string | null;
  current_bid: string | null;
  current_bidder_id: string | null;
  current_bidder_name: string | null;
  bid_count: number;
  bidder_count: number;
  auction_ends_at: string | Date | null;
  quantity: number;
  remaining_quantity: number;
  location_id: number | null;
  location_name: string | null;
  status: string;
  seller_id: string;
  seller_name: string;
  seller_handle: string;
  seller_verified: boolean;
  images: string[] | null;
  my_bid: string | null;
  created_at: string | Date;
  bumped_at: string | Date;
  expires_at: string | Date;
};

function toListingDto(r: ListingRow, viewer: string | null, standing: BazaarStanding): BazaarListingDto {
  const currentBid = r.current_bid != null ? Number(r.current_bid) : null;
  const startPrice = r.start_price != null ? Number(r.start_price) : null;
  const buyNowPrice = r.buy_now_price != null ? Number(r.buy_now_price) : null;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    listingType: r.listing_type,
    buyNowPrice,
    canBuyNow: buyNowAvailable({
      listingType: r.listing_type,
      buyNowPrice,
      bidCount: r.bid_count,
      remainingQuantity: r.remaining_quantity,
      status: r.status,
    }),
    startPrice,
    currentBid,
    currentBidderName: r.current_bidder_name,
    bidCount: r.bid_count,
    bidderCount: r.bidder_count,
    minimumBid: minimumBid({ currentBid, startPrice }),
    auctionEndsAt: r.auction_ends_at ? new Date(r.auction_ends_at).toISOString() : null,
    quantity: r.quantity,
    remainingQuantity: r.remaining_quantity,
    locationId: r.location_id,
    locationName: r.location_name,
    status: r.status,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    sellerHandle: r.seller_handle,
    sellerVerified: r.seller_verified,
    sellerStanding: standing,
    images: r.images ?? [],
    isSeller: viewer != null && r.seller_id === viewer,
    isHighBidder: viewer != null && r.current_bidder_id === viewer,
    myBid: r.my_bid != null ? Number(r.my_bid) : null,
    createdAt: new Date(r.created_at).toISOString(),
    bumpedAt: new Date(r.bumped_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  };
}

/** The shared SELECT behind both the board and a single listing. */
function listingSelect(viewer: string | null) {
  return sql`
    SELECT l.id::text, l.title, l.description, l.category, l.listing_type,
           l.buy_now_price::text, l.start_price::text, l.current_bid::text,
           l.current_bidder_id::text, hb.display_name AS current_bidder_name,
           l.bid_count, coalesce(bc.n, 0)::int AS bidder_count,
           l.auction_ends_at, l.quantity, l.remaining_quantity,
           l.location_id, loc.name AS location_name, l.status,
           l.seller_id::text, s.display_name AS seller_name, s.handle AS seller_handle,
           s.is_verified AS seller_verified,
           img.files AS images,
           mine.amount::text AS my_bid,
           l.created_at, l.bumped_at, l.expires_at
    FROM bazaar_listings l
    JOIN users s ON s.id = l.seller_id
    LEFT JOIN users hb ON hb.id = l.current_bidder_id
    LEFT JOIN locations loc ON loc.id = l.location_id
    LEFT JOIN LATERAL (
      SELECT array_agg(i.filename ORDER BY i.sort_index, i.id) AS files
      FROM bazaar_listing_images i WHERE i.listing_id = l.id
    ) img ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM bazaar_bids b
      WHERE b.listing_id = l.id AND b.status <> 'lost'
    ) bc ON true
    LEFT JOIN LATERAL (
      SELECT b.amount FROM bazaar_bids b
      WHERE b.listing_id = l.id
        AND ${viewer ? sql`b.bidder_id = ${viewer}::uuid` : sql`false`}
    ) mine ON true
  `;
}

export async function listBazaarListings(db: Db, opts: BazaarListOptions = {}): Promise<BazaarListingDto[]> {
  const viewer = opts.viewerId ?? null;
  const statuses = opts.statuses ?? ["active"];
  const search = opts.search?.trim();

  const order =
    opts.sort === "ending"
      ? // Auctions first, soonest to close; listings with no clock fall to the back rather
        // than sorting as if they closed at the epoch.
        sql`l.auction_ends_at ASC NULLS LAST, l.expires_at ASC`
      : opts.sort === "price_asc"
        ? sql`coalesce(l.current_bid, l.buy_now_price, l.start_price) ASC NULLS LAST`
        : opts.sort === "price_desc"
          ? sql`coalesce(l.current_bid, l.buy_now_price, l.start_price) DESC NULLS LAST`
          : sql`l.bumped_at DESC`;

  const rows = await db.execute<ListingRow>(sql`
    ${listingSelect(viewer)}
    WHERE l.status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})
      ${opts.category ? sql`AND l.category = ${opts.category}` : sql``}
      ${opts.listingType ? sql`AND l.listing_type = ${opts.listingType}` : sql``}
      ${opts.sellerId ? sql`AND l.seller_id = ${opts.sellerId}::uuid` : sql``}
      ${opts.mineOnly && viewer ? sql`AND l.seller_id = ${viewer}::uuid` : sql``}
      ${search ? sql`AND (l.title ILIKE ${`%${search}%`} OR l.description ILIKE ${`%${search}%`})` : sql``}
    ORDER BY ${order}
    LIMIT ${Math.min(opts.limit ?? 120, 500)}
  `);

  const standings = await bazaarStandingFor(db, rows.rows.map((r) => r.seller_id));
  return rows.rows.map((r) => toListingDto(r, viewer, standings.get(r.seller_id) ?? EMPTY_BAZAAR_STANDING));
}

export async function getBazaarListing(
  db: Db,
  id: string,
  viewerId?: string | null,
): Promise<BazaarListingDto | null> {
  const viewer = viewerId ?? null;
  const rows = await db.execute<ListingRow>(sql`
    ${listingSelect(viewer)}
    WHERE l.id = ${id}::uuid
    LIMIT 1
  `);
  const row = rows.rows[0];
  if (!row) return null;
  const standings = await bazaarStandingFor(db, [row.seller_id]);
  return toListingDto(row, viewer, standings.get(row.seller_id) ?? EMPTY_BAZAAR_STANDING);
}

export type BazaarResult = { ok: true; saleId?: string; listingId?: string } | { ok: false; error: string };

/** Transaction handle, as handed to the callback of `db.transaction`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * aUEC this trader can still promise, ignoring one bid they are about to replace.
 *
 * Raising your own high bid must not be checked against a balance that still counts the
 * lower bid you are replacing — that would make every raise look like two obligations.
 */
async function availableAuec(tx: Tx, userId: string, ignoreBidOnListing?: string): Promise<number> {
  const rows = await tx.execute<{ available: string }>(sql`
    SELECT (
      coalesce((SELECT auec_balance FROM users WHERE id = ${userId}), 0)
      - ${committedAuecSql(userId)}
      + coalesce((
        SELECT b.amount FROM bazaar_bids b
        WHERE b.bidder_id = ${userId} AND b.status = 'active'
          AND ${ignoreBidOnListing ? sql`b.listing_id = ${ignoreBidOnListing}::uuid` : sql`false`}
      ), 0)
    )::text AS available
  `);
  return Number(rows.rows[0]?.available ?? 0);
}

/**
 * Place or raise a bid on an open ascending auction.
 *
 * Bids are binding and there is no retraction: the amount is committed against the bidder's
 * declared balance for as long as theirs is the high bid, and released the instant someone
 * beats it. That is the only sense in which KCX can make a bid mean something, so it is
 * enforced here rather than left to the honour of whoever clicks.
 */
export async function placeBazaarBid(
  db: Db,
  opts: { listingId: string; bidderId: string; amount: number },
): Promise<BazaarResult> {
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, opts.listingId)).for("update");
    if (!l) return { ok: false as const, error: "Listing not found" };
    if (l.listingType === "buy_now") return { ok: false as const, error: "This listing isn't an auction" };
    if (l.sellerId === opts.bidderId) return { ok: false as const, error: "You can't bid on your own listing" };
    if (l.status !== "active") {
      return { ok: false as const, error: `This listing is ${l.status.replace(/_/g, " ")}` };
    }

    const now = new Date();
    if (!l.auctionEndsAt || l.auctionEndsAt <= now) return { ok: false as const, error: "Bidding has closed" };

    const floor = minimumBid(l);
    if (opts.amount < floor) {
      return { ok: false as const, error: `The next bid has to be at least ${floor.toLocaleString()} aUEC.` };
    }

    const available = await availableAuec(tx, opts.bidderId, l.id);
    if (opts.amount > available) {
      return {
        ok: false as const,
        error: `A bid of ${opts.amount.toLocaleString()} aUEC exceeds the ${Math.max(0, available).toLocaleString()} you have free — your orders, contracts and other bids are already committed against your declared balance.`,
      };
    }

    const [existing] = await tx
      .select()
      .from(bazaarBids)
      .where(and(eq(bazaarBids.listingId, l.id), eq(bazaarBids.bidderId, opts.bidderId)));

    // Release the trader being beaten before recording the new leader, so the two states
    // never overlap inside the transaction.
    if (l.currentBidderId && l.currentBidderId !== opts.bidderId) {
      await tx
        .update(bazaarBids)
        .set({ status: "outbid", updatedAt: now })
        .where(and(eq(bazaarBids.listingId, l.id), eq(bazaarBids.bidderId, l.currentBidderId)));
      await tx.insert(bazaarEvents).values({
        listingId: l.id,
        actorId: l.currentBidderId,
        type: "outbid",
        data: { at: opts.amount },
      });
    }

    if (existing) {
      await tx
        .update(bazaarBids)
        .set({ amount: opts.amount, status: "active", updatedAt: now })
        .where(eq(bazaarBids.id, existing.id));
    } else {
      await tx.insert(bazaarBids).values({ listingId: l.id, bidderId: opts.bidderId, amount: opts.amount });
    }

    // Soft close: late action pushes the clock, never pulls it in.
    const softClose = new Date(now.getTime() + BID_SOFT_CLOSE_MINUTES * 60_000);
    const extended = softClose > l.auctionEndsAt;
    const auctionEndsAt = extended ? softClose : l.auctionEndsAt;
    // The listing must outlive its own auction, or the sweep would expire it out from
    // under a bidder who just extended it.
    const expiresAt = auctionEndsAt > l.expiresAt ? auctionEndsAt : l.expiresAt;

    await tx
      .update(bazaarListings)
      .set({
        currentBid: opts.amount,
        currentBidderId: opts.bidderId,
        bidCount: sql`${bazaarListings.bidCount} + 1`,
        auctionEndsAt,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(bazaarListings.id, l.id));

    await tx.insert(bazaarEvents).values({
      listingId: l.id,
      actorId: opts.bidderId,
      type: existing ? "bid_raised" : "bid_placed",
      data: { amount: opts.amount },
    });
    if (extended) {
      await tx.insert(bazaarEvents).values({
        listingId: l.id,
        actorId: null,
        type: "auction_extended",
        data: { until: auctionEndsAt.toISOString() },
      });
    }
    return { ok: true as const, listingId: l.id };
  });
}

/** Take a listing at its asking price. Creates the sale both parties then have to confirm. */
export async function buyBazaarNow(
  db: Db,
  opts: { listingId: string; buyerId: string; quantity: number },
): Promise<BazaarResult> {
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, opts.listingId)).for("update");
    if (!l) return { ok: false as const, error: "Listing not found" };
    if (l.sellerId === opts.buyerId) return { ok: false as const, error: "You can't buy your own listing" };
    if (!buyNowAvailable(l)) {
      if (l.listingType === "auction_buy_now" && l.bidCount > 0) {
        return { ok: false as const, error: "Bidding has started — this one goes to the highest bidder now." };
      }
      if (l.listingType === "auction") return { ok: false as const, error: "This listing is bids only" };
      return { ok: false as const, error: `This listing is ${l.status.replace(/_/g, " ")}` };
    }
    if (l.expiresAt <= new Date()) return { ok: false as const, error: "This listing has expired" };

    const qty = Math.max(1, Math.floor(opts.quantity));
    if (qty > l.remainingQuantity) {
      return { ok: false as const, error: `Only ${l.remainingQuantity} left.` };
    }

    const unitPrice = l.buyNowPrice!;
    const total = unitPrice * qty;
    const available = await availableAuec(tx, opts.buyerId);
    if (total > available) {
      return {
        ok: false as const,
        error: `That costs ${total.toLocaleString()} aUEC but you have ${Math.max(0, available).toLocaleString()} free — orders, contracts and bids are already committed against your declared balance.`,
      };
    }

    const now = new Date();
    const remaining = l.remainingQuantity - qty;
    const [sale] = await tx
      .insert(bazaarSales)
      .values({
        listingId: l.id,
        sellerId: l.sellerId,
        buyerId: opts.buyerId,
        seasonId: l.seasonId,
        origin: "buy_now",
        quantity: qty,
        unitPrice,
        totalPrice: total,
        settleBy: new Date(now.getTime() + BAZAAR_SETTLE_HOURS * 3_600_000),
      })
      .returning();

    await tx
      .update(bazaarListings)
      .set({ remainingQuantity: remaining, status: remaining === 0 ? "sold_out" : l.status, updatedAt: now })
      .where(eq(bazaarListings.id, l.id));

    await tx.insert(bazaarEvents).values({
      listingId: l.id,
      saleId: sale!.id,
      actorId: opts.buyerId,
      type: "bought",
      data: { quantity: qty, unitPrice, total },
    });
    return { ok: true as const, saleId: sale!.id, listingId: l.id };
  });
}

/**
 * Close every auction whose clock has run out.
 *
 * One transaction per listing rather than one for the batch: a single stuck row shouldn't
 * hold a lock across every other auction ending in the same minute.
 */
export async function closeBazaarAuctions(db: Db): Promise<number> {
  const due = await db
    .select({ id: bazaarListings.id })
    .from(bazaarListings)
    .where(and(eq(bazaarListings.status, "active"), lte(bazaarListings.auctionEndsAt, new Date())));

  let closed = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, id)).for("update");
      if (!l || l.status !== "active" || !l.auctionEndsAt || l.auctionEndsAt > new Date()) return;

      const now = new Date();
      const [top] = await tx
        .select()
        .from(bazaarBids)
        .where(and(eq(bazaarBids.listingId, l.id), eq(bazaarBids.status, "active")))
        .orderBy(desc(bazaarBids.amount), asc(bazaarBids.createdAt))
        .limit(1);

      if (!top) {
        await tx
          .update(bazaarListings)
          .set({ status: "expired", updatedAt: now })
          .where(eq(bazaarListings.id, l.id));
        await tx.insert(bazaarEvents).values({
          listingId: l.id,
          actorId: null,
          type: "auction_no_bids",
          data: {},
        });
        closed += 1;
        return;
      }

      const [sale] = await tx
        .insert(bazaarSales)
        .values({
          listingId: l.id,
          sellerId: l.sellerId,
          buyerId: top.bidderId,
          seasonId: l.seasonId,
          origin: "auction",
          quantity: 1,
          unitPrice: top.amount,
          totalPrice: top.amount,
          settleBy: new Date(now.getTime() + BAZAAR_SETTLE_HOURS * 3_600_000),
        })
        .returning();

      await tx.update(bazaarBids).set({ status: "won", updatedAt: now }).where(eq(bazaarBids.id, top.id));
      await tx
        .update(bazaarListings)
        .set({ status: "sold_out", remainingQuantity: 0, updatedAt: now })
        .where(eq(bazaarListings.id, l.id));
      await tx.insert(bazaarEvents).values({
        listingId: l.id,
        saleId: sale!.id,
        actorId: null,
        type: "auction_won",
        data: { amount: top.amount, bidderId: top.bidderId },
      });
      closed += 1;
    });
  }
  return closed;
}

/** Drop listings past their own deadline. Auctions are handled by closeBazaarAuctions. */
export async function expireBazaarListings(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(bazaarListings)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          sql`${bazaarListings.status} IN ('active','paused')`,
          sql`${bazaarListings.expiresAt} <= now()`,
          // An auction still holding a live clock belongs to the auction sweep, which has
          // to award it before anything expires it.
          sql`(${bazaarListings.auctionEndsAt} IS NULL OR ${bazaarListings.auctionEndsAt} <= now())`,
        ),
      )
      .returning({ id: bazaarListings.id });
    if (expired.length > 0) {
      await tx
        .insert(bazaarEvents)
        .values(expired.map((l) => ({ listingId: l.id, actorId: null, type: "expired" as const, data: {} })));
    }
    return expired.length;
  });
}

/**
 * Put units back on the board after a sale falls through.
 *
 * A buy-now listing simply gets its stock back and reopens if it still has time on it. An
 * auction does NOT reopen: it already ran its course, every other bidder has moved on, and
 * restarting a finished auction would leave a clock in the past. The seller relists.
 */
async function restockListing(tx: Tx, saleId: string): Promise<void> {
  const [sale] = await tx.select().from(bazaarSales).where(eq(bazaarSales.id, saleId));
  if (!sale) return;
  const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, sale.listingId)).for("update");
  if (!l) return;

  if (sale.origin === "auction") {
    await tx
      .update(bazaarListings)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(bazaarListings.id, l.id));
    return;
  }

  const remaining = Math.min(l.quantity, l.remainingQuantity + sale.quantity);
  const reopens = l.status === "sold_out" && l.expiresAt > new Date();
  await tx
    .update(bazaarListings)
    .set({ remainingQuantity: remaining, status: reopens ? "active" : l.status, updatedAt: new Date() })
    .where(eq(bazaarListings.id, l.id));
}

/**
 * Confirm or abandon a sale.
 *
 * Settlement needs BOTH sides, exactly as commodity escrow and service contracts do. One
 * confirmation alone changes nothing — the seller cannot declare a handover that never
 * happened, and the buyer cannot deny one that did without the seller's silence.
 */
export async function resolveBazaarSale(
  db: Db,
  opts: { saleId: string; userId: string; action: "confirm" | "cancel" },
): Promise<BazaarResult> {
  return db.transaction(async (tx) => {
    const [sale] = await tx.select().from(bazaarSales).where(eq(bazaarSales.id, opts.saleId)).for("update");
    if (!sale) return { ok: false as const, error: "Sale not found" };

    const isSeller = sale.sellerId === opts.userId;
    const isBuyer = sale.buyerId === opts.userId;
    if (!isSeller && !isBuyer) return { ok: false as const, error: "You're not party to this sale" };
    if (sale.status !== "pending") return { ok: false as const, error: `This sale is already ${sale.status}` };

    const now = new Date();

    if (opts.action === "cancel") {
      await tx
        .update(bazaarSales)
        .set({ status: "cancelled", cancelledById: opts.userId, closedAt: now })
        .where(eq(bazaarSales.id, sale.id));
      await tx.insert(bazaarEvents).values({
        listingId: sale.listingId,
        saleId: sale.id,
        actorId: opts.userId,
        type: "sale_cancelled",
        data: {},
      });
      await restockListing(tx, sale.id);
      return { ok: true as const, saleId: sale.id };
    }

    const sellerConfirmedAt = isSeller ? (sale.sellerConfirmedAt ?? now) : sale.sellerConfirmedAt;
    const buyerConfirmedAt = isBuyer ? (sale.buyerConfirmedAt ?? now) : sale.buyerConfirmedAt;

    await tx.insert(bazaarEvents).values({
      listingId: sale.listingId,
      saleId: sale.id,
      actorId: opts.userId,
      type: isSeller ? "confirmed_by_seller" : "confirmed_by_buyer",
      data: {},
    });

    if (!sellerConfirmedAt || !buyerConfirmedAt) {
      await tx
        .update(bazaarSales)
        .set({ sellerConfirmedAt, buyerConfirmedAt })
        .where(eq(bazaarSales.id, sale.id));
      return { ok: true as const, saleId: sale.id };
    }

    // --- Both agreed: move the money ---
    const [buyer] = await tx.select().from(users).where(eq(users.id, sale.buyerId)).for("update");
    if ((buyer?.auecBalance ?? 0) < sale.totalPrice) {
      return {
        ok: false as const,
        error: `The buyer has ${(buyer?.auecBalance ?? 0).toLocaleString()} aUEC declared but the sale is ${sale.totalPrice.toLocaleString()}. They need to update their declared balance before this can settle.`,
      };
    }

    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} - ${sale.totalPrice}` })
      .where(eq(users.id, sale.buyerId));
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} + ${sale.totalPrice}` })
      .where(eq(users.id, sale.sellerId));

    await tx
      .update(bazaarSales)
      .set({ status: "completed", sellerConfirmedAt, buyerConfirmedAt, closedAt: now })
      .where(eq(bazaarSales.id, sale.id));
    await tx.insert(bazaarEvents).values({
      listingId: sale.listingId,
      saleId: sale.id,
      actorId: opts.userId,
      type: "sale_completed",
      data: { total: sale.totalPrice },
    });
    return { ok: true as const, saleId: sale.id };
  });
}

/** Sales nobody confirmed inside the window. The units go back; the record stays. */
export async function expireBazaarSales(db: Db): Promise<number> {
  const due = await db
    .select({ id: bazaarSales.id })
    .from(bazaarSales)
    .where(and(eq(bazaarSales.status, "pending"), lte(bazaarSales.settleBy, new Date())));

  let expired = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [sale] = await tx.select().from(bazaarSales).where(eq(bazaarSales.id, id)).for("update");
      if (!sale || sale.status !== "pending") return;
      await tx
        .update(bazaarSales)
        .set({ status: "expired", closedAt: new Date() })
        .where(eq(bazaarSales.id, sale.id));
      await tx.insert(bazaarEvents).values({
        listingId: sale.listingId,
        saleId: sale.id,
        actorId: null,
        type: "sale_expired",
        data: {},
      });
      await restockListing(tx, sale.id);
      expired += 1;
    });
  }
  return expired;
}

export type BazaarSaleDto = {
  id: string;
  listingId: string;
  title: string;
  thumbnail: string | null;
  origin: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  counterpartyName: string;
  sellerConfirmed: boolean;
  buyerConfirmed: boolean;
  isSeller: boolean;
  isBuyer: boolean;
  /** Whether this viewer has already left their rating. */
  rated: boolean;
  settleBy: string;
  createdAt: string;
  closedAt: string | null;
};

/** Every sale this trader is on either side of, newest first. */
export async function listBazaarSales(
  db: Db,
  userId: string,
  opts: { statuses?: string[]; limit?: number } = {},
): Promise<BazaarSaleDto[]> {
  const statuses = opts.statuses ?? ["pending", "completed", "cancelled", "expired"];
  const rows = await db.execute<{
    id: string; listing_id: string; title: string; thumbnail: string | null;
    origin: string; quantity: number; unit_price: string; total_price: string; status: string;
    seller_id: string; seller_name: string; buyer_id: string; buyer_name: string;
    seller_confirmed_at: string | Date | null; buyer_confirmed_at: string | Date | null;
    rated: boolean; settle_by: string | Date; created_at: string | Date; closed_at: string | Date | null;
  }>(sql`
    SELECT sa.id::text, sa.listing_id::text, l.title, img.filename AS thumbnail,
           sa.origin, sa.quantity, sa.unit_price::text, sa.total_price::text, sa.status,
           sa.seller_id::text, se.display_name AS seller_name,
           sa.buyer_id::text, bu.display_name AS buyer_name,
           sa.seller_confirmed_at, sa.buyer_confirmed_at,
           EXISTS (
             SELECT 1 FROM bazaar_ratings r
             WHERE r.sale_id = sa.id AND r.rater_id = ${userId}::uuid
           ) AS rated,
           sa.settle_by, sa.created_at, sa.closed_at
    FROM bazaar_sales sa
    JOIN bazaar_listings l ON l.id = sa.listing_id
    JOIN users se ON se.id = sa.seller_id
    JOIN users bu ON bu.id = sa.buyer_id
    LEFT JOIN LATERAL (
      SELECT i.filename FROM bazaar_listing_images i
      WHERE i.listing_id = l.id ORDER BY i.sort_index, i.id LIMIT 1
    ) img ON true
    WHERE (sa.seller_id = ${userId}::uuid OR sa.buyer_id = ${userId}::uuid)
      AND sa.status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})
    ORDER BY sa.created_at DESC
    LIMIT ${Math.min(opts.limit ?? 100, 300)}
  `);

  return rows.rows.map((r) => {
    const isSeller = r.seller_id === userId;
    return {
      id: r.id,
      listingId: r.listing_id,
      title: r.title,
      thumbnail: r.thumbnail,
      origin: r.origin,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      totalPrice: Number(r.total_price),
      status: r.status,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      buyerId: r.buyer_id,
      buyerName: r.buyer_name,
      counterpartyName: isSeller ? r.buyer_name : r.seller_name,
      sellerConfirmed: r.seller_confirmed_at != null,
      buyerConfirmed: r.buyer_confirmed_at != null,
      isSeller,
      isBuyer: r.buyer_id === userId,
      rated: r.rated,
      settleBy: new Date(r.settle_by).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
      closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    };
  });
}

/**
 * Bazaar standing — what happened, and how it felt, kept apart.
 *
 * "23/25 settled" is the objective record; stars are the subjective one. Blending them
 * would let a charming seller who half the time never shows up read the same as a terse one
 * who always does.
 */
export async function bazaarStandingFor(db: Db, userIds: string[]): Promise<Map<string, BazaarStanding>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const res = await db.execute<{
    user_id: string; completed: number; undertaken: number; avg_stars: string | null; rating_count: number;
  }>(sql`
    SELECT u.id::text AS user_id,
           coalesce(s.completed, 0)::int    AS completed,
           coalesce(s.undertaken, 0)::int   AS undertaken,
           r.avg_stars::text                AS avg_stars,
           coalesce(r.rating_count, 0)::int AS rating_count
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE sa.status = 'completed') AS completed,
             -- A sale still pending is not yet a fact about anyone, so it doesn't count
             -- either way until it resolves.
             count(*) FILTER (WHERE sa.status IN ('completed','cancelled','expired')) AS undertaken
      FROM bazaar_sales sa
      WHERE sa.seller_id = u.id OR sa.buyer_id = u.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT avg(stars)::numeric(3,2) AS avg_stars, count(*) AS rating_count
      FROM bazaar_ratings WHERE rated_id = u.id
    ) r ON true
    WHERE u.id IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
  `);

  return new Map(
    res.rows.map((r) => [
      r.user_id,
      {
        completed: r.completed,
        undertaken: r.undertaken,
        completionPct: r.undertaken > 0 ? Math.round((r.completed / r.undertaken) * 100) : null,
        stars: r.avg_stars != null ? Number(r.avg_stars) : null,
        ratingCount: r.rating_count,
      },
    ]),
  );
}

/** Completed sales the viewer can still rate. */
export async function pendingBazaarRatings(
  db: Db,
  userId: string,
): Promise<{ saleId: string; counterpartyName: string; title: string }[]> {
  const res = await db.execute<{ sale_id: string; counterparty_name: string; title: string }>(sql`
    SELECT sa.id::text AS sale_id, other.display_name AS counterparty_name, l.title
    FROM bazaar_sales sa
    JOIN bazaar_listings l ON l.id = sa.listing_id
    JOIN users other
      ON other.id = CASE WHEN sa.seller_id = ${userId}::uuid THEN sa.buyer_id ELSE sa.seller_id END
    WHERE sa.status = 'completed'
      AND (sa.seller_id = ${userId}::uuid OR sa.buyer_id = ${userId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM bazaar_ratings r WHERE r.sale_id = sa.id AND r.rater_id = ${userId}::uuid
      )
    ORDER BY sa.closed_at DESC
    LIMIT 20
  `);
  return res.rows.map((r) => ({ saleId: r.sale_id, counterpartyName: r.counterparty_name, title: r.title }));
}

/** Rate the other party to a settled sale. One rating each, and only once it's done. */
export async function rateBazaarSale(
  db: Db,
  opts: { saleId: string; raterId: string; stars: number; comment?: string | null },
): Promise<BazaarResult> {
  const [sale] = await db.select().from(bazaarSales).where(eq(bazaarSales.id, opts.saleId));
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status !== "completed") return { ok: false, error: "Only settled sales can be rated" };
  const isSeller = sale.sellerId === opts.raterId;
  const isBuyer = sale.buyerId === opts.raterId;
  if (!isSeller && !isBuyer) return { ok: false, error: "You're not party to this sale" };

  try {
    await db.insert(bazaarRatings).values({
      saleId: sale.id,
      raterId: opts.raterId,
      ratedId: isSeller ? sale.buyerId : sale.sellerId,
      stars: opts.stars,
      comment: opts.comment?.trim() || null,
    });
  } catch {
    // The unique index is the real guard; a second attempt is a duplicate, not an error
    // worth a 500.
    return { ok: false, error: "You've already rated this sale" };
  }
  return { ok: true, saleId: sale.id };
}

/**
 * Everything a trader needs on their own listings: live ones, plus the ones that ended so
 * they can relist. Sales come from listBazaarSales alongside it.
 */
export async function myBazaarListings(db: Db, userId: string): Promise<BazaarListingDto[]> {
  return listBazaarListings(db, {
    viewerId: userId,
    sellerId: userId,
    statuses: ["active", "paused", "sold_out", "expired", "cancelled"],
    sort: "newest",
    limit: 300,
  });
}

/** Images on a listing, thumbnail first. */
export async function listingImages(db: Db, listingId: string): Promise<string[]> {
  const rows = await db
    .select({ filename: bazaarListingImages.filename })
    .from(bazaarListingImages)
    .where(eq(bazaarListingImages.listingId, listingId))
    .orderBy(asc(bazaarListingImages.sortIndex), asc(bazaarListingImages.id));
  return rows.map((r) => r.filename);
}
