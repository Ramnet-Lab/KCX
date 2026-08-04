import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { orders, userHoldings, users } from "../schema/orders";

/**
 * Collateral accounting — KCX lists only what traders actually have.
 *
 * There is no margin, no shorting, and no options. A trader's obligations come from FIVE
 * places and all must be counted together, or the same cargo/aUEC can back two promises:
 *
 *   1. Resting orders they posted     → the UNRESERVED remainder (remaining − reserved)
 *   2. Open escrow contracts          → whichever side of the trade they owe
 *   3. Service contracts they issued  → the payout they owe on completion (aUEC only),
 *                                       or the ceiling while a reverse auction is running
 *   4. Standing high bids at auction  → the bid, for as long as it is the leading one
 *   5. Agreed bazaar purchases        → the sale total, until it settles or falls through
 *
 * (3) lives here rather than at the call site on purpose: when it was summed by one caller,
 * every other consumer — the portfolio panel, order placement, balance edits — silently
 * undercounted, and the same aUEC could back both a contract payout and a buy order. (4)
 * and (5) join it for the same reason: a bid the bidder cannot cover is not a bid.
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

/**
 * aUEC this trader has promised elsewhere: unreserved buy orders + escrows they must pay
 * + payouts on service contracts they issued.
 */
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
    +
    coalesce((
      -- While a reverse auction is open the issuer is on the hook for the CEILING, since
      -- any bid up to it could win. Once awarded, only the winning bid is committed and
      -- the difference frees up immediately.
      SELECT sum(coalesce(sc.awarded_amount, sc.payout))
      FROM service_contracts sc
      WHERE sc.issuer_id = ${userId}
        AND sc.status IN ('open','bidding','awarded','in_progress')
    ), 0)
    +
    coalesce((
      -- Only the STANDING high bid is committed. The moment someone is outbid their row
      -- becomes 'outbid' and their aUEC is free again, which is what makes it possible to
      -- chase several auctions at once without pretending to have the money twice.
      SELECT sum(bb.amount)
      FROM bazaar_bids bb
      WHERE bb.bidder_id = ${userId} AND bb.status = 'active'
    ), 0)
    +
    coalesce((
      -- Agreed but not yet settled: the buyer owes this until they meet up, or until the
      -- sale falls through and the units go back on the board.
      SELECT sum(bs.total_price)
      FROM bazaar_sales bs
      WHERE bs.buyer_id = ${userId} AND bs.status = 'pending'
    ), 0)
    +
    coalesce((
      -- Standing wanted ads. This is what separates "I'll pay 40M for a Polaris" from a
      -- wish: the money is committed for as long as the ad is up, on the units still
      -- wanted rather than the original count.
      SELECT sum(bl.remaining_quantity::bigint * bl.buy_now_price)
      FROM bazaar_listings bl
      WHERE bl.seller_id = ${userId} AND bl.intent = 'buy'
        AND bl.status IN ('active','paused') AND bl.buy_now_price IS NOT NULL
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
        error: `${committedAuec.toLocaleString()} aUEC is committed to open orders, contracts and bazaar bids — clear some before lowering your balance below that.`,
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
