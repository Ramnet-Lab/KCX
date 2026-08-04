import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  orderEvents,
  orders,
  tradeEvents,
  tradePrints,
  trades,
  userHoldings,
  users,
} from "../schema/orders";
import type { PrintExclusion } from "../schema/orders";
import { marketMakerQuotes } from "../schema/market-makers";
import { MAX_OPEN_ESCROWS, committedAuecSql, committedScuSql } from "./collateral";
import { refreshCommodityMark } from "./market-point";
import { judgePrint } from "./print-integrity";

/** Default escrow window — long enough to meet in-game, short enough not to squat on cargo. */
export const ESCROW_HOURS = 24;

/** After you release a contract, you can't immediately re-lock the same order. */
export const RECLAIM_COOLDOWN_MINUTES = 30;

export type ClaimResult =
  | { ok: true; tradeId: string; ownerId: string; commodityId: number }
  | { ok: false; error: string };
export type ContractResult =
  | {
      ok: true;
      status: string;
      settled: boolean;
      /** True only when the fill actually moved the mark — an excluded print does not. */
      priceMoved?: boolean;
      printExcluded?: boolean;
      printExclusionReason?: PrintExclusion | null;
      ownerId: string;
      claimerId: string;
      commodityId: number;
    }
  | { ok: false; error: string };

/**
 * Move cargo between two traders.
 *
 * Arithmetic happens IN SQL (`scu = scu + delta`) rather than read-modify-write in JS, so
 * two settlements touching the same holding can't lose each other's update. Shipments are
 * validated by the caller before any movement — never silently floored at zero, which would
 * conjure cargo out of nothing.
 */
async function moveCargo(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  userId: string,
  commodityId: number,
  deltaScu: number,
  pricePerScu: number,
) {
  if (deltaScu > 0) {
    await tx
      .insert(userHoldings)
      .values({ userId, commodityId, scu: deltaScu, avgCost: pricePerScu })
      .onConflictDoUpdate({
        target: [userHoldings.userId, userHoldings.commodityId],
        set: {
          // Blend the trade price into the position's weighted average cost.
          avgCost: sql`CASE
            WHEN ${userHoldings.avgCost} IS NULL THEN ${pricePerScu}
            ELSE round((${userHoldings.scu}::numeric * ${userHoldings.avgCost} + ${deltaScu}::numeric * ${pricePerScu})
                       / NULLIF(${userHoldings.scu} + ${deltaScu}, 0))
          END`,
          scu: sql`${userHoldings.scu} + ${deltaScu}`,
          updatedAt: new Date(),
        },
      });
    return;
  }

  await tx
    .update(userHoldings)
    .set({ scu: sql`${userHoldings.scu} + ${deltaScu}`, updatedAt: new Date() })
    .where(and(eq(userHoldings.userId, userId), eq(userHoldings.commodityId, commodityId)));
  await tx
    .delete(userHoldings)
    .where(
      and(eq(userHoldings.userId, userId), eq(userHoldings.commodityId, commodityId), sql`${userHoldings.scu} <= 0`),
    );
}

/**
 * Claim an order into escrow: reserves the quantity so no one else chases the same cargo.
 *
 * The claimer is collateral-checked on the opposite side of the order — claiming a sell
 * order means paying, so it needs aUEC; claiming a buy order means shipping, so it needs
 * the cargo.
 */
