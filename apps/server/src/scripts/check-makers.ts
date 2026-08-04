/**
 * End-to-end check of two-sided market maker quotes.
 *
 * The rules that matter: both sides must be backed (a quote collateralised on one side is
 * an advertisement), a crossed quote is refused outright, and quoting time survives a price
 * revision but stops when the maker actually stands down.
 *
 * WRITES TO THE DATABASE — creates throwaway accounts and quotes, then removes them.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error("check-makers writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true, dev DB only.");
  process.exit(1);
}

import {
  closeDb,
  commodities,
  getDb,
  listMakerQuotes,
  makerStanding,
  setMakerQuoteStatus,
  upsertMakerQuote,
  userHoldings,
  users,
} from "@kcx/db";
import { sql } from "drizzle-orm";

const db = getDb();
const ok = (label: string, cond: boolean) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

await db.execute(sql`DELETE FROM market_maker_quotes WHERE user_id IN (SELECT id FROM users WHERE handle = '_mm_test')`);
await db.execute(sql`DELETE FROM user_holdings WHERE user_id IN (SELECT id FROM users WHERE handle = '_mm_test')`);
await db.execute(sql`DELETE FROM users WHERE handle = '_mm_test'`);

const [maker] = await db
  .insert(users)
  .values({ handle: "_mm_test", displayName: "_mm_test", isVerified: true, auecBalance: 50_000_000 })
  .returning();
const [c] = await db.select({ id: commodities.id, name: commodities.name }).from(commodities).limit(1);
if (!c) {
  console.error("no commodities — run the ingest first");
  process.exit(1);
}

// --- crossed quotes are refused -------------------------------------------
const crossed = await upsertMakerQuote(db, {
  userId: maker!.id,
  commodityId: c.id,
  bidPrice: 200,
  askPrice: 100,
  bidSizeScu: 10,
  askSizeScu: 10,
});
ok("a crossed quote is refused", !crossed.ok);

// --- the ask side needs real cargo ----------------------------------------
const noCargo = await upsertMakerQuote(db, {
  userId: maker!.id,
  commodityId: c.id,
  bidPrice: 100,
  askPrice: 120,
  bidSizeScu: 10,
  askSizeScu: 10,
});
ok("an ask with no declared cargo is refused", !noCargo.ok);
ok("and it says why", (noCargo.ok ? "" : noCargo.error).toLowerCase().includes("hold"));

await db.insert(userHoldings).values({ userId: maker!.id, commodityId: c.id, scu: 500 });

// --- the bid side needs real aUEC -----------------------------------------
const tooRich = await upsertMakerQuote(db, {
  userId: maker!.id,
  commodityId: c.id,
  bidPrice: 1_000_000,
  askPrice: 1_100_000,
  bidSizeScu: 1000,
  askSizeScu: 10,
});
ok("a bid beyond the maker's aUEC is refused", !tooRich.ok);

// --- a properly backed quote goes up --------------------------------------
const good = await upsertMakerQuote(db, {
  userId: maker!.id,
  commodityId: c.id,
  bidPrice: 100,
  askPrice: 120,
  bidSizeScu: 100,
  askSizeScu: 100,
});
ok("a two-sided backed quote is accepted", good.ok);

const live = await listMakerQuotes(db, { commodityId: c.id, viewerId: maker!.id });
const q = live.find((x) => x.userId === maker!.id);
ok("it shows on the board", !!q);
ok("spread is computed", q?.spread === 20 && Math.abs((q?.spreadPct ?? 0) - 18.18) < 0.1);

// --- revising keeps the clock running -------------------------------------
await db.execute(sql`
  UPDATE market_maker_quotes SET committed_since = now() - interval '90 minutes'
  WHERE user_id = ${maker!.id}::uuid`);
await upsertMakerQuote(db, {
  userId: maker!.id,
  commodityId: c.id,
  bidPrice: 105,
  askPrice: 118,
  bidSizeScu: 100,
  askSizeScu: 100,
});
const afterRevise = (await listMakerQuotes(db, { commodityId: c.id })).find((x) => x.userId === maker!.id);
ok("revising prices does not reset quoting time", (afterRevise?.activeMinutes ?? 0) >= 89);

// --- standing down banks the time and stops the clock ----------------------
await setMakerQuoteStatus(db, { quoteId: good.ok ? good.quoteId! : "", userId: maker!.id, status: "paused" });
const paused = (await listMakerQuotes(db, { commodityId: c.id, includeInactive: true })).find(
  (x) => x.userId === maker!.id,
);
ok("standing down banks the elapsed time", (paused?.activeMinutes ?? 0) >= 89);
ok("and marks it stood down", paused?.status === "paused");

const notMine = await setMakerQuoteStatus(db, {
  quoteId: good.ok ? good.quoteId! : "",
  userId: c.id.toString().padEnd(36, "0"),
  status: "retired",
});
ok("only the maker can change their own quote", !notMine.ok);

const standing = await makerStanding(db, maker!.id);
ok("standing reflects the quote", standing.commodities === 1 && standing.totalMinutes >= 89);

// --- teardown --------------------------------------------------------------
await db.execute(sql`DELETE FROM market_maker_quotes WHERE user_id = ${maker!.id}::uuid`);
await db.execute(sql`DELETE FROM user_holdings WHERE user_id = ${maker!.id}::uuid`);
await db.execute(sql`DELETE FROM users WHERE id = ${maker!.id}::uuid`);
console.log("cleaned up");

await closeDb();
process.exit(0);
