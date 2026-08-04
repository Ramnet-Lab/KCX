import { gameVersions, getDb, rolloverSeason } from "@kcx/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchUexData } from "../lib/uex";

const uexGameVersion = z.object({
  live: z.string().nullable().optional(),
  ptu: z.string().nullable().optional(),
});

/**
 * Hourly LIVE-version watch, and the season rollover it triggers.
 *
 * ANTI-FLAP: a new version must be reported on TWO consecutive polls before the season
 * turns over. UEX's LIVE field has been seen to flicker during a patch window — briefly
 * reporting the incoming build, then reverting — and rollover is destructive: it expires
 * every open order, escrow and contract on the exchange. Acting on a single reading would
 * make a momentary upstream wobble indistinguishable from a patch, and there is no undo.
 *
 * The candidate is held in memory rather than persisted. A restart simply costs one more
 * poll of confirmation, which is the safe direction to fail in.
 */
let pendingVersion: string | null = null;

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
  if (active?.version === live) {
    pendingVersion = null;
    return;
  }

  // First sighting: record it and wait for the next poll to agree.
  if (pendingVersion !== live) {
    pendingVersion = live;
    console.log(`[game-version] saw ${live} (active: ${active?.version ?? "none"}) — awaiting a second poll before rolling over`);
    return;
  }
  pendingVersion = null;

  const newSeasonId = await db.transaction(async (tx) => {
    if (active) {
      await tx
        .update(gameVersions)
        .set({ status: "ended", endedAt: new Date() })
        .where(eq(gameVersions.id, active.id));
    }
    const [row] = await tx
      .insert(gameVersions)
      .values({ version: live, status: "active", liveAt: new Date() })
      .onConflictDoUpdate({
        target: gameVersions.version,
        set: { status: "active", liveAt: sql`coalesce(${gameVersions.liveAt}, now())`, endedAt: null },
      })
      .returning({ id: gameVersions.id });
    return row?.id ?? null;
  });
  console.log(`[game-version] season is now ${live}${active ? ` (was ${active.version})` : ""}`);

  // The very first season on a fresh database has nothing to expire, and expiring the board
  // because the exchange just learned what version the game is on would be absurd.
  if (!active || newSeasonId == null) return;

  const result = await rolloverSeason(db, { newSeasonId });
  console.log(
    `[game-version] rollover: ${result.ordersExpired} order(s), ${result.tradesExpired} escrow(s) released, ` +
      `${result.contractsExpired} contract(s), ${result.bidsWithdrawn} bid(s) withdrawn`,
  );
}
