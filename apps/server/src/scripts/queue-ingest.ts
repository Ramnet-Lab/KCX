/** Queue one ingest-prices job for the running server (dev utility + used by tests). */
import { loadRootEnv } from "../env";
loadRootEnv();

import { PgBoss } from "pg-boss";

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
await boss.start();
const id = await boss.send("ingest-prices", {}, {});
console.log("queued ingest-prices job:", id);
// pg-boss keeps pool timers alive; a queued job doesn't need a graceful stop.
process.exit(0);
