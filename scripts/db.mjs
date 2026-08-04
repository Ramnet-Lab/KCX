// Cross-shell wrapper for the portable PostgreSQL bundled under tools/pgsql.
// Usage: node scripts/db.mjs start|stop|status
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pgCtl = path.join(root, "tools", "pgsql", "bin", "pg_ctl.exe");
const dataDir = path.join(root, ".pgdata");
const logFile = path.join(dataDir, "pg.log");

const cmd = process.argv[2];
if (!["start", "stop", "status"].includes(cmd)) {
  console.error("usage: node scripts/db.mjs start|stop|status");
  process.exit(1);
}

const args = ["-D", dataDir, ...(cmd === "start" ? ["-l", logFile, "-o", "-p 5433"] : []), cmd];
try {
  execFileSync(pgCtl, args, { stdio: "inherit" });
} catch (err) {
  // pg_ctl status exits non-zero when the server is stopped; that's informational, not an error.
  process.exit(cmd === "status" ? 0 : 1);
}
