import { sql } from "drizzle-orm";
import type { Db } from "../client";

/**
 * Trader standing has two halves, and both are shown together on purpose.
 *
 *  • Completion record (objective) — contracts settled ÷ contracts entered, straight from
 *    the trades table. Nobody awards it; it is simply what happened.
 *  • Star rating (subjective) — 1–5 from counterparties after a settled contract.
 *
 * Either alone is misleading: a trader can be pleasant and unreliable, or gruff and
 * completely dependable. `bailed` is broken out separately because walking away from a
 * contract you claimed is materially worse than one that quietly timed out on both sides.
 */
export type TraderRating = {
  /** Contracts that reached settlement. */
  settled: number;
  /** Contracts that reached any conclusion — settled, cancelled or expired. */
  entered: number;
  /** settled ÷ entered as a percentage; null until they have finished one. */
  completionPct: number | null;
  /** Contracts this trader personally cancelled. */
  bailed: number;
  /** Mean stars 1–5, null until rated. */
  stars: number | null;
  ratingCount: number;
};

export const EMPTY_RATING: TraderRating = {
  settled: 0,
  entered: 0,
  completionPct: null,
  bailed: 0,
  stars: null,
  ratingCount: 0,
};

/** SQL fragment producing one rating row per user id. Shared by the board and profiles. */
const RATING_SQL = (ids: string[]) => sql`
  SELECT
    u.id::text AS user_id,
    coalesce(t.settled, 0)::int  AS settled,
    coalesce(t.entered, 0)::int  AS entered,
    coalesce(t.bailed, 0)::int   AS bailed,
    r.avg_stars::text            AS avg_stars,
    coalesce(r.rating_count, 0)::int AS rating_count
  FROM users u
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE tr.status = 'settled')                      AS settled,
      count(*) FILTER (WHERE tr.status IN ('settled','cancelled','expired')) AS entered,
      count(*) FILTER (WHERE tr.status = 'cancelled' AND tr.cancelled_by_id = u.id) AS bailed
    FROM trades tr
    WHERE tr.owner_id = u.id OR tr.claimer_id = u.id
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT avg(stars)::numeric(3,2) AS avg_stars, count(*) AS rating_count
    FROM trade_ratings WHERE rated_id = u.id
  ) r ON true
  WHERE u.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
`;

type Row = {
  user_id: string;
  settled: number;
  entered: number;
  bailed: number;
  avg_stars: string | null;
  rating_count: number;
};

const toRating = (r: Row): TraderRating => ({
  settled: r.settled,
  entered: r.entered,
  completionPct: r.entered > 0 ? Math.round((r.settled / r.entered) * 100) : null,
  bailed: r.bailed,
  stars: r.avg_stars != null ? Number(r.avg_stars) : null,
  ratingCount: r.rating_count,
});

/** Ratings for many traders at once — one query for a whole board page. */
export async function ratingsFor(db: Db, userIds: string[]): Promise<Map<string, TraderRating>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const res = await db.execute<Row>(RATING_SQL(unique));
  return new Map(res.rows.map((r) => [r.user_id, toRating(r)]));
}

export async function ratingFor(db: Db, userId: string): Promise<TraderRating> {
  return (await ratingsFor(db, [userId])).get(userId) ?? EMPTY_RATING;
}

/** Settled contracts the viewer may still rate, with who they'd be rating. */
export async function pendingRatings(
  db: Db,
  userId: string,
): Promise<{ tradeId: string; counterpartyId: string; counterpartyName: string; commodityName: string }[]> {
  const res = await db.execute<{
    trade_id: string;
    counterparty_id: string;
    counterparty_name: string;
    commodity_name: string;
  }>(sql`
    SELECT t.id::text AS trade_id,
           other.id::text AS counterparty_id,
           other.display_name AS counterparty_name,
           c.name AS commodity_name
    FROM trades t
    JOIN users other
      ON other.id = CASE WHEN t.owner_id = ${userId}::uuid THEN t.claimer_id ELSE t.owner_id END
    JOIN commodities c ON c.id = t.commodity_id
    WHERE t.status = 'settled'
      AND (t.owner_id = ${userId}::uuid OR t.claimer_id = ${userId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM trade_ratings tr
        WHERE tr.trade_id = t.id AND tr.rater_id = ${userId}::uuid
      )
    ORDER BY t.closed_at DESC
    LIMIT 20
  `);
  return res.rows.map((r) => ({
    tradeId: r.trade_id,
    counterpartyId: r.counterparty_id,
    counterpartyName: r.counterparty_name,
    commodityName: r.commodity_name,
  }));
}
