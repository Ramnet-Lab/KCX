import { commodities, getDb, locations, terminals } from "@kcx/db";
import {
  LOCATION_TYPES,
  kindToSector,
  uexCommodity,
  uexLocation,
  uexTerminal,
  type LocationType,
} from "@kcx/shared";
import { audit, claimSlug, fetchUexRows, parseRows, type SlugRegistry } from "../lib/uex";

/** Endpoint order matters: parents before children so parentId can resolve in one pass. */
const LOCATION_ENDPOINTS: Record<LocationType, string> = {
  star_system: "/star_systems",
  planet: "/planets",
  moon: "/moons",
  city: "/cities",
  space_station: "/space_stations",
  outpost: "/outposts",
};

type LocationKey = `${LocationType}:${number}`;

async function syncLocations(): Promise<Map<LocationKey, number>> {
  const db = getDb();
  const idMap = new Map<LocationKey, number>();
  const slugs: SlugRegistry = new Set((await db.select({ slug: locations.slug }).from(locations)).map((r) => r.slug));

  for (const type of LOCATION_TYPES) {
    const startedAt = new Date();
    const raw = await fetchUexRows(LOCATION_ENDPOINTS[type]);
    const rows = parseRows(raw, uexLocation, type);

    for (const row of rows) {
      const parentId =
        (row.id_moon ? idMap.get(`moon:${row.id_moon}`) : undefined) ??
        (row.id_planet ? idMap.get(`planet:${row.id_planet}`) : undefined) ??
        (row.id_star_system && type !== "star_system" ? idMap.get(`star_system:${row.id_star_system}`) : undefined) ??
        null;

      const [saved] = await db
        .insert(locations)
        .values({
          uexId: row.id,
          type,
          name: row.name,
          slug: claimSlug(slugs, row.name, row.id),
          parentId,
          isAvailable: row.is_available,
          raw: row,
        })
        .onConflictDoUpdate({
          target: [locations.type, locations.uexId],
          set: { name: row.name, parentId, isAvailable: row.is_available, raw: row },
        })
        .returning({ id: locations.id });
      idMap.set(`${type}:${row.id}`, saved!.id);
    }
    await audit(LOCATION_ENDPOINTS[type], startedAt, raw.length, rows.length, rows.length === raw.length ? "ok" : "partial");
  }
  return idMap;
}

async function syncTerminals(locationIds: Map<LocationKey, number>): Promise<void> {
  const db = getDb();
  const startedAt = new Date();
  const raw = await fetchUexRows("/terminals");
  const rows = parseRows(raw, uexTerminal, "terminals");
  const slugs: SlugRegistry = new Set((await db.select({ slug: terminals.slug }).from(terminals)).map((r) => r.slug));

  for (const row of rows) {
    const locationId =
      (row.id_outpost ? locationIds.get(`outpost:${row.id_outpost}`) : undefined) ??
      (row.id_space_station ? locationIds.get(`space_station:${row.id_space_station}`) : undefined) ??
      (row.id_city ? locationIds.get(`city:${row.id_city}`) : undefined) ??
      (row.id_moon ? locationIds.get(`moon:${row.id_moon}`) : undefined) ??
      (row.id_planet ? locationIds.get(`planet:${row.id_planet}`) : undefined) ??
      (row.id_star_system ? locationIds.get(`star_system:${row.id_star_system}`) : undefined) ??
      null;

    await db
      .insert(terminals)
      .values({
        uexId: row.id,
        name: row.nickname || row.name,
        slug: claimSlug(slugs, row.nickname || row.name, row.id),
        locationId,
        terminalType: row.type ?? null,
        isAvailable: row.is_available,
        raw: row,
      })
      .onConflictDoUpdate({
        target: terminals.uexId,
        set: {
          name: row.nickname || row.name,
          locationId,
          terminalType: row.type ?? null,
          isAvailable: row.is_available,
          raw: row,
          updatedAt: new Date(),
        },
      });
  }
  await audit("/terminals", startedAt, raw.length, rows.length, rows.length === raw.length ? "ok" : "partial");
}

async function syncCommodities(): Promise<void> {
  const db = getDb();
  const startedAt = new Date();
  const raw = await fetchUexRows("/commodities");
  const rows = parseRows(raw, uexCommodity, "commodities");
  const slugs: SlugRegistry = new Set((await db.select({ slug: commodities.slug }).from(commodities)).map((r) => r.slug));

  for (const row of rows) {
    const values = {
      name: row.name,
      code: row.code,
      kind: row.kind ?? null,
      sector: kindToSector(row.kind),
      weightScu: row.weight_scu != null ? String(row.weight_scu) : null,
      isIllegal: row.is_illegal,
      isRaw: row.is_raw,
      isRefined: row.is_refined,
      isTradable: row.is_available_live || row.is_available,
      raw: row,
    };
    await db
      .insert(commodities)
      .values({
        ...values,
        uexId: row.id,
        uexUuid: row.uuid ?? null,
        slug: claimSlug(slugs, row.slug || row.name, row.id),
      })
      .onConflictDoUpdate({
        target: commodities.uexId,
        set: { ...values, updatedAt: new Date() },
      });
  }
  await audit("/commodities", startedAt, raw.length, rows.length, rows.length === raw.length ? "ok" : "partial");
}

/** Full master-data refresh: locations → terminals → commodities. Idempotent. */
export async function syncMasterData(): Promise<void> {
  const locationIds = await syncLocations();
  await syncTerminals(locationIds);
  await syncCommodities();
  console.log("[sync-master] master data refreshed");
}
