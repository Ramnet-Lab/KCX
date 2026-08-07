import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// drizzle-kit runs from packages/db (its bundler drops import.meta.dirname, so use cwd);
// the single .env lives at the repo root.
function rootEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    let v = line?.slice(key.length + 1).trim();
    if (v && /^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    return v || undefined;
  } catch {
    return undefined;
  }
}

const url = rootEnv("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is not set (root .env)");

export default defineConfig({
  dialect: "postgresql",
  // market.ts only — snapshots.ts describes a partitioned table that drizzle-kit cannot
  // create correctly; its DDL is owned by apps/server jobs/partitions.ts. The filter
  // keeps push/generate from ever prompting about (or dropping) those tables.
  schema: [
    "./src/schema/market.ts",
    "./src/schema/orders.ts",
    "./src/schema/inventory.ts",
    "./src/schema/auth.ts",
    "./src/schema/contracts.ts",
    "./src/schema/orgs.ts",
    "./src/schema/market-makers.ts",
    "./src/schema/bazaar.ts",
    "./src/schema/instalments.ts",
    "./src/schema/watchlist.ts",
    "./src/schema/moderation.ts",
    "./src/schema/feedback.ts",
  ],
  out: "./migrations",
  dbCredentials: { url },
  tablesFilter: ["!uex_price_snapshots", "!uex_price_snapshots_*"],
});
