/**
 * End-to-end check of org treasuries and delegated spending.
 *
 * The rule worth testing is the TWO ceilings: an org's uncommitted treasury and the acting
 * member's delegated slice of it. Enforcing only the first would make every spend limit
 * decorative, which is the failure that matters — an org that trusts someone with 10M of a
 * 200M treasury has said something specific.
 *
 * WRITES TO THE DATABASE — creates a throwaway org and accounts, then removes them.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error("check-orgs writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true, dev DB only.");
  process.exit(1);
}

import {
  bazaarListings,
  canSpendOrgFunds,
  closeDb,
  createOrg,
  gameVersions,
  getDb,
  orgStanding,
  removeOrgMember,
  setOrgMember,
  setOrgTreasury,
  users,
} from "@kcx/db";
import { eq, sql } from "drizzle-orm";

const db = getDb();
const ok = (label: string, cond: boolean) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const SID = "ZZTEST";
await db.execute(sql`DELETE FROM bazaar_listings WHERE org_id IN (SELECT id FROM orgs WHERE sid = ${SID})`);
await db.execute(sql`DELETE FROM org_events WHERE org_id IN (SELECT id FROM orgs WHERE sid = ${SID})`);
await db.execute(sql`DELETE FROM org_members WHERE org_id IN (SELECT id FROM orgs WHERE sid = ${SID})`);
await db.execute(sql`DELETE FROM orgs WHERE sid = ${SID}`);
await db.execute(sql`DELETE FROM users WHERE handle IN ('_org_boss','_org_hand','_org_nobody')`);

async function mkUser(handle: string, mainOrg: string | null) {
  const [u] = await db
    .insert(users)
    .values({
      handle,
      displayName: handle,
      isVerified: true,
      rsiVerifiedAt: new Date(),
      mainOrgSid: mainOrg,
      auecBalance: 1_000_000,
    })
    .returning();
  return u!;
}
const boss = await mkUser("_org_boss", SID);
const hand = await mkUser("_org_hand", SID);
const nobody = await mkUser("_org_nobody", null);

// --- founding is gated on the RSI profile ---------------------------------
const wrongSid = await createOrg(db, { sid: "OTHERORG", name: "Not mine", founderId: boss.id });
ok("can't found an org you don't belong to", !wrongSid.ok);

const noProfile = await createOrg(db, { sid: SID, name: "Test", founderId: nobody.id });
ok("can't found without the SID on your profile", !noProfile.ok);

const made = await createOrg(db, { sid: SID, name: "Test Org", founderId: boss.id });
ok("founder with a matching main org can create it", made.ok);
const orgId = made.ok ? made.orgId! : "";

const dupe = await createOrg(db, { sid: SID, name: "Test Org", founderId: hand.id });
ok("a SID can only be registered once", !dupe.ok);

// --- treasury and delegation ----------------------------------------------
await setOrgTreasury(db, { orgId, actorId: boss.id, treasury: 200_000_000 });
await setOrgMember(db, { orgId, actorId: boss.id, userId: hand.id, role: "trader", spendLimit: 10_000_000 });

const outsider = await canSpendOrgFunds(db, { orgId, userId: nobody.id, amount: 1 });
ok("a non-member can't spend org funds", !outsider.allowed);

const withinBoth = await canSpendOrgFunds(db, { orgId, userId: hand.id, amount: 5_000_000 });
ok("a trader can spend inside their limit", withinBoth.allowed);

const overLimit = await canSpendOrgFunds(db, { orgId, userId: hand.id, amount: 50_000_000 });
ok("the delegated limit binds even though the treasury covers it", !overLimit.allowed);
ok("and it says so specifically", (overLimit.reason ?? "").includes("delegated limit"));

const overTreasury = await canSpendOrgFunds(db, { orgId, userId: boss.id, amount: 500_000_000 });
ok("the treasury binds an owner with no cap", !overTreasury.allowed);

// --- commitments reduce both ceilings --------------------------------------
const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
const [ad] = await db
  .insert(bazaarListings)
  .values({
    sellerId: hand.id,
    orgId,
    intent: "buy",
    seasonId: season!.id,
    title: "_org test wanted ad",
    category: "ships",
    listingType: "buy_now",
    buyNowPrice: 8_000_000,
    quantity: 1,
    remainingQuantity: 1,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  .returning();

const afterAd = await canSpendOrgFunds(db, { orgId, userId: hand.id, amount: 5_000_000 });
ok("a live org wanted ad eats into the member's headroom", !afterAd.allowed && afterAd.memberAvailable === 2_000_000);

const bossStillFine = await canSpendOrgFunds(db, { orgId, userId: boss.id, amount: 100_000_000 });
ok("the org treasury absorbs it without blocking others", bossStillFine.allowed);
ok("org availability dropped by the ad", bossStillFine.orgAvailable === 200_000_000 - 8_000_000);

// --- treasury can't be cut below commitments -------------------------------
const cut = await setOrgTreasury(db, { orgId, actorId: boss.id, treasury: 1_000_000 });
ok("treasury can't drop below what's committed", !cut.ok);

// --- membership rules ------------------------------------------------------
const selfPromote = await setOrgMember(db, { orgId, actorId: hand.id, userId: hand.id, role: "owner" });
ok("a trader can't promote themselves", !selfPromote.ok);

const dropCommitted = await removeOrgMember(db, { orgId, actorId: boss.id, userId: hand.id });
ok("can't remove someone still holding org commitments", !dropCommitted.ok);

const lastOwner = await removeOrgMember(db, { orgId, actorId: boss.id, userId: boss.id });
ok("an org can't be left without an owner", !lastOwner.ok);

const standing = await orgStanding(db, orgId);
ok("a new org has no trading record", standing.undertaken === 0 && standing.completionPct === null);

// --- teardown --------------------------------------------------------------
await db.execute(sql`DELETE FROM bazaar_events WHERE listing_id = ${ad!.id}::uuid`);
await db.execute(sql`DELETE FROM bazaar_listings WHERE id = ${ad!.id}::uuid`);
await db.execute(sql`DELETE FROM org_events WHERE org_id = ${orgId}::uuid`);
await db.execute(sql`DELETE FROM org_members WHERE org_id = ${orgId}::uuid`);
await db.execute(sql`DELETE FROM orgs WHERE id = ${orgId}::uuid`);
await db.execute(sql`DELETE FROM users WHERE handle IN ('_org_boss','_org_hand','_org_nobody')`);
console.log("cleaned up");

await closeDb();
process.exit(0);
