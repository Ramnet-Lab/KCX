import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { orders, userHoldings, users } from "../schema/orders";

/**
 * Collateral accounting — KCX lists only what traders actually have.
 *
 * There is no margin, no shorting, and no options. A trader's obligations come from TWO
 * places and both must be counted together, or the same cargo/aUEC can back two promises:
 *
 *   1. Resting orders they posted     → the UNRESERVED remainder (remaining − reserved)
 *   2. Open escrow contracts          → whichever side of the trade they owe
 *
 * The reserved slice of an order is deliberately excluded from (1) because it is already
 * counted as an escrow in (2) — otherwise claiming your own order's quantity double-counts.
 *
 * Obligation matrix for an open escrow:
 *   side='sell' → owner owes CARGO,  claimer owes aUEC
 *   side='buy'  → owner owes aUEC,   claimer owes CARGO
 */

export type SellCapacity = { held: number; committed: number; available: number };
export type BuyCapacity = { balance: number; committed: number; available: number };

/** aUEC this trader has promised elsewhere: unreserved buy orders + escrows they must pay. */
const COMMITTED_AUEC = (userId: string) => sql`(
  SELECT
    coalesce((
      SELECT sum((o.remaining_scu - o.reserved_scu)::bigint * o.price_per_scu)
      FROM orders o
      WHERE o.owner_id = ${userId} AND o.side = 'buy' AND o.status IN ('active','paused')
        AND o.remaining_scu > o.reserved_scu
    ), 0)
    +
    coalesce((
      SELECT sum(t.quantity_scu::bigint * t.price_per_scu)
      FROM trades t
      WHERE t.status = 'escrow'
        AND ((t.claimer_id = ${userId} AND t.side = 'sell')
          OR (t.owner_id   = ${userId} AND t.side = 'buy'))
    ), 0)
)`;

/** SCU of one commodity promised elsewhere: unreserved sell orders + escrows they must ship. */
const COMMITTED_SCU = (userId: string, commodityId: number) => sql`(
  SELECT
    coalesce((
      SELECT sum(o.remaining_scu - o.reserved_scu)
      FROM orders o
      WHERE o.owner_id = ${userId} AND o.commodity_id = ${commodityId}
        AND o.side = 'sell' AND o.status IN ('active','paused')
        AND o.remaining_scu > o.reserved_scu
    ), 0)
    +
    coalesce((
      SELECT sum(t.quantity_scu)
      FROM trades t
      WHERE t.status = 'escrow' AND t.commodity_id = ${commodityId}
        AND ((t.owner_id   = ${userId} AND t.side = 'sell')
          OR (t.claimer_id = ${userId} AND t.side = 'buy'))
    ), 0)
)`;

/** SCU of a commodity this user can still promise (list for sale, or claim a buy order with). */
export async function sellCapacity(db: Db, userId: string, commodityId: number): Promise<SellCapacity> {
  const rows = await db.execute<{ held: string; committed: string }>(sql`
    SELECT
      coalesce((SELECT scu FROM user_holdings WHERE user_id = ${userId} AND commodity_id = ${commodityId}), 0)::text AS held,
      ${COMMITTED_SCU(userId, commodityId)}::text AS committed
  `);
  const held = Number(rows.rows[0]?.held ?? 0);
  const committed = Number(rows.rows[0]?.committed ?? 0);
  return { held, committed, available: Math.max(0, held - committed) };
}

/** aUEC this user can still promise (post a buy order, or claim a sell order). */
export async function buyCapacity(db: Db, userId: string): Promise<BuyCapacity> {
  const rows = await db.execute<{ balance: string; committed: string }>(sql`
    SELECT
      coalesce((SELECT auec_balance FROM users WHERE id = ${userId}), 0)::text AS balance,
      ${COMMITTED_AUEC(userId)}::text AS committed
  `);
  const balance = Number(rows.rows[0]?.balance ?? 0);
  const committed = Number(rows.rows[0]?.committed ?? 0);
  return { balance, committed, available: Math.max(0, balance - committed) };
}

