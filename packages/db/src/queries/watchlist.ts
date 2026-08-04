import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { priceAlerts, watchlistEntries } from "../schema/watchlist";

/**
 * Watchlist reads, writes, and the sweep that fires alerts.
 *
 * Everything here compares against SETTLED prices — a commodity's mark or an item's last
 * confirmed sale. A tempting asking price never triggers anything, because nobody paid it.
 */

export type WatchEntryDto = {
  id: number;
  target: string;
  commodityId: number | null;
  itemId: number | null;
  label: string;
  slug: string | null;
  /** Current settled price, or null where nothing has traded yet. */
  price: number | null;
  hasPrice: boolean;
  threshold: number | null;
  direction: string;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  note: string | null;
  href: string;
  createdAt: string;
};

export type PriceAlertDto = {
  id: number;
  label: string;
  price: number;
  threshold: number;
  direction: string;
  href: string;
  read: boolean;
  createdAt: string;
};

/**
 * A trader's watchlist with each entry's current settled price.
 *
 * Commodities read their mark from `commodity_marks_latest`; items read the most recent
 * completed sale. Both are left-joined, so a watched thing that has never traded comes back
 * with a null price rather than disappearing — "nothing has settled yet" is the answer
 * someone watching it most wants.
 */
export async function listWatchlist(db: Db, userId: string): Promise<WatchEntryDto[]> {
  const rows = await db.execute<{
    id: string; target: string; commodity_id: number | null; item_id: string | null;
    label: string; slug: string | null; price: string | null;
    threshold: string | null; direction: string;
    triggered_at: string | Date | null; triggered_price: string | null;
    note: string | null; created_at: string | Date;
  }>(sql`
    SELECT w.id::text, w.target, w.commodity_id, w.item_id::text,
           coalesce(c.name, i.name) AS label,
           c.slug,
           coalesce(m.mark_price, bp.unit_price)::text AS price,
           w.threshold::text, w.direction,
           w.triggered_at, w.triggered_price::text, w.note, w.created_at
    FROM watchlist_entries w
    LEFT JOIN commodities c ON c.id = w.commodity_id
    LEFT JOIN commodity_marks_latest m ON m.commodity_id = w.commodity_id
    LEFT JOIN bazaar_items i ON i.id = w.item_id
    LEFT JOIN LATERAL (
      SELECT sa.unit_price
      FROM bazaar_sales sa
      JOIN bazaar_listings l ON l.id = sa.listing_id
      WHERE l.item_id = w.item_id AND sa.status = 'completed'
      ORDER BY sa.closed_at DESC
      LIMIT 1
    ) bp ON w.item_id IS NOT NULL
    WHERE w.user_id = ${userId}::uuid
    ORDER BY w.created_at DESC
    LIMIT 300
  `);

  return rows.rows.map((r) => {
    const price = r.price != null ? Number(r.price) : null;
    return {
      id: Number(r.id),
      target: r.target,
      commodityId: r.commodity_id,
      itemId: r.item_id != null ? Number(r.item_id) : null,
      label: r.label,
      slug: r.slug,
      price,
      hasPrice: price != null,
      threshold: r.threshold != null ? Number(r.threshold) : null,
      direction: r.direction,
      triggeredAt: r.triggered_at ? new Date(r.triggered_at).toISOString() : null,
      triggeredPrice: r.triggered_price != null ? Number(r.triggered_price) : null,
      note: r.note,
      href: r.commodity_id != null ? `/commodities/${r.slug}` : `/bazaar?item=${r.item_id}`,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

export type WatchResult = { ok: true; id: number } | { ok: false; error: string };

/** Add something to the watchlist, or update the alert already on it. */
export async function upsertWatch(
  db: Db,
  opts: {
    userId: string;
    commodityId?: number | null;
    itemId?: number | null;
    threshold?: number | null;
    direction?: "below" | "above" | "any";
    note?: string | null;
  },
): Promise<WatchResult> {
  const commodityId = opts.commodityId ?? null;
  const itemId = opts.itemId ?? null;
  if ((commodityId == null) === (itemId == null)) {
    return { ok: false, error: "Watch a commodity or an item, not both" };
  }
  if (opts.threshold != null && opts.threshold <= 0) {
    return { ok: false, error: "A price alert needs a positive number" };
  }

  const target = commodityId != null ? "commodity" : "item";
  const values = {
    userId: opts.userId,
    target: target as "commodity" | "item",
    commodityId,
    itemId,
    threshold: opts.threshold ?? null,
    direction: opts.direction ?? "below",
    note: opts.note?.trim().slice(0, 200) || null,
    // Changing the alert re-arms it: the old firing described a rule that no longer exists.
    triggeredAt: null,
    triggeredPrice: null,
  };

  // The uniqueness indexes are PARTIAL (one per target type, each guarded by its column
  // being non-null), and Postgres will only infer a partial index when the conflict target
  // repeats its predicate — without `targetWhere` this fails outright at plan time rather
  // than silently doing the wrong thing.
  const [row] = await db
    .insert(watchlistEntries)
    .values(values)
    .onConflictDoUpdate({
      target:
        commodityId != null
          ? [watchlistEntries.userId, watchlistEntries.commodityId]
          : [watchlistEntries.userId, watchlistEntries.itemId],
      targetWhere:
        commodityId != null
          ? sql`${watchlistEntries.commodityId} IS NOT NULL`
          : sql`${watchlistEntries.itemId} IS NOT NULL`,
      set: {
        threshold: values.threshold,
        direction: values.direction,
        note: values.note,
        triggeredAt: null,
        triggeredPrice: null,
      },
    })
    .returning({ id: watchlistEntries.id });
  return row ? { ok: true, id: row.id } : { ok: false, error: "Could not save that" };
}

export async function removeWatch(db: Db, id: number, userId: string): Promise<boolean> {
  // Alerts already delivered are history and outlive the rule that produced them, so the
  // rows are detached rather than deleted with the entry.
  await db.delete(priceAlerts).where(and(eq(priceAlerts.watchlistId, id), eq(priceAlerts.userId, userId)));
  const removed = await db
    .delete(watchlistEntries)
    .where(and(eq(watchlistEntries.id, id), eq(watchlistEntries.userId, userId)))
    .returning({ id: watchlistEntries.id });
  return removed.length > 0;
}

/**
 * Evaluate every armed alert and fire the ones whose condition has become true.
 *
 * Two halves, one per target type, because the price comes from a different place: a
 * commodity's mark lives in `commodity_marks_latest`, and an item's is its last completed
 * sale. Both only ever reflect settled trades.
 *
 * An entry that has already fired does NOT fire again until the price crosses back — the
 * `triggered_at IS NULL` guard here, and the re-arm pass below. Without it a "below 35M"
 * alert re-fires on every settlement for as long as the price stays under, which is the
 * fastest way to teach someone to ignore alerts entirely.
 */
export async function runPriceAlerts(db: Db): Promise<number> {
  const CROSSED = (price: string) => sql`
    (w.direction = 'below' AND ${sql.raw(price)} <= w.threshold)
    OR (w.direction = 'above' AND ${sql.raw(price)} >= w.threshold)
    OR (w.direction = 'any' AND ${sql.raw(price)} <> w.threshold)
  `;

  const fired = await db.execute<{ id: string }>(sql`
    WITH prices AS (
      SELECT w.id,
             w.user_id,
             w.threshold,
             w.direction,
             coalesce(c.name, i.name) AS label,
             CASE WHEN w.commodity_id IS NOT NULL
                  THEN '/commodities/' || c.slug
                  ELSE '/bazaar?item=' || w.item_id::text END AS href,
             coalesce(m.mark_price, bp.unit_price) AS price
      FROM watchlist_entries w
      LEFT JOIN commodities c ON c.id = w.commodity_id
      LEFT JOIN commodity_marks_latest m ON m.commodity_id = w.commodity_id
      LEFT JOIN bazaar_items i ON i.id = w.item_id
      LEFT JOIN LATERAL (
        SELECT sa.unit_price
        FROM bazaar_sales sa
        JOIN bazaar_listings l ON l.id = sa.listing_id
        WHERE l.item_id = w.item_id AND sa.status = 'completed'
        ORDER BY sa.closed_at DESC
        LIMIT 1
      ) bp ON w.item_id IS NOT NULL
      WHERE w.threshold IS NOT NULL AND w.triggered_at IS NULL
    ),
    hits AS (
      SELECT * FROM prices w
      WHERE price IS NOT NULL AND (${CROSSED("price")})
    ),
    logged AS (
      INSERT INTO price_alerts (watchlist_id, user_id, label, price, threshold, direction, href)
      SELECT id, user_id, label, price, threshold, direction, href FROM hits
      RETURNING watchlist_id
    )
    UPDATE watchlist_entries w
    SET triggered_at = now(), triggered_price = h.price
    FROM hits h
    WHERE w.id = h.id
    RETURNING w.id::text
  `);

  // Re-arm anything whose price has crossed back, so the alert works next time too.
  await db.execute(sql`
    WITH prices AS (
      SELECT w.id, w.threshold, w.direction,
             coalesce(m.mark_price, bp.unit_price) AS price
      FROM watchlist_entries w
      LEFT JOIN commodity_marks_latest m ON m.commodity_id = w.commodity_id
      LEFT JOIN LATERAL (
        SELECT sa.unit_price
        FROM bazaar_sales sa
        JOIN bazaar_listings l ON l.id = sa.listing_id
        WHERE l.item_id = w.item_id AND sa.status = 'completed'
        ORDER BY sa.closed_at DESC
        LIMIT 1
      ) bp ON w.item_id IS NOT NULL
      WHERE w.threshold IS NOT NULL AND w.triggered_at IS NOT NULL
    )
    UPDATE watchlist_entries w
    SET triggered_at = NULL, triggered_price = NULL
    FROM prices p
    WHERE w.id = p.id AND p.price IS NOT NULL AND NOT (${CROSSED("p.price")})
  `);

  return fired.rows.length;
}

/** A trader's alert feed, newest first. */
export async function listPriceAlerts(db: Db, userId: string, limit = 50): Promise<PriceAlertDto[]> {
  const rows = await db
    .select()
    .from(priceAlerts)
    .where(eq(priceAlerts.userId, userId))
    .orderBy(desc(priceAlerts.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    price: r.price,
    threshold: r.threshold,
    direction: r.direction,
    href: r.href,
    read: r.read,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function unreadAlertCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(priceAlerts)
    .where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.read, false)));
  return row?.n ?? 0;
}

export async function markAlertsRead(db: Db, userId: string): Promise<void> {
  await db.update(priceAlerts).set({ read: true }).where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.read, false)));
}
