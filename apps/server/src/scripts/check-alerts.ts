/**
 * End-to-end check of the price-alert engine.
 *
 * The interesting behaviour is not "does it fire" but "does it fire ONCE": an alert set at
 * "below 35M" that re-fires on every settlement while the price stays under is the fastest
 * way to teach someone to ignore alerts. This exercises fire, don't-refire, and re-arm.
 *
 * WRITES TO THE DATABASE — creates a throwaway account and watch rows, then removes them.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error("check-alerts writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true, dev DB only.");
  process.exit(1);
}

import { closeDb, getDb, listPriceAlerts, listWatchlist, runPriceAlerts, upsertWatch, users } from "@kcx/db";
import { sql } from "drizzle-orm";

const db = getDb();
const ok = (label: string, cond: boolean) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const [user] = await db
  .insert(users)
  .values({ handle: "_alert_check", displayName: "_alert_check", isVerified: true, auecBalance: 0 })
  .onConflictDoUpdate({ target: users.handle, set: { displayName: "_alert_check" } })
  .returning();

// Start from a clean slate. A run that crashes part-way leaves its rows behind, and the
// counting assertions below would then read those as extra firings — a false failure that
// looks exactly like the real bug this script exists to catch.
await db.execute(sql`DELETE FROM price_alerts WHERE user_id = ${user!.id}::uuid`);
await db.execute(sql`DELETE FROM watchlist_entries WHERE user_id = ${user!.id}::uuid`);

// Pick a commodity that actually has a mark, so the comparison has something to compare to.
const [c] = (
  await db.execute<{ id: number; name: string; mark: string }>(sql`
    SELECT c.id, c.name, m.mark_price::text AS mark
    FROM commodity_marks_latest m JOIN commodities c ON c.id = m.commodity_id
    WHERE m.mark_price IS NOT NULL ORDER BY m.mark_price DESC LIMIT 1`)
).rows;
if (!c) {
  console.error("no commodity has a mark yet — run an ingest first");
  process.exit(1);
}
const mark = Number(c.mark);
console.log(`using ${c.name} at ${mark.toLocaleString()} aUEC`);

// --- armed but not crossed -------------------------------------------------
await upsertWatch(db, { userId: user!.id, commodityId: c.id, threshold: Math.floor(mark / 2), direction: "below" });
const quiet = await runPriceAlerts(db);
const afterQuiet = await listWatchlist(db, user!.id);
ok("an alert below the price does not fire", afterQuiet[0]?.triggeredAt == null);

// --- crossed ---------------------------------------------------------------
// Thresholds are whole aUEC while a mark is a VWAP and so fractional; floor everything the
// test derives from it, exactly as the UI does.
const high = Math.floor(mark * 2);
await upsertWatch(db, { userId: user!.id, commodityId: c.id, threshold: high, direction: "below" });
const fired = await runPriceAlerts(db);
ok("it fires once the condition is true", fired >= 1);

const feed = await listPriceAlerts(db, user!.id);
// Rounded because a mark is a VWAP and so fractional, while the recorded price is whole
// aUEC like every other money column.
ok("the firing lands in the feed", feed.length === 1 && Math.round(feed[0]?.price ?? -1) === Math.round(mark));
ok("the feed says what it crossed", feed[0]?.threshold === high && feed[0]?.direction === "below");

// --- does not re-fire ------------------------------------------------------
await runPriceAlerts(db);
const feedAgain = await listPriceAlerts(db, user!.id);
ok("it does not fire again while still true", feedAgain.length === 1);

// --- re-arms ---------------------------------------------------------------
// Move the threshold back below the price: the condition is false again, so the sweep
// should clear triggered_at and leave it ready for next time.
await db.execute(sql`
  UPDATE watchlist_entries SET threshold = ${Math.floor(mark / 2)}, triggered_at = now()
  WHERE user_id = ${user!.id}::uuid`);
await runPriceAlerts(db);
const rearmed = await listWatchlist(db, user!.id);
ok("it re-arms once the price crosses back", rearmed[0]?.triggeredAt == null);

// --- editing an alert re-arms it -------------------------------------------
const higher = Math.floor(mark * 3);
await upsertWatch(db, { userId: user!.id, commodityId: c.id, threshold: higher, direction: "below" });
const edited = await listWatchlist(db, user!.id);
ok("editing the rule clears the old firing", edited[0]?.triggeredAt == null && edited[0]?.threshold === higher);

// --- watch with no alert ---------------------------------------------------
await upsertWatch(db, { userId: user!.id, commodityId: c.id, threshold: null });
const silent = await listWatchlist(db, user!.id);
ok("a watch can carry no alert at all", silent[0]?.threshold == null);
const silentRun = await runPriceAlerts(db);
ok("a silent watch never fires", silentRun === 0);

// --- teardown --------------------------------------------------------------
await db.execute(sql`DELETE FROM price_alerts WHERE user_id = ${user!.id}::uuid`);
await db.execute(sql`DELETE FROM watchlist_entries WHERE user_id = ${user!.id}::uuid`);
await db.execute(sql`DELETE FROM users WHERE handle = '_alert_check'`);
console.log(`cleaned up (quiet run fired ${quiet})`);

await closeDb();
process.exit(0);
