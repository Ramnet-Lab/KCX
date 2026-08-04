import { sql } from "drizzle-orm";
import type { Db } from "../client";
import type { OrderSide } from "@kcx/shared";
import type { PrintExclusion } from "../schema/orders";
import { MARK_WINDOW_HOURS } from "./mark";

/**
 * What a print has to survive before it is allowed to move the market.
 *
 * The premise this whole module exists for: KCX never holds aUEC or cargo, so balances and
 * holdings are self-declared. The settlement "can they afford it" check compares against a
 * number the user typed. That makes the tape the only place manipulation can be caught, and
 * a price band alone does not catch it — two accounts can sit inside any band all day.
 *
 * So the checks below are mostly about WHO traded rather than at what price. Nothing here
 * deletes a print: an excluded print stays on the public tape with its reason attached.
 * Silently dropping the inconvenient trades would leave the tape looking clean and the
 * manipulation invisible, which is the opposite of the point.
 */

/** Price band around the reference, outside which a print is quarantined from the mark. */
export const OUTLIER_LOW = 0.25;
export const OUTLIER_HIGH = 3.0;

/**
 * Qualifying prints allowed between the same two accounts for the same commodity, per
 * rolling week. Beyond this they still settle and still show on the tape — they just stop
 * counting toward the price. Repeated trade between two people is normal; repeated trade
 * between two people being what SETS a public price is not.
 */
export const PAIR_PRINT_LIMIT = 3;
export const PAIR_WINDOW_DAYS = 7;

/**
 * Ceiling on one account's share of a commodity's window volume.
 *
 * Gated on distinct PAIRS, not on print count, and the distinction matters. Gating on
 * prints meant three trades between one pair armed the cap, so the very next trade — with a
 * brand-new counterparty — was refused for concentration. That punished the first honest
 * trader in a commodity, who is necessarily most of its early volume, and it double-counted
 * a situation the pair rate limit already covers.
 *
 * The two rules now govern different things: the pair limit polices a single relationship,
 * the share cap polices concentration ACROSS relationships, and it only has an opinion once
 * there are enough relationships for "share" to mean anything.
 */
export const MAX_ACCOUNT_VOLUME_SHARE = 0.7;
export const SHARE_CAP_MIN_PAIRS = 3;

export type PrintCandidate = {
  commodityId: number;
  side: OrderSide;
  pricePerScu: number;
  quantityScu: number;
  buyerId: string;
  sellerId: string;
};

export type IntegrityVerdict = {
  excluded: boolean;
  reason: PrintExclusion | null;
  /** Human-readable, surfaced on the tape and in the mod queue. */
  detail: string | null;
};

const OK: IntegrityVerdict = { excluded: false, reason: null, detail: null };

/**
 * Evaluate a candidate print. Runs INSIDE the settlement transaction, before the insert,
 * so the verdict is stored on the row itself and never has to be recomputed to be trusted.
 */
export async function judgePrint(tx: Pick<Db, "execute">, c: PrintCandidate): Promise<IntegrityVerdict> {
  // --- Both parties RSI-verified -------------------------------------------------------
  // Posting is already gated on verification, but a role change or a later handle dispute
  // can leave an unverified account party to a live escrow. An unverified account is free
  // to create, which makes it the cheapest possible input to a fake price.
  const parties = await tx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM users
    WHERE id IN (${c.buyerId}, ${c.sellerId}) AND rsi_verified_at IS NOT NULL
  `);
  if (Number(parties.rows[0]?.n ?? 0) < 2) {
    return { excluded: true, reason: "unverified", detail: "A party was not RSI-verified at settlement" };
  }

  // --- Price band -----------------------------------------------------------------------
  // Compared against the SAME side only. The previous version fell back through best_sell →
  // best_buy → mark when the side-specific reference was null, so a buy print could be
  // validated against a sell reference. For the raw ores that terminals only ever buy —
  // exactly the commodities with no sell reference, and exactly the ones most exposed to a
  // wash print — that fallback made the band meaningless. No reference now means no price
  // check, and the pair and share rules carry it instead.
  const ref = await tx.execute<{ reference: string | null }>(sql`
    SELECT CASE WHEN ${c.side} = 'buy' THEN coalesce(mark_price, best_buy) ELSE coalesce(mark_price, best_sell) END::text
             AS reference
    FROM commodity_marks_latest WHERE commodity_id = ${c.commodityId}
  `);
  const reference = Number(ref.rows[0]?.reference ?? 0);
  if (reference > 0) {
    const ratio = c.pricePerScu / reference;
    if (ratio < OUTLIER_LOW || ratio > OUTLIER_HIGH) {
      return {
        excluded: true,
        reason: "outlier",
        detail: `${ratio.toFixed(2)}× the ${c.side === "buy" ? "buy" : "sell"} reference of ${Math.round(reference).toLocaleString()}`,
      };
    }
  }

  // --- Pair rate limit ------------------------------------------------------------------
  const pair = await tx.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM trade_prints
    WHERE NOT excluded
      AND commodity_id = ${c.commodityId}
      AND executed_at >= now() - make_interval(days => ${PAIR_WINDOW_DAYS})
      AND least(buyer_id, seller_id)    = least(${c.buyerId}::uuid, ${c.sellerId}::uuid)
      AND greatest(buyer_id, seller_id) = greatest(${c.buyerId}::uuid, ${c.sellerId}::uuid)
  `);
  const pairPrints = Number(pair.rows[0]?.n ?? 0);
  if (pairPrints >= PAIR_PRINT_LIMIT) {
    return {
      excluded: true,
      reason: "pair_rate_limit",
      detail: `${pairPrints} prints already between these two accounts in ${PAIR_WINDOW_DAYS} days`,
    };
  }

  // --- Single-account concentration -----------------------------------------------------
  // Volume attributable to either party in the mark window, including this candidate. A
  // trader who is most of a commodity's volume IS that commodity's price, which is the
  // position a manipulator is trying to buy.
  const share = await tx.execute<{ total: string; buyer: string; seller: string; pairs: string }>(sql`
    SELECT
      coalesce(sum(quantity_scu), 0)::text                                              AS total,
      coalesce(sum(quantity_scu) FILTER (WHERE buyer_id = ${c.buyerId}
                                            OR seller_id = ${c.buyerId}), 0)::text      AS buyer,
      coalesce(sum(quantity_scu) FILTER (WHERE buyer_id = ${c.sellerId}
                                            OR seller_id = ${c.sellerId}), 0)::text     AS seller,
      count(DISTINCT (least(buyer_id, seller_id), greatest(buyer_id, seller_id)))
        FILTER (WHERE buyer_id IS NOT NULL AND seller_id IS NOT NULL)::text              AS pairs
    FROM trade_prints
    WHERE NOT excluded
      AND commodity_id = ${c.commodityId}
      AND executed_at >= now() - make_interval(hours => ${MARK_WINDOW_HOURS})
  `);
  const row = share.rows[0];
  const priorPairs = Number(row?.pairs ?? 0);
  if (priorPairs >= SHARE_CAP_MIN_PAIRS) {
    const total = Number(row?.total ?? 0) + c.quantityScu;
    const worst = Math.max(Number(row?.buyer ?? 0), Number(row?.seller ?? 0)) + c.quantityScu;
    const ratio = total > 0 ? worst / total : 0;
    if (ratio > MAX_ACCOUNT_VOLUME_SHARE) {
      return {
        excluded: true,
        reason: "share_cap",
        detail: `one account would be ${Math.round(ratio * 100)}% of ${MARK_WINDOW_HOURS}h volume`,
      };
    }
  }

  return OK;
}
