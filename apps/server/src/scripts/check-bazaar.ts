/**
 * End-to-end check of the bazaar's negotiation, wanted-ad and loadout rules.
 *
 * Exercises the invariants that are easy to get quietly wrong: nobody accepting their own
 * offer, exactly one live offer per thread, roles swapping on a wanted ad, and the poster's
 * aUEC not being committed twice when their ad is filled.
 *
 * WRITES TO THE DATABASE. It creates two throwaway accounts and some listings and deletes
 * them again, so it is a development tool, not a health check — hence the explicit opt-in
 * below rather than a comment nobody reads before running it against production.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error(
    "check-bazaar writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true to run it,\n" +
      "and only against a development database.",
  );
  process.exit(1);
}

import {
  acceptBazaarOffer,
  bazaarListings,
  buyCapacity,
  closeDb,
  gameVersions,
  getBazaarListing,
  getBazaarThread,
  getDb,
  listBazaarThreads,
  postBazaarMessage,
  searchBazaarItems,
  setListingComponents,
  takeBazaarListing,
  users,
} from "@kcx/db";
import { eq, sql } from "drizzle-orm";

const db = getDb();
const log = (s: string) => console.log(s);
const ok = (label: string, cond: boolean) => log(`${cond ? "PASS" : "FAIL"}  ${label}`);

// --- fixtures -------------------------------------------------------------
const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
if (!season) throw new Error("no active season — run the ingest first");

async function mkUser(handle: string, balance: number) {
  const [u] = await db
    .insert(users)
    .values({ handle, displayName: handle, isVerified: true, auecBalance: balance })
    .onConflictDoUpdate({ target: users.handle, set: { auecBalance: balance } })
    .returning();
  return u!;
}
const alice = await mkUser("_p1_alice", 100_000_000);
const bob = await mkUser("_p1_bob", 100_000_000);

const cleanup: string[] = [];
async function mkListing(intent: "sell" | "buy", price: number, qty = 1, owner = alice.id) {
  const [l] = await db
    .insert(bazaarListings)
    .values({
      sellerId: owner,
      intent,
      seasonId: season!.id,
      title: `_p1 ${intent} listing`,
      category: "ships",
      listingType: "buy_now",
      buyNowPrice: price,
      quantity: qty,
      remainingQuantity: qty,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  cleanup.push(l!.id);
  return l!;
}

// --- 1. threads and offers ------------------------------------------------
const sale = await mkListing("sell", 5_000_000);
const opened = await postBazaarMessage(db, {
  listingId: sale.id,
  senderId: bob.id,
  body: "Does it come with the S4 shields?",
});
ok("buyer opens a thread", opened.ok);
const threadId = opened.ok ? opened.threadId : "";

const selfAccept = await postBazaarMessage(db, {
  threadId,
  senderId: bob.id,
  body: "I'll give you 4M",
  offerUnitPrice: 4_000_000,
});
ok("buyer attaches an offer", selfAccept.ok);

const thread = await getBazaarThread(db, threadId, alice.id);
const offerId = thread?.openOffer?.id ?? 0;
ok("seller sees the open offer", offerId > 0);

const own = await acceptBazaarOffer(db, { messageId: offerId, userId: bob.id });
ok("nobody can accept their own offer", !own.ok);

const outsider = await getBazaarThread(db, threadId, season!.id.toString().padEnd(36, "0"));
ok("a non-party gets nothing back", outsider === null);

// A second offer supersedes the first, so "the offer" is never ambiguous.
await postBazaarMessage(db, { threadId, senderId: alice.id, body: "4.5M", offerUnitPrice: 4_500_000 });
const after = await getBazaarThread(db, threadId, alice.id);
const openCount = after?.messages.filter((m) => m.offerStatus === "open").length ?? 0;
ok("only one offer is ever open", openCount === 1);

const accepted = await acceptBazaarOffer(db, { messageId: after!.openOffer!.id, userId: bob.id });
ok("counterparty accepts, striking a sale", accepted.ok && !!accepted.saleId);

const afterSale = await getBazaarListing(db, sale.id);
ok("units come off the listing", afterSale?.remainingQuantity === 0 && afterSale.status === "sold_out");

// --- 2. wanted ads --------------------------------------------------------
const before = await buyCapacity(db, alice.id);
const wanted = await mkListing("buy", 10_000_000, 2);
const during = await buyCapacity(db, alice.id);
ok(
  "a wanted ad commits its aUEC",
  during.committed - before.committed === 20_000_000,
);

const ownFill = await takeBazaarListing(db, { listingId: wanted.id, takerId: alice.id, quantity: 1 });
ok("you can't fill your own wanted ad", !ownFill.ok);

const filled = await takeBazaarListing(db, { listingId: wanted.id, takerId: bob.id, quantity: 1 });
ok("someone else fills it", filled.ok);

const roles = await db.execute<{ seller: string; buyer: string }>(sql`
  SELECT seller_id::text AS seller, buyer_id::text AS buyer FROM bazaar_sales WHERE id = ${filled.ok ? filled.saleId : null}::uuid`);
ok(
  "roles are swapped: poster buys, taker sells",
  roles.rows[0]?.buyer === alice.id && roles.rows[0]?.seller === bob.id,
);

const afterFill = await buyCapacity(db, alice.id);
ok(
  "filling doesn't double-commit the poster",
  afterFill.committed - before.committed === 20_000_000,
);

// --- 3. loadouts ----------------------------------------------------------
const ship = await mkListing("sell", 40_000_000);
const parts = await searchBazaarItems(db, "shield", { limit: 2 });
const set = await setListingComponents(db, {
  listingId: ship.id,
  sellerId: alice.id,
  components: parts.map((p) => ({ itemId: p.id, slotLabel: "size 2", quantity: 1 })),
});
ok("seller saves a loadout", set.ok);

const withParts = await getBazaarListing(db, ship.id);
ok("loadout comes back on the listing", withParts?.components.length === parts.length);

const notMine = await setListingComponents(db, { listingId: ship.id, sellerId: bob.id, components: [] });
ok("only the seller can set it", !notMine.ok);

const bogus = await setListingComponents(db, {
  listingId: ship.id,
  sellerId: alice.id,
  components: [{ itemId: 999_999_999 }],
});
ok("components must exist in the catalogue", !bogus.ok);

// --- 4. desk --------------------------------------------------------------
const threads = await listBazaarThreads(db, alice.id);
ok("threads reach the desk", threads.length >= 1);

// --- teardown -------------------------------------------------------------
for (const id of cleanup) {
  await db.execute(sql`DELETE FROM bazaar_messages WHERE thread_id IN (SELECT id FROM bazaar_threads WHERE listing_id = ${id}::uuid)`);
  await db.execute(sql`DELETE FROM bazaar_threads WHERE listing_id = ${id}::uuid`);
  await db.execute(sql`DELETE FROM bazaar_listing_components WHERE listing_id = ${id}::uuid`);
  await db.execute(sql`DELETE FROM bazaar_events WHERE listing_id = ${id}::uuid`);
  await db.execute(sql`DELETE FROM bazaar_sales WHERE listing_id = ${id}::uuid`);
  await db.execute(sql`DELETE FROM bazaar_listings WHERE id = ${id}::uuid`);
}
await db.execute(sql`DELETE FROM users WHERE handle IN ('_p1_alice','_p1_bob')`);
log("cleaned up");

await closeDb();
process.exit(0);
