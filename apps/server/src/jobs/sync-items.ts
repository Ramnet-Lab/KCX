import { bazaarItems, getDb } from "@kcx/db";
import { ITEM_NAME_MAX, itemNameKey } from "@kcx/shared";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, fetchUexRows, parseRows } from "../lib/uex";

/**
 * Seed and refresh the bazaar item catalogue from UEX.
 *
 * Two walks, because UEX splits them:
 *
 *  • `/items` refuses a bare call — it needs `id_category`, `id_company` or `uuid` — so this
 *    reads `/categories`, keeps the ~66 of type `item`, and asks for each. That's ~7,700
 *    items across armour, clothing, personal and vehicle weapons, components, liveries.
 *  • `/vehicles` returns the ~280 ships and ground vehicles in one call, under their full
 *    names ("Origin 100i") rather than the bare model, since that is how someone selling one
 *    would look for it.
 *
 * Player-contributed entries are ADOPTED, never duplicated: when a seller has already typed
 * in a name that UEX later publishes, the existing row is upgraded in place. The alternative
 * — a second row with the canonical spelling — would split the item's price history at the
 * exact moment the catalogue got better at describing it.
 */

const itemRow = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  uuid: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  game_version: z.string().nullable().optional(),
});

const vehicleRow = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  name_full: z.string().nullable().optional(),
  uuid: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
});

const categoryRow = z.object({
  id: z.number().int(),
  type: z.string(),
  section: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});

type Incoming = {
  source: "uex_item" | "uex_vehicle";
  sourceId: number;
  uuid: string | null;
  name: string;
  nameKey: string;
  section: string | null;
  category: string | null;
  companyName: string | null;
  slug: string | null;
  gameVersion: string | null;
};

/** Pull every item UEX will hand over, one category at a time. */
async function fetchItems(): Promise<{ rows: Incoming[]; failures: number }> {
  const cats = parseRows(await fetchUexRows("/categories"), categoryRow, "categories").filter(
    (c) => c.type === "item",
  );
  const out: Incoming[] = [];
  let failures = 0;

  for (const cat of cats) {
    let rows: unknown[];
    try {
      // allowEmpty: a good ten of these categories legitimately hold nothing, and calling
      // that a failure every night would bury the one that is actually broken.
      rows = await fetchUexRows(`/items?id_category=${cat.id}`, { allowEmpty: true });
    } catch (err) {
      // One bad category must not cost us the other 65. The catalogue is additive, so a
      // missed category simply isn't refreshed this run.
      failures += 1;
      console.warn(`  ! items category ${cat.id} (${cat.section}/${cat.name}) failed:`,
        err instanceof Error ? err.message : err);
      continue;
    }
    for (const item of parseRows(rows, itemRow, `items:${cat.id}`)) {
      const name = item.name.trim().slice(0, ITEM_NAME_MAX);
      const nameKey = itemNameKey(name);
      if (!nameKey) continue;
      out.push({
        source: "uex_item",
        sourceId: item.id,
        uuid: item.uuid ?? null,
        name,
        nameKey,
        section: item.section ?? cat.section ?? null,
        category: item.category ?? cat.name ?? null,
        companyName: item.company_name ?? null,
        slug: item.slug ?? null,
        gameVersion: item.game_version ?? null,
      });
    }
  }
  return { rows: out, failures };
}

async function fetchVehicles(): Promise<Incoming[]> {
  const rows = parseRows(await fetchUexRows("/vehicles"), vehicleRow, "vehicles");
  const out: Incoming[] = [];
  for (const v of rows) {
    // Prefer the full name: somebody selling one thinks "Origin 100i", not "100i", and the
    // bare model name collides across manufacturers.
    const name = (v.name_full?.trim() || v.name.trim()).slice(0, ITEM_NAME_MAX);
    const nameKey = itemNameKey(name);
    if (!nameKey) continue;
    out.push({
      source: "uex_vehicle",
      sourceId: v.id,
      uuid: v.uuid ?? null,
      name,
      nameKey,
      section: "Vehicles",
      category: "Ships & vehicles",
      companyName: v.company_name ?? null,
      slug: v.slug ?? null,
      gameVersion: null,
    });
  }
  return out;
}

