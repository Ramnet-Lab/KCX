/**
 * One-off full ingest: snapshot DDL → master data → prices → candles.
 * The scheduled path lives in main.ts; this stays for bootstrap/recovery and CI checks.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

import { closeDb } from "@kcx/db";
import { checkGameVersion } from "../jobs/game-version";
import { ingestPrices } from "../jobs/ingest-prices";
import { ensureSnapshotInfra } from "../jobs/partitions";
import { syncMasterData } from "../jobs/sync-master";

async function main() {
  const base = process.env.UEX_API_BASE ?? "https://api.uexcorp.uk/2.0";
  console.log(`KCX ingest ← ${base} ${process.env.UEX_API_TOKEN ? "(authenticated)" : "(unauthenticated)"}`);
  await ensureSnapshotInfra();
  console.log("Syncing master data…");
  await syncMasterData();
  console.log("Ingesting latest prices…");
  await ingestPrices();
  await checkGameVersion();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Ingest failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
