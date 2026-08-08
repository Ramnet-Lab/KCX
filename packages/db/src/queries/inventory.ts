import { sql } from "drizzle-orm";
import type { Db } from "../client";

/**
 * Inventory, and the only number on it that matters: how many are still free to promise.
 *
 * `held` is what the trader says they own. `committed` is how many of those are already on
 * the board in an active listing. `available` is the difference — the count that should
 * change when a listing goes up and when a sale completes, because those are the two moments
 * a unit stops being yours to sell twice.
 */

export type InventoryRow = {
  itemId: number;
  name: string;
  section: string | null;
  category: string | null;
  held: number;
  /** Units on active listings — promised, not yet gone. */
  committed: number;
  /** held − committed, floored at 0. What the List button is allowed to offer. */
  available: number;
  /** Active listings backing `committed`, so the owner can see where the units went. */
  listingCount: number;
  note: string | null;
  updatedAt: string;
};

/**
 * Statuses that still hold units. A sold_out or cancelled listing has released whatever it
 * was holding, and an expired one puts its remainder back on the shelf.
 *
 * `paused` holds, because a paused listing keeps its remaining quantity and can be resumed in
 * one click — treating those units as free is precisely the double-sale this tab exists to
 * stop. This previously read `('active', 'reserved')`, and no listing has ever had the status
 * `reserved`: it is not in the enum. So the second half matched nothing and paused stock
 * silently counted as available.
 */
const ACTIVE_LISTING = sql`l.status IN ('active', 'paused')`;

export async function listInventory(db: Db, userId: string): Promise<InventoryRow[]> {
  const result = await db.execute<{
    // `bazaar_items.id` is a bigint, which node-postgres hands back as a STRING. Typing it as
    // a number here is what let the raw value reach the client, where it failed every
    // `z.number()` the API guards its input with.
    item_id: string;
    name: string;
    section: string | null;
    category: string | null;
    held: number;
    committed: string;
    listing_count: string;
    note: string | null;
    updated_at: Date | string;
  }>(sql`
    SELECT
      inv.item_id, i.name, i.section, i.category,
      inv.quantity AS held,
      -- Only SELL listings tie up stock. A want-to-buy listing promises money, not goods,
      -- and counting it here would make a buyer's own inventory look spoken for.
      coalesce((
        SELECT sum(l.remaining_quantity) FROM bazaar_listings l
        WHERE l.seller_id = inv.user_id AND l.item_id = inv.item_id
          AND l.intent = 'sell' AND ${ACTIVE_LISTING}
      ), 0)::text AS committed,
      coalesce((
        SELECT count(*) FROM bazaar_listings l
        WHERE l.seller_id = inv.user_id AND l.item_id = inv.item_id
          AND l.intent = 'sell' AND ${ACTIVE_LISTING}
      ), 0)::text AS listing_count,
      inv.note, inv.updated_at
    FROM user_inventory inv
    JOIN bazaar_items i ON i.id = inv.item_id
    WHERE inv.user_id = ${userId}
    ORDER BY i.name
  `);

  return result.rows.map((r) => {
    const held = Number(r.held);
    const committed = Number(r.committed);
    return {
      itemId: Number(r.item_id),
      name: r.name,
      section: r.section,
      category: r.category,
      held,
      committed,
      available: Math.max(0, held - committed),
      listingCount: Number(r.listing_count),
      note: r.note,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  });
}

/**
 * Set an item's count outright.
 *
 * Absolute rather than a delta because this is what a person editing a spreadsheet means:
 * "I have four". A delta API would need the client to know the current value, and two tabs
 * open would then race each other into a wrong total.
 *
 * Refuses to drop below what is already promised on the board — the alternative is a listing
 * offering units the seller has just said they don't have.
 */
export async function setInventory(
  db: Db,
  userId: string,
  input: { itemId: number; quantity: number; note?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const qty = Math.max(0, Math.floor(input.quantity));

  return db.transaction(async (tx) => {
    const committedRows = await tx.execute<{ n: string }>(sql`
      SELECT coalesce(sum(l.remaining_quantity), 0)::text AS n
      FROM bazaar_listings l
      WHERE l.seller_id = ${userId} AND l.item_id = ${input.itemId}
        AND l.intent = 'sell' AND ${ACTIVE_LISTING}
    `);
    const committed = Number(committedRows.rows[0]?.n ?? 0);
    if (qty < committed) {
      return {
        ok: false as const,
        error: `${committed} of these are already promised on active listings. Cancel or reduce a listing before setting the count below ${committed}.`,
      };
    }

    await tx.execute(sql`
      INSERT INTO user_inventory (user_id, item_id, quantity, note, updated_at)
      VALUES (${userId}, ${input.itemId}, ${qty}, ${input.note ?? null}, now())
      ON CONFLICT (user_id, item_id) DO UPDATE
        SET quantity = excluded.quantity,
            note = coalesce(excluded.note, user_inventory.note),
            updated_at = now()
    `);
    return { ok: true as const };
  });
}

/** Remove a line entirely. Blocked while units are still promised, for the same reason. */
export async function removeInventory(
  db: Db,
  userId: string,
  itemId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ n: string }>(sql`
      SELECT coalesce(sum(l.remaining_quantity), 0)::text AS n
      FROM bazaar_listings l
      WHERE l.seller_id = ${userId} AND l.item_id = ${itemId}
        AND l.intent = 'sell' AND ${ACTIVE_LISTING}
    `);
    if (Number(rows.rows[0]?.n ?? 0) > 0) {
      return { ok: false as const, error: "This item is on an active listing — cancel it before removing the line." };
    }
    await tx.execute(sql`DELETE FROM user_inventory WHERE user_id = ${userId} AND item_id = ${itemId}`);
    return { ok: true as const };
  });
}

