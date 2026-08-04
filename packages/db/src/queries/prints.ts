import { sql } from "drizzle-orm";
import type { Db } from "../client";
import type { PrintExclusion } from "../schema/orders";

/**
 * The public tape.
 *
 * Every print, including the ones withheld from the mark, with the reason attached. A mark
 * that moved for reasons nobody can inspect is just an assertion — this is the page that
 * turns it into a claim someone can check. Excluded prints are shown, not hidden: the
 * quarantine is the interesting part, and a tape that silently omitted them would look
 * pristine precisely when something was being attempted.
 *
 * Handles are shown because RSI handles are public identity here and reputation is the
 * whole trust model; exact balances and counterparty ids are not exposed.
 */
export type TapePrint = {
  id: number;
  commodityId: number;
  side: "buy" | "sell";
  pricePerScu: number;
  quantityScu: number;
  buyerHandle: string | null;
  sellerHandle: string | null;
  excluded: boolean;
  exclusionReason: PrintExclusion | null;
  executedAt: string;
};

export async function commodityTape(db: Db, commodityId: number, limit = 50): Promise<TapePrint[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const result = await db.execute<{
    id: string;
    commodity_id: number;
    side: "buy" | "sell";
    price_per_scu: string;
    quantity_scu: number;
    buyer_handle: string | null;
    seller_handle: string | null;
    excluded: boolean;
    exclusion_reason: PrintExclusion | null;
    executed_at: Date | string;
  }>(sql`
    SELECT
      p.id::text, p.commodity_id, p.side, p.price_per_scu::text, p.quantity_scu,
      b.handle AS buyer_handle, s.handle AS seller_handle,
      p.excluded, p.exclusion_reason, p.executed_at
    FROM trade_prints p
    LEFT JOIN users b ON b.id = p.buyer_id
    LEFT JOIN users s ON s.id = p.seller_id
    WHERE p.commodity_id = ${commodityId}
    ORDER BY p.executed_at DESC, p.id DESC
    LIMIT ${capped}
  `);

  return result.rows.map((r) => ({
    id: Number(r.id),
    commodityId: r.commodity_id,
    side: r.side,
    pricePerScu: Number(r.price_per_scu),
    quantityScu: r.quantity_scu,
    buyerHandle: r.buyer_handle,
    sellerHandle: r.seller_handle,
    excluded: r.excluded,
    exclusionReason: r.exclusion_reason,
    executedAt: new Date(r.executed_at).toISOString(),
  }));
}