export async function claimOrder(
  db: Db,
  opts: { orderId: string; claimerId: string; quantityScu?: number },
): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, opts.orderId)).for("update");
    if (!order) return { ok: false as const, error: "Order not found" };
    if (order.ownerId === opts.claimerId) return { ok: false as const, error: "You can't claim your own order" };
    if (order.status !== "active") {
      return { ok: false as const, error: `Order is ${order.status.replace(/_/g, " ")}` };
    }
    if (order.expiresAt <= new Date()) return { ok: false as const, error: "Order has passed its fill-by deadline" };

    const available = order.remainingScu - order.reservedScu;
    const qty = Math.min(opts.quantityScu ?? available, available);
    if (qty <= 0) return { ok: false as const, error: "This order is fully claimed by another trader" };
    if (qty < order.minFillScu) {
      return { ok: false as const, error: `This order requires at least ${order.minFillScu} SCU per contract` };
    }

    const value = qty * order.pricePerScu;

    // Anti-griefing: claiming is free and locks someone else's cargo, so cap how much of
    // the board one trader can freeze at once, and stop claim/cancel/claim churn.
    const escrowCount = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM trades
      WHERE status = 'escrow' AND (owner_id = ${opts.claimerId} OR claimer_id = ${opts.claimerId})
    `);
    if (Number(escrowCount.rows[0]?.n ?? 0) >= MAX_OPEN_ESCROWS) {
      return {
        ok: false as const,
        error: `You already have ${MAX_OPEN_ESCROWS} contracts in escrow — settle or release some before claiming more.`,
      };
    }
    const recentlyAbandoned = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM trades
      WHERE order_id = ${order.id} AND claimer_id = ${opts.claimerId}
        AND status IN ('cancelled','expired')
        AND closed_at > now() - make_interval(mins => ${RECLAIM_COOLDOWN_MINUTES})
    `);
    if (Number(recentlyAbandoned.rows[0]?.n ?? 0) > 0) {
      return {
        ok: false as const,
        error: `You released this order recently — you can claim it again in up to ${RECLAIM_COOLDOWN_MINUTES} minutes.`,
      };
    }

    // Claimer takes the opposite side, so their collateral requirement inverts. Capacity is
    // measured against ALL obligations — resting orders AND other open escrows alike.
    if (order.side === "sell") {
      const rows = await tx.execute<{ balance: string; committed: string }>(sql`
        SELECT coalesce((SELECT auec_balance FROM users WHERE id = ${opts.claimerId}), 0)::text AS balance,
               ${committedAuecSql(opts.claimerId)}::text AS committed
      `);
      const available = Number(rows.rows[0]?.balance ?? 0) - Number(rows.rows[0]?.committed ?? 0);
      if (value > available) {
        return {
          ok: false as const,
          error: `This contract costs ${value.toLocaleString()} aUEC — you have ${Math.max(0, available).toLocaleString()} available after your other orders and contracts.`,
        };
      }
    } else {
      const rows = await tx.execute<{ held: string; committed: string }>(sql`
        SELECT coalesce((SELECT scu FROM user_holdings WHERE user_id = ${opts.claimerId} AND commodity_id = ${order.commodityId}), 0)::text AS held,
               ${committedScuSql(opts.claimerId, order.commodityId)}::text AS committed
      `);
      const available = Number(rows.rows[0]?.held ?? 0) - Number(rows.rows[0]?.committed ?? 0);
      if (qty > available) {
        return {
          ok: false as const,
          error:
            available <= 0
              ? "You don't hold this commodity — you can't fill a buy order for it."
              : `You have ${available.toLocaleString()} SCU available after your other orders and contracts.`,
        };
      }
    }

    // Escrow ends at the sooner of the standard window and the order's own fill-by deadline.
    const escrowDeadline = new Date(Date.now() + ESCROW_HOURS * 3_600_000);
    const expiresAt = escrowDeadline < order.expiresAt ? escrowDeadline : order.expiresAt;

    const [trade] = await tx
      .insert(trades)
      .values({
        orderId: order.id,
        ownerId: order.ownerId,
        claimerId: opts.claimerId,
        commodityId: order.commodityId,
        seasonId: order.seasonId,
        side: order.side,
        quantityScu: qty,
        pricePerScu: order.pricePerScu,
        expiresAt,
      })
      .returning();

    await tx
      .update(orders)
      .set({ reservedScu: order.reservedScu + qty, updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    await tx.insert(tradeEvents).values({
      tradeId: trade!.id,
      actorId: opts.claimerId,
      type: "claimed",
      data: { quantityScu: qty, pricePerScu: order.pricePerScu, value },
    });

    return { ok: true as const, tradeId: trade!.id, ownerId: order.ownerId, commodityId: order.commodityId };
  });
}

