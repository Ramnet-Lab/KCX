/** Full candle rebuild from all reference points (e.g. after bucketing-logic changes). */
import { loadRootEnv } from "../env";
loadRootEnv();

import { closeDb, getDb } from "@kcx/db";
import { sql } from "drizzle-orm";
import { rebuildCandlesSince } from "../jobs/candles";
import { rebuildIndexSince } from "../jobs/index-points";

const db = getDb();
await db.execute(sql`TRUNCATE reference_candles`);
await db.execute(sql`TRUNCATE market_index_points`);
await rebuildCandlesSince(new Date(0));
await rebuildIndexSince(new Date(0));
const counts = await db.execute<{ period: string; n: string }>(
  sql`SELECT period, count(*)::text AS n FROM reference_candles GROUP BY period`,
);
console.log("rebuilt:", counts.rows.map((r) => `${r.period}=${r.n}`).join(" "));
await closeDb();
