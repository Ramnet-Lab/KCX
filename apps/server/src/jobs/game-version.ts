import { gameVersions, getDb } from "@kcx/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchUexData } from "../lib/uex";

const uexGameVersion = z.object({
  live: z.string().nullable().optional(),
  ptu: z.string().nullable().optional(),
});

/**
 * Hourly LIVE-version watch. M2 scope: keep game_versions in sync and flip the active
 * season when UEX reports a new LIVE version (logged, auditable). The full rollover
 * side-effects (expiring orders/trades, notifications, 2-poll anti-flap + mod confirm)
 * arrive with the order board in M6/M7 — until orders exist, activation is safe.
 */
export async function checkGameVersion(): Promise<void> {
  const db = getDb();
  // /game_versions → { live: "4.9", ptu: "4.10.0" }
  const raw = await fetchUexData("/game_versions").catch(() => null);
  const parsed = uexGameVersion.safeParse(raw);
  if (!parsed.success || !parsed.data.live) {
    console.warn("[game-version] could not read LIVE version from UEX");
    return;
  }
  const live = parsed.data.live;

  const [active] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
  if (active?.version === live) return;

  await db.transaction(async (tx) => {
    if (active) {
      await tx
        .update(gameVersions)
        .set({ status: "ended", endedAt: new Date() })
        .where(eq(gameVersions.id, active.id));
    }
    await tx
      .insert(gameVersions)
      .values({ version: live, status: "active", liveAt: new Date() })
      .onConflictDoUpdate({
        target: gameVersions.version,
        set: { status: "active", liveAt: sql`coalesce(${gameVersions.liveAt}, now())`, endedAt: null },
      });
  });
  console.log(`[game-version] season is now ${live}${active ? ` (was ${active.version})` : ""}`);
}
