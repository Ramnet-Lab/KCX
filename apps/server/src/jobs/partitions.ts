import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";

/**
 * Owns the DDL drizzle-kit can't express: the partitioned snapshot table, its monthly
 * partitions (current + next, created ahead of need), and the BRIN time index.
 * Idempotent — runs at boot and on the monthly schedule.
 */
export async function ensureSnapshotInfra(): Promise<void> {
  const db = getDb();

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS uex_price_snapshots (
      terminal_id       integer NOT NULL,
      commodity_id      integer NOT NULL,
      price_buy         numeric(12,2),
      price_sell        numeric(12,2),
      scu_buy           integer,
      scu_sell          integer,
      scu_sell_stock    integer,
      status_buy        smallint,
      status_sell       smallint,
      source_score      integer,
      game_version      text,
      uex_date_modified timestamptz,
      captured_at       timestamptz NOT NULL,
      PRIMARY KEY (terminal_id, commodity_id, captured_at)
    ) PARTITION BY RANGE (captured_at)
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS ups_commodity_time ON uex_price_snapshots (commodity_id, captured_at)`,
  );
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ups_brin_time ON uex_price_snapshots USING brin (captured_at)`);

  // Current month + next month, so the monthly job has a full cycle of slack.
  const now = new Date();
  for (const offset of [0, 1]) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
    const name = `uex_price_snapshots_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF uex_price_snapshots
         FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
      ),
    );
  }
}