/** Server-side portfolio (holdings + balance) for the signed-in trader. */
export async function getPortfolio(db: Db, userId: string) {
  const [user] = await db.select({ balance: users.auecBalance }).from(users).where(eq(users.id, userId));
  const holdings = await db
    .select({ commodityId: userHoldings.commodityId, scu: userHoldings.scu, avgCost: userHoldings.avgCost })
    .from(userHoldings)
    .where(eq(userHoldings.userId, userId));
  return { auec: user?.balance ?? 0, holdings };
}

/**
 * Replace the trader's declared position. Rejects reductions that would leave open orders
 * OR live escrow contracts uncollateralised — you can't sell cargo out from under a promise
 * you've already made.
 */
export async function savePortfolio(
  db: Db,
  userId: string,
  input: { auec: number; holdings: { commodityId: number; scu: number; avgCost?: number | null }[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const auecRows = await tx.execute<{ committed: string }>(sql`SELECT ${COMMITTED_AUEC(userId)}::text AS committed`);
    const committedAuec = Number(auecRows.rows[0]?.committed ?? 0);
    if (input.auec < committedAuec) {
      return {
        ok: false as const,
        error: `${committedAuec.toLocaleString()} aUEC is committed to open orders and contracts — cancel some before lowering your balance below that.`,
      };
    }

    // Every commodity the trader owes, from orders and escrows alike.
    const committedByCommodity = await tx.execute<{ commodity_id: number; committed: string }>(sql`
      SELECT commodity_id, sum(qty)::text AS committed FROM (
        SELECT o.commodity_id, (o.remaining_scu - o.reserved_scu) AS qty
        FROM orders o
        WHERE o.owner_id = ${userId} AND o.side = 'sell' AND o.status IN ('active','paused')
          AND o.remaining_scu > o.reserved_scu
        UNION ALL
        SELECT t.commodity_id, t.quantity_scu
        FROM trades t
        WHERE t.status = 'escrow'
          AND ((t.owner_id = ${userId} AND t.side = 'sell') OR (t.claimer_id = ${userId} AND t.side = 'buy'))
      ) x GROUP BY commodity_id
    `);
    const wanted = new Map(input.holdings.map((h) => [h.commodityId, h.scu]));
    for (const row of committedByCommodity.rows) {
      const committed = Number(row.committed);
      if ((wanted.get(row.commodity_id) ?? 0) < committed) {
        return {
          ok: false as const,
          error: `${committed.toLocaleString()} SCU of one commodity is committed to open orders or contracts — resolve those before reducing that holding.`,
        };
      }
    }

    await tx.update(users).set({ auecBalance: input.auec }).where(eq(users.id, userId));
    await tx.delete(userHoldings).where(eq(userHoldings.userId, userId));
    const rows = input.holdings.filter((h) => h.scu > 0);
    if (rows.length > 0) {
      await tx.insert(userHoldings).values(
        rows.map((h) => ({ userId, commodityId: h.commodityId, scu: h.scu, avgCost: h.avgCost ?? null })),
      );
    }
    return { ok: true as const };
  });
}

/** Capacity helpers usable INSIDE an open transaction (claim/settle paths). */
export const committedAuecSql = COMMITTED_AUEC;
export const committedScuSql = COMMITTED_SCU;

/** Guard against a trader locking up the board with claims they never intend to honour. */
export const MAX_OPEN_ESCROWS = 10;

export async function openEscrowCount(db: Db, userId: string): Promise<number> {
  const rows = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM trades
    WHERE status = 'escrow' AND (owner_id = ${userId} OR claimer_id = ${userId})
  `);
  return Number(rows.rows[0]?.n ?? 0);
}

/** Legacy alias — some callers still reference the old name. */
export async function orderCommitments(db: Db, userId: string) {
  const [buy] = await Promise.all([buyCapacity(db, userId)]);
  return buy;
}

export { and, eq };
