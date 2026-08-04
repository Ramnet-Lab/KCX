import type { OrderDto, OrderSide } from "@kcx/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { EMPTY_RATING, ratingsFor } from "./reputation";
import type { Db } from "../client";
import { commodities, locations } from "../schema/market";
import { orders, users } from "../schema/orders";

export type ListOrdersOptions = {
  commodityId?: number;
  side?: OrderSide;
  ownerId?: string;
  /** Viewer id, used only to flag `isMine`. */
  viewerId?: string | null;
  statuses?: (typeof orders.$inferSelect)["status"][];
  limit?: number;
};

/** Board listing with everything the UI needs denormalized; newest bump first. */
export async function listOrders(db: Db, opts: ListOrdersOptions = {}): Promise<OrderDto[]> {
  const conditions = [
    inArray(orders.status, opts.statuses ?? ["active", "paused"]),
    ...(opts.commodityId ? [eq(orders.commodityId, opts.commodityId)] : []),
    ...(opts.side ? [eq(orders.side, opts.side)] : []),
    ...(opts.ownerId ? [eq(orders.ownerId, opts.ownerId)] : []),
  ];

  const rows = await db
    .select({
      id: orders.id,
      side: orders.side,
      commodityId: orders.commodityId,
      commodityName: commodities.name,
      commoditySlug: commodities.slug,
      commodityCode: commodities.code,
      pricePerScu: orders.pricePerScu,
      quantityScu: orders.quantityScu,
      remainingScu: orders.remainingScu,
      reservedScu: orders.reservedScu,
      minFillScu: orders.minFillScu,
      locationId: orders.locationId,
      locationName: locations.name,
      notes: orders.notes,
      status: orders.status,
      ownerId: orders.ownerId,
      ownerHandle: users.handle,
      ownerDisplayName: users.displayName,
      ownerVerified: users.isVerified,
      createdAt: orders.createdAt,
      bumpedAt: orders.bumpedAt,
      expiresAt: orders.expiresAt,
    })
    .from(orders)
    .innerJoin(commodities, eq(orders.commodityId, commodities.id))
    .innerJoin(users, eq(orders.ownerId, users.id))
    .leftJoin(locations, eq(orders.locationId, locations.id))
    .where(and(...conditions))
    .orderBy(desc(orders.bumpedAt))
    .limit(Math.min(opts.limit ?? 200, 500));

  // One extra query for the whole page rather than a rating lookup per row.
  const ratings = await ratingsFor(db, rows.map((r) => r.ownerId));

  return rows.map((r) => {
    const rating = ratings.get(r.ownerId) ?? EMPTY_RATING;
    return {
    id: r.id,
    side: r.side,
    commodityId: r.commodityId,
    commodityName: r.commodityName,
    commoditySlug: r.commoditySlug,
    commodityCode: r.commodityCode,
    pricePerScu: r.pricePerScu,
    quantityScu: r.quantityScu,
    remainingScu: r.remainingScu,
    reservedScu: r.reservedScu,
    minFillScu: r.minFillScu,
    locationId: r.locationId,
    locationName: r.locationName,
    notes: r.notes,
    status: r.status,
    ownerHandle: r.ownerHandle,
    ownerDisplayName: r.ownerDisplayName,
    ownerVerified: r.ownerVerified,
    ownerSettled: rating.settled,
    ownerEntered: rating.entered,
    ownerCompletionPct: rating.completionPct,
    ownerStars: rating.stars,
    ownerRatingCount: rating.ratingCount,
    isMine: opts.viewerId != null && r.ownerId === opts.viewerId,
    createdAt: r.createdAt.toISOString(),
    bumpedAt: r.bumpedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    };
  });
}

/** Best resting prices per commodity — the "player market" summary beside the NPC baseline. */
export async function orderBookTops(
  db: Db,
): Promise<Map<number, { bestBid: number | null; bestAsk: number | null; bids: number; asks: number }>> {
  const result = await db.execute<{
    commodity_id: number;
    best_bid: string | null;
    best_ask: string | null;
    bids: string;
    asks: string;
  }>(sql`
    SELECT commodity_id,
           max(price_per_scu) FILTER (WHERE side = 'buy')::text  AS best_bid,
           min(price_per_scu) FILTER (WHERE side = 'sell')::text AS best_ask,
           count(*) FILTER (WHERE side = 'buy')::text            AS bids,
           count(*) FILTER (WHERE side = 'sell')::text           AS asks
    FROM orders
    WHERE status = 'active' AND remaining_scu > 0
    GROUP BY commodity_id
  `);
  return new Map(
    result.rows.map((r) => [
      r.commodity_id,
      {
        bestBid: r.best_bid != null ? Number(r.best_bid) : null,
        bestAsk: r.best_ask != null ? Number(r.best_ask) : null,
        bids: Number(r.bids),
        asks: Number(r.asks),
      },
    ]),
  );
}