/**
 * Clear the whole stock list in one go.
 *
 * Lines whose units are promised on a live listing are kept back rather than silently taken
 * with the rest, which is the same rule `removeInventory` applies one line at a time — a wipe
 * is a bulk convenience, not a way around the check that stops a seller offering units they
 * have just declared they don't hold. The count of what stayed is returned so the caller can
 * say so instead of quietly doing less than asked.
 */
export async function wipeInventory(
  db: Db,
  userId: string,
): Promise<{ removed: number; kept: number }> {
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ item_id: string }>(sql`
      DELETE FROM user_inventory inv
      WHERE inv.user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM bazaar_listings l
          WHERE l.seller_id = inv.user_id AND l.item_id = inv.item_id
            AND l.intent = 'sell' AND ${ACTIVE_LISTING}
            AND l.remaining_quantity > 0
        )
      RETURNING inv.item_id::text
    `);
    const [{ n } = { n: "0" }] = (
      await tx.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM user_inventory WHERE user_id = ${userId}
      `)
    ).rows;
    return { removed: result.rows.length, kept: Number(n) };
  });
}

/**
 * Take sold units out of the seller's stock. Called when a sale COMPLETES, not when it is
 * agreed: until both sides confirm, the goods haven't moved and the units are still held —
 * they're just spoken for, which `committed` already expresses.
 *
 * Silent when the seller keeps no inventory line for the item, which is the normal case for
 * anyone who lists without using this tab at all. Clamped at zero because a self-declared
 * count can legitimately be behind reality, and refusing to settle a real trade over a
 * bookkeeping mismatch would be the wrong way round.
 */
export async function consumeInventory(
  tx: Pick<Db, "execute">,
  opts: { userId: string; itemId: number | null; quantity: number },
): Promise<void> {
  if (opts.itemId == null || opts.quantity <= 0) return;
  await tx.execute(sql`
    UPDATE user_inventory
       SET quantity = greatest(0, quantity - ${opts.quantity}), updated_at = now()
     WHERE user_id = ${opts.userId} AND item_id = ${opts.itemId}
  `);
}
