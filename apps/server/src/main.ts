/**
 * The persistent KCX server process: pg-boss scheduled jobs (and, from M3, socket.io).
 * Boot order: env → snapshot DDL → pg-boss → schedules → boot-time catch-up ingest.
 */
import { loadRootEnv } from "./env";
loadRootEnv();

import {
  closeDb,
  expireStaleContracts,
  runMigrations,
  expireUnfilledOrders,
  getDb,
  reconcileReservations,
  indexLatest,
  terminalPricesLatest,
  tickerEntries,
} from "@kcx/db";
import { INGEST_INTERVAL_MINUTES } from "@kcx/shared";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { rebuildCandlesSince } from "./jobs/candles";
import { checkGameVersion } from "./jobs/game-version";
import { ingestPrices } from "./jobs/ingest-prices";
import { ensureSnapshotInfra } from "./jobs/partitions";
import { syncMasterData } from "./jobs/sync-master";
import { startMarketFeed } from "./ws/market-feed";
import { createWsServer } from "./ws/server";

const QUEUES = {
  ingest: "ingest-prices",
  master: "sync-master-data",
  version: "check-game-version",
  partitions: "partition-maintenance",
  expireOrders: "expire-unfilled-orders",
} as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Bring the schema up before anything touches it — a fresh container self-installs.
  await runMigrations();
  await ensureSnapshotInfra();

  const wsPort = Number(process.env.WS_PORT ?? 4000);
  const corsOrigins = (process.env.WEB_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim());
  const ws = createWsServer(wsPort, corsOrigins);

  const broadcastTicker = async () => {
    const db = getDb();
    const [entries, idx] = await Promise.all([tickerEntries(db), indexLatest(db)]);
    ws.broadcastTicker({ at: new Date().toISOString(), entries, indexLatest: idx });
  };

  // Order-book changes from the web process arrive over Postgres NOTIFY and go straight out
  // to connected clients; settlements also refresh the price ticker on the spot.
  const stopMarketFeed = await startMarketFeed(connectionString, ws, broadcastTicker);

  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  boss.on("error", (err: Error) => console.error("[pg-boss]", err));
  await boss.start();

  // policy "singleton": at most one active job per queue — pg-boss v12 enforces
  // singleton semantics via queue policy; a bare singletonKey on a standard queue is a no-op.
  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue, { policy: "singleton" });
  }

  // Singleton keys: dedupe queued (pre-active) duplicates of the same tick.
  await boss.schedule(QUEUES.ingest, `*/${INGEST_INTERVAL_MINUTES} * * * *`, undefined, { singletonKey: QUEUES.ingest });
  await boss.schedule(QUEUES.master, "0 3 * * *", undefined, { singletonKey: QUEUES.master });
  await boss.schedule(QUEUES.version, "15 * * * *", undefined, { singletonKey: QUEUES.version });
  await boss.schedule(QUEUES.partitions, "0 0 1 * *", undefined, { singletonKey: QUEUES.partitions });
  // Fill-by deadlines resolve every 5 minutes; expired orders leave no market footprint.
  await boss.schedule(QUEUES.expireOrders, "*/5 * * * *", undefined, { singletonKey: QUEUES.expireOrders });

  await boss.work(QUEUES.ingest, async () => {
    await ingestPrices();
    await broadcastTicker().catch((err) => console.error("[ticker] broadcast failed:", err));
  });
  await boss.work(QUEUES.master, async () => {
    await syncMasterData();
  });
  await boss.work(QUEUES.version, async () => {
    await checkGameVersion();
  });
  await boss.work(QUEUES.partitions, async () => {
    await ensureSnapshotInfra();
  });
  await boss.work(QUEUES.expireOrders, async () => {
    const db = getDb();
    // Release stale escrows FIRST so freed quantity is back on the board before we
    // evaluate which orders have genuinely run out of time.
    const released = await expireStaleContracts(db);
    if (released > 0) console.log(`[contracts] ${released} escrow(s) expired → orders republished`);
    // Self-heal any reserved_scu drift before deciding what has actually run out of time.
    const reconciled = await reconcileReservations(db);
    if (reconciled > 0) console.log(`[contracts] reconciled reserved_scu on ${reconciled} order(s)`);
    const n = await expireUnfilledOrders(db);
    if (n > 0) console.log(`[orders] ${n} order(s) hit their fill-by deadline → expired_unfilled`);
  });

  // Boot-time catch-up: if the latest capture is older than one interval (+ grace),
  // don't wait for the next cron tick — dev machines sleep, VPSes reboot.
  const staleCheck = await getDb().execute<{ last: string | null }>(
    sql`SELECT max(captured_at)::text AS last FROM terminal_prices_latest`,
  );
  const last = staleCheck.rows[0]?.last ?? null;
  const staleMs = (INGEST_INTERVAL_MINUTES + 5) * 60_000;
  if (!last || Date.now() - new Date(last).getTime() > staleMs) {
    console.log(`[main] data ${last ? "stale" : "missing"} — running catch-up ingest`);
    await boss.send(QUEUES.ingest, {}, { singletonKey: QUEUES.ingest });
  }
  await checkGameVersion().catch((err) => console.error("[game-version]", err));

  console.log(`[main] KCX server up — ingest every ${INGEST_INTERVAL_MINUTES}m, master 03:00, version watch hourly`);

  const shutdown = async (signal: string) => {
    console.log(`[main] ${signal} — shutting down`);
    await stopMarketFeed().catch(() => {});
    await ws.close().catch(() => {});
    await boss.stop({ graceful: true, timeout: 15_000 }).catch(() => {});
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[main] fatal:", err);
  process.exit(1);
});

export { rebuildCandlesSince }; // re-export for the one-off backfill script
