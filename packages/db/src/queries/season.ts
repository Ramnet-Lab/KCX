import { sql } from "drizzle-orm";
import type { Db } from "../client";

/**
 * Season rollover.
 *
 * Every Star Citizen patch destroys commodity cargo — even the ones announced as "no wipe".
 * A board that survives a patch is therefore advertising cargo that no longer exists, and
 * escrow contracts that survive it are obligations neither side can now honour. The old
 * behaviour was to detect the new version, flip a row in `game_versions`, and change nothing
 * else: `expired_season` existed as an order status that no code path ever set.
 *
 * Deliberately NOT touched:
 *   - Settled trades and prints. They are history; the price was real when it printed.
 *   - Disputed trades. A dispute outlives the patch that interrupted it.
 *   - Reputation and ratings. They are keyed to the RSI handle and survive every wipe.
 */

export type RolloverResult = {
  ordersExpired: number;
  reservationsReleased: number;
  tradesExpired: number;
  contractsExpired: number;
  bidsWithdrawn: number;
};

/**
 * Expire everything that referenced the previous season's cargo, in one transaction.
 *
 * All-or-nothing on purpose: a crash between expiring an order and releasing its reservation
 * would strand `reserved_scu` forever, permanently shrinking that order's availability with
 * no order left to explain it.
 */
export async function rolloverSeason(db: Db, opts: { newSeasonId: number; actorId?: string | null }): Promise<RolloverResult> {
  return db.transaction(async (tx) => {
    // Escrow contracts first: releasing them returns reserved quantity to the orders, so the
    // order sweep below sees a consistent picture rather than racing its own inputs.
    // 'expired', not 'expired_season': TRADE_STATUSES has no season variant, and the reason
    // lives in the event payload rather than being smuggled into the status enum.
    const trades = await tx.execute<{ id: string; order_id: string; quantity_scu: number }>(sql`
      UPDATE trades
         SET status = 'expired', closed_at = now()
       WHERE status = 'escrow'
      RETURNING id, order_id, quantity_scu
    `);
    for (const t of trades.rows) {
      await tx.execute(sql`
        UPDATE orders
           SET reserved_scu = greatest(0, reserved_scu - ${t.quantity_scu}), updated_at = now()
         WHERE id = ${t.order_id}
      `);
      await tx.execute(sql`
        INSERT INTO trade_events (trade_id, actor_id, type, data)
        VALUES (${t.id}, ${opts.actorId ?? null}, 'expired', ${JSON.stringify({ reason: "season_rollover" })}::jsonb)
      `);
    }

    // Any order that could still be acted on. Terminal states are left exactly as they are —
    // a filled order is a historical fact, not something a patch revises.
    const orders = await tx.execute<{ id: string }>(sql`
      UPDATE orders
         SET status = 'expired_season', updated_at = now()
       WHERE status IN ('active', 'paused')
      RETURNING id
    `);
    for (const o of orders.rows) {
      await tx.execute(sql`
        INSERT INTO order_events (order_id, actor_id, type, data)
        VALUES (${o.id}, ${opts.actorId ?? null}, 'expired_season',
                ${JSON.stringify({ seasonId: opts.newSeasonId })}::jsonb)
      `);
    }

    // Service contracts that involve moving goods are void for the same reason. Contracts
    // already being worked (in_progress) are left alone: the executor may be mid-delivery and
    // cancelling underneath them would cost them a completion they earned.
    const contracts = await tx.execute<{ id: string }>(sql`
      UPDATE service_contracts
         SET status = 'expired', updated_at = now()
       WHERE status IN ('open', 'bidding', 'awarded')
      RETURNING id
    `);
    for (const c of contracts.rows) {
      await tx.execute(sql`
        INSERT INTO contract_events (contract_id, actor_id, type, data)
        VALUES (${c.id}, ${opts.actorId ?? null}, 'expired', ${JSON.stringify({ reason: "season_rollover" })}::jsonb)
      `);
    }

    // Open bids on those contracts are meaningless now; withdrawing them releases the
    // bidders' committed collateral.
    const bids = await tx.execute<{ n: string }>(sql`
      WITH gone AS (
        DELETE FROM contract_bids b
        USING service_contracts sc
        WHERE b.contract_id = sc.id AND sc.status = 'expired'
        RETURNING b.id
      )
      SELECT count(*)::text AS n FROM gone
    `);

    return {
      ordersExpired: orders.rows.length,
      reservationsReleased: trades.rows.length,
      tradesExpired: trades.rows.length,
      contractsExpired: contracts.rows.length,
      bidsWithdrawn: Number(bids.rows[0]?.n ?? 0),
    };
  });
}
