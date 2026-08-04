import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./client";

/**
 * Apply committed SQL migrations.
 *
 * Runs at server boot so a container starts against an empty database and brings itself up
 * — no drizzle-kit, no separate migrate job, no dev dependencies in the runtime image.
 * Safe to call repeatedly: drizzle records applied migrations in `__drizzle_migrations`.
 */
export async function runMigrations(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ during dev, dist-adjacent in an image — resolve both.
  const candidates = [resolve(here, "../migrations"), resolve(here, "../../migrations")];
  const migrationsFolder = candidates.find((p) => existsSync(p));
  if (!migrationsFolder) {
    console.warn("[migrate] no migrations folder found — skipping");
    return;
  }
  await migrate(getDb(), { migrationsFolder });
  console.log("[migrate] schema up to date");
}
