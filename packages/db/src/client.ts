import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/market";

export type Db = NodePgDatabase<typeof schema>;

type Cached = { db: Db; pool: pg.Pool };

// globalThis (not module scope) so the pool survives Next.js dev HMR re-instantiating
// this module — transpilePackages recompiles it into the app bundle on edits.
const g = globalThis as typeof globalThis & { __kcxDb?: Cached };

export function getDb(): Db {
  if (!g.__kcxDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    const pool = new pg.Pool({
      connectionString,
      max: 10,
      // All bucketing SQL assumes UTC sessions; never inherit the server's default zone.
      options: "-c timezone=UTC",
    });
    // Without a listener, an idle client dying (DB restart, sleep/wake) crashes the process.
    pool.on("error", (err) => console.error("[pg-pool] idle client error:", err.message));
    g.__kcxDb = { db: drizzle(pool, { schema }), pool };
  }
  return g.__kcxDb.db;
}

export async function closeDb(): Promise<void> {
  await g.__kcxDb?.pool.end();
  g.__kcxDb = undefined;
}