/**
 * Confirm or cancel an escrow contract.
 *
 * Settlement requires BOTH parties to confirm; a single confirmation just waits. Either
 * party may cancel, which releases the reservation and republishes the order — the trade
 * never happened, so nothing prints and no goods move.
 */
export async function resolveContract(
  db: Db,
  opts: { tradeId: string; userId: string; action: "confirm" | "cancel" },
): Promise<ContractResult> {
  return db.transaction(async (tx) => {
    const [trade] = await tx.select().from(trades).where(eq(trades.id, opts.tradeId)).for("update");
    if (!trade) return { ok: false as const, error: "Contract not found" };

    const isOwner = trade.ownerId === opts.userId;
    const isClaimer = trade.claimerId === opts.userId;
    if (!isOwner && !isClaimer) return { ok: false as const, error: "You're not party to this contract" };
    if (trade.status !== "escrow") {
      return { ok: false as const, error: `Contract is already ${trade.status}` };
    }

    const now = new Date();

    if (opts.action === "cancel") {
      await tx
        .update(trades)
        .set({ status: "cancelled", cancelledById: opts.userId, closedAt: now })
        .where(eq(trades.id, trade.id));
      await tx.insert(tradeEvents).values({ tradeId: trade.id, actorId: opts.userId, type: "cancelled", data: {} });
      // Release the lock — the order goes straight back on the board.
      await tx
        .update(orders)
        .set({ reservedScu: sql`greatest(0, ${orders.reservedScu} - ${trade.quantityScu})`, updatedAt: now })
        .where(eq(orders.id, trade.orderId));
      return {
        ok: true as const,
        status: "cancelled",
        settled: false,
        ownerId: trade.ownerId,
        claimerId: trade.claimerId,
        commodityId: trade.commodityId,
      };
    }

    const ownerConfirmedAt = isOwner ? (trade.ownerConfirmedAt ?? now) : trade.ownerConfirmedAt;
    const claimerConfirmedAt = isClaimer ? (trade.claimerConfirmedAt ?? now) : trade.claimerConfirmedAt;

    await tx.insert(tradeEvents).values({
      tradeId: trade.id,
      actorId: opts.userId,
      type: isOwner ? "confirmed_by_owner" : "confirmed_by_claimer",
      data: {},
    });

    if (!ownerConfirmedAt || !claimerConfirmedAt) {
      await tx.update(trades).set({ ownerConfirmedAt, claimerConfirmedAt }).where(eq(trades.id, trade.id));
      return {
        ok: true as const,
        status: "escrow",
        settled: false,
        ownerId: trade.ownerId,
        claimerId: trade.claimerId,
        commodityId: trade.commodityId,
      };
    }

    // --- Both confirmed: settle between the two parties ---
    const value = trade.quantityScu * trade.pricePerScu;
    // On a sell order the owner ships and is paid; on a buy order the roles invert.
    const cargoFrom = trade.side === "sell" ? trade.ownerId : trade.claimerId;
    const cargoTo = trade.side === "sell" ? trade.claimerId : trade.ownerId;

    // Both sides must genuinely cover the trade. Locking the rows first prevents a
    // concurrent settlement from spending the same balance, and failing loudly here beats
    // clamping at zero — a clamp would credit one side value the other never paid,
    // inventing aUEC and cargo that then leak into the printed market price.
    const [payer] = await tx.select().from(users).where(eq(users.id, cargoTo)).for("update");
    const [shipperHolding] = await tx
      .select()
      .from(userHoldings)
      .where(and(eq(userHoldings.userId, cargoFrom), eq(userHoldings.commodityId, trade.commodityId)))
      .for("update");

    if ((payer?.auecBalance ?? 0) < value) {
      return {
        ok: false as const,
        error: `Settlement blocked: the paying side has ${(payer?.auecBalance ?? 0).toLocaleString()} aUEC but the contract is ${value.toLocaleString()}. Update the declared balance, or cancel the contract.`,
      };
    }
    if ((shipperHolding?.scu ?? 0) < trade.quantityScu) {
      return {
        ok: false as const,
        error: `Settlement blocked: the delivering side holds ${(shipperHolding?.scu ?? 0).toLocaleString()} SCU but the contract is ${trade.quantityScu.toLocaleString()} SCU. Update the declared holding, or cancel the contract.`,
      };
    }

    await moveCargo(tx, cargoFrom, trade.commodityId, -trade.quantityScu, trade.pricePerScu);
    await moveCargo(tx, cargoTo, trade.commodityId, trade.quantityScu, trade.pricePerScu);
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} + ${value}` })
      .where(eq(users.id, cargoFrom));
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} - ${value}` })
      .where(eq(users.id, cargoTo));

    // Decide whether this print is allowed to move the market. Excluded prints are still
    // written — they stay on the public tape carrying their reason — they simply don't feed
    // the mark. See queries/print-integrity.ts for why price alone isn't a sufficient test.
    const verdict = await judgePrint(tx, {
      commodityId: trade.commodityId,
      side: trade.side,
      pricePerScu: trade.pricePerScu,
      quantityScu: trade.quantityScu,
      buyerId: cargoTo,
      sellerId: cargoFrom,
    });

    await tx.insert(tradePrints).values({
      orderId: trade.orderId,
      tradeId: trade.id,
      commodityId: trade.commodityId,
      seasonId: trade.seasonId,
      side: trade.side,
      buyerId: cargoTo,
      sellerId: cargoFrom,
      pricePerScu: trade.pricePerScu,
      quantityScu: trade.quantityScu,
      excluded: verdict.excluded,
      exclusionReason: verdict.reason,
      executedAt: now,
    });

    /*
     * Credit either party for honouring a standing quote.
     *
     * Uptime says a maker was there; this says they actually dealt when someone turned up,
     * which is the claim that matters and the one a quote left up unattended cannot fake.
     * Applied to both sides because either can be the maker — the person who posted the
     * order isn't necessarily the one quoting the market.
     */
    for (const party of [cargoTo, cargoFrom]) {
      if (!party) continue;
      await tx
        .update(marketMakerQuotes)
        .set({
          fillsHonoured: sql`${marketMakerQuotes.fillsHonoured} + 1`,
          scuHonoured: sql`${marketMakerQuotes.scuHonoured} + ${trade.quantityScu}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(marketMakerQuotes.userId, party),
            eq(marketMakerQuotes.commodityId, trade.commodityId),
            eq(marketMakerQuotes.status, "active"),
          ),
        );
    }

    const [order] = await tx.select().from(orders).where(eq(orders.id, trade.orderId)).for("update");
    const remaining = Math.max(0, (order?.remainingScu ?? 0) - trade.quantityScu);
    await tx
      .update(orders)
      .set({
        remainingScu: remaining,
        reservedScu: sql`greatest(0, ${orders.reservedScu} - ${trade.quantityScu})`,
        filledScu: (order?.filledScu ?? 0) + trade.quantityScu,
        filledAt: now,
        status: remaining === 0 ? "filled" : (order?.status ?? "active"),
        updatedAt: now,
      })
      .where(eq(orders.id, trade.orderId));
    await tx.insert(orderEvents).values({
      orderId: trade.orderId,
      actorId: opts.userId,
      type: "filled",
      data: {
        tradeId: trade.id,
        quantityScu: trade.quantityScu,
        printExcluded: verdict.excluded,
        printExclusionReason: verdict.reason,
      },
    });

    await tx
      .update(trades)
      .set({ status: "settled", ownerConfirmedAt, claimerConfirmedAt, closedAt: now })
      .where(eq(trades.id, trade.id));
    await tx.insert(tradeEvents).values({ tradeId: trade.id, actorId: opts.userId, type: "settled", data: { value } });

    // Move the market in the same transaction as the fill. Writing a reference point at
    // `now` (rather than waiting for the next capture) is what puts the trade into the
    // current candle bucket, so the chart moves with the tile instead of half an hour later.
    await refreshCommodityMark(tx, trade.commodityId, now);

    return {
      ok: true as const,
      status: "settled",
      settled: true,
      // A print that was quarantined settled fine but must not trigger a chart/index
      // rebuild or a "price moved" broadcast — nothing about the mark changed.
      priceMoved: !verdict.excluded,
      printExcluded: verdict.excluded,
      printExclusionReason: verdict.reason,
      ownerId: trade.ownerId,
      claimerId: trade.claimerId,
      commodityId: trade.commodityId,
    };
  });
}

/**
 * Release escrows past their deadline: reservations drop and orders return to the board.
 * One transaction — a crash between the status flip and the release would otherwise strand
 * reserved_scu forever, permanently shrinking that order's availability.
 */
export async function expireStaleContracts(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    const stale = await tx
      .update(trades)
      .set({ status: "expired", closedAt: new Date() })
      .where(and(eq(trades.status, "escrow"), sql`${trades.expiresAt} <= now()`))
      .returning({ id: trades.id, orderId: trades.orderId, quantityScu: trades.quantityScu });

    for (const t of stale) {
      await tx
        .update(orders)
        .set({ reservedScu: sql`greatest(0, ${orders.reservedScu} - ${t.quantityScu})`, updatedAt: new Date() })
        .where(eq(orders.id, t.orderId));
    }
    if (stale.length > 0) {
      await tx
        .insert(tradeEvents)
        .values(stale.map((t) => ({ tradeId: t.id, actorId: null, type: "expired" as const, data: {} })));
    }
    return stale.length;
  });
}

/**
 * Resolve orders past their fill-by deadline. They close as `expired_unfilled` and write no
 * print — an order nobody took is not a trade and must not move the market. Orders with a
 * live escrow are left alone; the escrow sweep releases those first.
 */
export async function expireUnfilledOrders(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(orders)
      .set({ status: "expired_unfilled", updatedAt: new Date() })
      .where(
        and(
          sql`${orders.status} IN ('active','paused')`,
          sql`${orders.expiresAt} <= now()`,
          eq(orders.reservedScu, 0),
        ),
      )
      .returning({ id: orders.id });

    if (expired.length > 0) {
      await tx
        .insert(orderEvents)
        .values(expired.map((o) => ({ orderId: o.id, actorId: null, type: "expired_unfilled" as const, data: {} })));
    }
    return expired.length;
  });
}

/**
 * Reconcile orders.reserved_scu against the actual sum of open escrows.
 *
 * reserved_scu is a hand-maintained counter touched by claim, cancel, expiry and settlement;
 * any missed decrement silently removes cargo from the board forever. This runs on the sweep
 * so drift self-heals instead of accumulating.
 */
export async function reconcileReservations(db: Db): Promise<number> {
  const fixed = await db.execute<{ id: string }>(sql`
    UPDATE orders o
    SET reserved_scu = COALESCE(e.total, 0), updated_at = now()
    FROM (
      SELECT o2.id,
             (SELECT sum(t.quantity_scu) FROM trades t WHERE t.order_id = o2.id AND t.status = 'escrow') AS total
      FROM orders o2
    ) e
    WHERE e.id = o.id AND o.reserved_scu IS DISTINCT FROM COALESCE(e.total, 0)
    RETURNING o.id
  `);
  return fixed.rows.length;
}
