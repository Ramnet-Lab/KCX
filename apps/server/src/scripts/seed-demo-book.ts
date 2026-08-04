/**
 * DEV ONLY: seed a plausible multi-trader order book so board navigation, filtering and
 * price-override behaviour can be exercised at realistic scale. Never run against prod.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

import { closeDb, commodities, gameVersions, getDb, orders, userHoldings, users } from "@kcx/db";
import { eq, sql } from "drizzle-orm";

const HANDLES = ["ramnet", "voidhauler", "cargocartel", "pyrorunner", "stantonfreight", "orebaron"];

const db = getDb();
const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
if (!season) throw new Error("no active season — run ingest first");

// A spread of commodities that actually trade, with their current NPC reference.
const refs = await db.execute<{ id: number; name: string; best_sell: string | null; best_buy: string | null }>(sql`
  SELECT c.id, c.name, p.best_sell::text, p.best_buy::text
  FROM commodities c
  JOIN LATERAL (
    SELECT best_sell, best_buy FROM commodity_reference_points
    WHERE commodity_id = c.id ORDER BY captured_at DESC LIMIT 1
  ) p ON true
  WHERE c.is_tradable AND p.best_sell IS NOT NULL AND p.best_buy IS NOT NULL
  ORDER BY c.name
  LIMIT 18
`);

const traders: { id: string; handle: string }[] = [];
for (const handle of HANDLES) {
  const [existing] = await db.select().from(users).where(eq(users.handle, handle));
  const user =
    existing ??
    (await db.insert(users).values({ handle, displayName: handle, isVerified: true }).returning())[0]!;
  await db.update(users).set({ auecBalance: 500_000_000 }).where(eq(users.id, user.id));
  traders.push({ id: user.id, handle });
}

// Deterministic pseudo-random so re-seeding is reproducible.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

let created = 0;
for (const [i, ref] of refs.rows.entries()) {
  const npcSell = Number(ref.best_sell);
  const npcBuy = Number(ref.best_buy);
  const ordersPerCommodity = 2 + Math.floor(rnd() * 4);

  for (let n = 0; n < ordersPerCommodity; n++) {
    const trader = traders[(i + n) % traders.length]!;
    const side = rnd() > 0.5 ? "sell" : "buy";
    // Players quote around the NPC band: sellers ask a premium, buyers bid under it.
    const price =
      side === "sell"
        ? Math.round(npcSell * (0.95 + rnd() * 0.35))
        : Math.round(npcBuy * (0.7 + rnd() * 0.45));
    const qty = (1 + Math.floor(rnd() * 20)) * 10;

    if (side === "sell") {
      // Sell orders need backing cargo.
      await db
        .insert(userHoldings)
        .values({ userId: trader.id, commodityId: ref.id, scu: qty * 3, avgCost: Math.round(npcBuy) })
        .onConflictDoUpdate({
          target: [userHoldings.userId, userHoldings.commodityId],
          set: { scu: sql`${userHoldings.scu} + ${qty * 3}` },
        });
    }

    await db.insert(orders).values({
      ownerId: trader.id,
      seasonId: season.id,
      commodityId: ref.id,
      side,
      pricePerScu: Math.max(1, price),
      quantityScu: qty,
      remainingScu: qty,
      minFillScu: rnd() > 0.7 ? Math.max(1, Math.round(qty / 4)) : 1,
      expiresAt: new Date(Date.now() + (24 + Math.floor(rnd() * 300)) * 3_600_000),
    });
    created++;
  }
}

console.log(`seeded ${created} orders across ${refs.rows.length} commodities and ${traders.length} traders`);
await closeDb();
process.exit(0);