export async function syncItemCatalogue(): Promise<void> {
  const startedAt = new Date();
  const db = getDb();
  let incoming: Incoming[] = [];
  let failures = 0;

  try {
    const [items, vehicles] = await Promise.all([fetchItems(), fetchVehicles()]);
    incoming = [...items.rows, ...vehicles];
    failures = items.failures;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-items] fetch failed:", message);
    await audit("/items", startedAt, 0, 0, "error", message);
    return;
  }

  // The whole catalogue is a few thousand rows, so reconciling in memory costs one query
  // instead of three per item and makes the collision cases below decidable rather than
  // discovered as constraint violations.
  const existing = await db
    .select({
      id: bazaarItems.id,
      source: bazaarItems.source,
      sourceId: bazaarItems.sourceId,
      name: bazaarItems.name,
      nameKey: bazaarItems.nameKey,
    })
    .from(bazaarItems);

  const byKey = new Map(existing.map((r) => [r.nameKey, r]));
  const bySource = new Map(
    existing.filter((r) => r.sourceId != null).map((r) => [`${r.source}:${r.sourceId}`, r]),
  );

  const toInsert: Incoming[] = [];
  const toUpdate: { id: number; row: Incoming }[] = [];
  const seenKeys = new Set<string>();
  let collisions = 0;

  for (const row of incoming) {
    // Two distinct UEX items can carry the same name (there are a handful). The first wins
    // the key; recording the second under a mangled name would be worse than not having it,
    // because a seller would pick one at random and split the price history.
    if (seenKeys.has(row.nameKey)) {
      collisions += 1;
      continue;
    }
    seenKeys.add(row.nameKey);

    const keyed = byKey.get(row.nameKey);
    const sourced = bySource.get(`${row.source}:${row.sourceId}`);

    if (keyed && sourced && keyed.id !== sourced.id) {
      // A rename landed on a name some other row already holds. Update the row that owns
      // the name and release the stale row's source pointer, so the (source, source_id)
      // slot is free rather than held by a row nobody will ever match again.
      toUpdate.push({ id: keyed.id, row });
      await db
        .update(bazaarItems)
        .set({ sourceId: null, updatedAt: new Date() })
        .where(eq(bazaarItems.id, sourced.id));
      continue;
    }

    const target = sourced ?? keyed;
    if (!target) {
      toInsert.push(row);
      continue;
    }
    // Adoption: a player-typed entry becomes the canonical one, keeping its id so every
    // listing and sale already pointing at it keeps its history.
    toUpdate.push({ id: target.id, row });
  }

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    await db
      .insert(bazaarItems)
      .values(chunk.map((r) => ({ ...r, createdById: null })))
      // Belt and braces against a concurrent writer claiming the key between the read above
      // and this insert — a seller typing a new name mid-sync.
      .onConflictDoNothing({ target: bazaarItems.nameKey });
    written += chunk.length;
  }

  for (const { id, row } of toUpdate) {
    await db
      .update(bazaarItems)
      .set({
        source: row.source,
        sourceId: row.sourceId,
        uuid: row.uuid,
        name: row.name,
        nameKey: row.nameKey,
        section: row.section,
        category: row.category,
        companyName: row.companyName,
        slug: row.slug,
        gameVersion: row.gameVersion,
        updatedAt: new Date(),
      })
      .where(eq(bazaarItems.id, id));
  }

  console.log(
    `[sync-items] ${incoming.length} fetched → ${written} new, ${toUpdate.length} refreshed` +
      (collisions > 0 ? `, ${collisions} duplicate name(s) skipped` : "") +
      (failures > 0 ? `, ${failures} category(ies) unreachable` : ""),
  );
  // A run that lost categories is recorded as partial, not ok: the catalogue is still
  // usable, but "we fetched everything" would be a lie the audit table then repeats.
  await audit("/items", startedAt, incoming.length, written + toUpdate.length, failures > 0 ? "partial" : "ok");
}

/**
 * Recount how many listings each catalogue entry has, which is what orders the picker.
 *
 * Recomputed rather than incremented on every listing: a counter maintained by hand drifts
 * the first time a write path forgets it, and there is no way to notice from the outside
 * that the ranking has quietly gone wrong.
 */
export async function recountItemListings(): Promise<number> {
  const res = await getDb().execute<{ id: string }>(sql`
    UPDATE bazaar_items i
    SET listing_count = t.n
    FROM (
      SELECT i2.id, coalesce(c.n, 0) AS n
      FROM bazaar_items i2
      LEFT JOIN (
        SELECT item_id, count(*)::int AS n
        FROM bazaar_listings WHERE item_id IS NOT NULL
        GROUP BY item_id
      ) c ON c.item_id = i2.id
    ) t
    WHERE i.id = t.id AND i.listing_count IS DISTINCT FROM t.n
    RETURNING i.id::text
  `);
  return res.rows.length;
}

/**
 * Drop player-typed entries nobody ever listed against, so the picker doesn't rot with
 * typos somebody abandoned mid-form.
 *
 * Tested against the listings themselves rather than the cached `listing_count`: that
 * counter is only as fresh as the last recount, and deleting a row a listing points at
 * would hit the foreign key and abort the whole prune.
 */
export async function pruneUnusedPlayerItems(): Promise<number> {
  const removed = await getDb()
    .delete(bazaarItems)
    .where(
      and(
        eq(bazaarItems.source, "player"),
        sql`NOT EXISTS (SELECT 1 FROM bazaar_listings l WHERE l.item_id = ${bazaarItems.id})`,
        // Only entries that have sat unused for a while: a brand-new one may have a listing
        // being written against it right now.
        sql`${bazaarItems.createdAt} < now() - interval '30 days'`,
      ),
    )
    .returning({ id: bazaarItems.id });
  return removed.length;
}
