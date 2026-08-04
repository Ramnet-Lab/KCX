/**
 * The persistent KCX server process: pg-boss scheduled jobs (and, from M3, socket.io).
 * Boot order: env → snapshot DDL → pg-boss → schedules → boot-time catch-up ingest.
 */
import { loadRootEnv } from "./env";
loadRootEnv();

import {
  closeDb,
  expireStaleContracts,
  closeBazaarAuctions,
  closeContractBidding,
  ensureBootstrapAdmin,
  expireBazaarListings,
  expireBazaarSales,
  liftExpiredBans,
  expireContractAwards,
  expireServiceContracts,
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
import { rebuildIndexSince } from "./jobs/index-points";
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

  // The owner needs admin, but their account may not exist when migrations run — someone has
  // to sign up first. Checking every boot means it lands whenever they appear.
  // BOOTSTRAP_MOD_HANDLE is the previous name for this, still honoured so an older .env works.
  const ownerHandle = process.env.BOOTSTRAP_ADMIN_HANDLE ?? process.env.BOOTSTRAP_MOD_HANDLE ?? "ramnet";
  const promoted = await ensureBootstrapAdmin(getDb(), ownerHandle).catch((err) => {
    console.error("[bootstrap-admin]", err instanceof Error ? err.message : err);
    return null;
  });
  if (promoted) console.log(`[bootstrap-admin] granted admin to ${promoted}`);

  const wsPort = Number(process.env.WS_PORT ?? 4000);
  const corsOrigins = (process.env.WEB_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim());
  const ws = createWsServer(wsPort, corsOrigins);

  const broadcastTicker = async () => {
    const db = getDb();
    const [entries, idx] = await Promise.all([tickerEntries(db), indexLatest(db)]);
    ws.broadcastTicker({ at: new Date().toISOString(), entries, indexLatest: idx });
  };

  /**
   * Settlements arrive one NOTIFY at a time, but the work each one triggers — rebuild
   * candles, rebuild indices, recompute and broadcast the whole ticker — is expensive and
   * almost entirely shared between two fills a second apart. Coalesce into a trailing
   * window, with a ceiling so a steady stream of trades still refreshes regularly instead
   * of pushing the flush out forever.
   */
  const SETTLE_DEBOUNCE_MS = 400;
  const SETTLE_MAX_WAIT_MS = 3_000;
  let settleTimer: NodeJS.Timeout | null = null;
  let settleDeadline = 0;
  let touched = new Set<number>();

  const flushPriceMoves = async () => {
    settleTimer = null;
    settleDeadline = 0;
    const commodities = touched;
    touched = new Set();
    try {
      // Widened a little past the current bucket so a fill that lands either side of an
      // hour boundary repaints the bucket it actually belongs to.
      const from = new Date(Date.now() - 2 * 3_600_000);
      if (commodities.size === 0 || commodities.size > 8) {
        await rebuildCandlesSince(from);
      } else {
        for (const id of commodities) await rebuildCandlesSince(from, id);
      }
      await rebuildIndexSince(from);
    } catch (err) {
      console.error("[settle] derived series rebuild failed:", err instanceof Error ? err.message : err);
    }
    await broadcastTicker().catch((err) => console.error("[ticker] broadcast failed:", err));
  };

  const onPriceMoved = (commodityId: number | null) => {
    if (commodityId != null) touched.add(commodityId);
    const now = Date.now();
    if (settleDeadline === 0) settleDeadline = now + SETTLE_MAX_WAIT_MS;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void flushPriceMoves(), Math.max(0, Math.min(SETTLE_DEBOUNCE_MS, settleDeadline - now)));
  };

  // Order-book changes from the web process arrive over Postgres NOTIFY and go straight out
  // to connected clients; settlements also refresh the price ticker on the spot.
  const stopMarketFeed = await startMarketFeed(connectionString, ws, onPriceMoved);

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
    // Auctions resolve before deadlines are enforced: a contract whose bidding window just
    // closed should get its winner in the same sweep, not be expired out from under them.
    const auctions = await closeContractBidding(db);
    if (auctions > 0) console.log(`[contracts] ${auctions} auction(s) closed → awarded to lowest bidder`);
    const lapsed = await expireContractAwards(db);
    if (lapsed > 0) console.log(`[contracts] ${lapsed} award(s) went unanswered → cascaded to next bidder`);
    const jobs = await expireServiceContracts(db);
    if (jobs > 0) console.log(`[contracts] ${jobs} service contract(s) passed their deadline`);
    const n = await expireUnfilledOrders(db);
    if (n > 0) console.log(`[orders] ${n} order(s) hit their fill-by deadline → expired_unfilled`);
    // Bazaar, in the order the state depends on: award the auctions whose clock ran out,
    // put the units from sales nobody confirmed back on the board, and only then expire
    // listings — so a restocked listing isn't expired in the same pass that revived it.
    const won = await closeBazaarAuctions(db);
    if (won > 0) console.log(`[bazaar] ${won} auction(s) closed → sold to the high bidder`);
    const lapsedSales = await expireBazaarSales(db);
    if (lapsedSales > 0) console.log(`[bazaar] ${lapsedSales} sale(s) went unconfirmed → units back on the board`);
    const deadListings = await expireBazaarListings(db);
    if (deadListings > 0) console.log(`[bazaar] ${deadListings} listing(s) ran out of time`);
    // Cosmetic: isBanned() already treats an elapsed ban as lifted, but leaving served bans
    // in the data makes the mod console lie about who is currently banned.
    const unbanned = await liftExpiredBans(db);
    if (unbanned > 0) console.log(`[bans] ${unbanned} timed ban(s) expired`);
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
    if (settleTimer) clearTimeout(settleTimer);
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
