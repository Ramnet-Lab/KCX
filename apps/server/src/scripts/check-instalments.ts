/**
 * End-to-end check of instalment plans.
 *
 * The rules that keep this a payment schedule rather than a scam generator:
 *   - a plan's total is the SALE's total, never the caller's (anything else is interest)
 *   - the underlying sale does NOT complete until the final payment clears
 *   - payments settle in order and need both sides
 *   - a default is recorded, the sale is cancelled, and the buyer can't start another
 *
 * WRITES TO THE DATABASE — creates throwaway accounts, a listing, a sale and a plan.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error("check-instalments writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true, dev DB only.");
  process.exit(1);
}

import {
  bazaarListings,
  bazaarSales,
  canUseInstalments,
  closeDb,
  confirmInstalment,
  expireInstalments,
  gameVersions,
  getDb,
  INSTALMENT_MIN_TOTAL,
  listInstalmentPlans,
  proposeInstalmentPlan,
  respondToInstalmentPlan,
  users,
} from "@kcx/db";
import { eq, sql } from "drizzle-orm";

const db = getDb();
const ok = (label: string, cond: boolean) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

// sql.join rather than ANY(): drizzle's template inlines a JS array as separate positional
// parameters, which Postgres reads as a row constructor, not an array.
const HANDLES = sql.join(
  ["_ins_buyer", "_ins_seller", "_ins_green"].map((h) => sql`${h}`),
  sql`, `,
);
async function wipe() {
  const mine = sql`(SELECT id FROM users WHERE handle IN (${HANDLES}))`;
  await db.execute(sql`DELETE FROM instalment_defaults WHERE buyer_id IN ${mine}`);
  await db.execute(sql`DELETE FROM instalments WHERE plan_id IN (SELECT id FROM instalment_plans WHERE buyer_id IN ${mine})`);
  await db.execute(sql`DELETE FROM instalment_plans WHERE buyer_id IN ${mine}`);
  await db.execute(sql`DELETE FROM bazaar_sales WHERE buyer_id IN ${mine}`);
  await db.execute(sql`DELETE FROM bazaar_events WHERE listing_id IN (SELECT id FROM bazaar_listings WHERE seller_id IN ${mine})`);
  await db.execute(sql`DELETE FROM bazaar_listings WHERE seller_id IN ${mine}`);
  await db.execute(sql`DELETE FROM users WHERE handle IN (${HANDLES})`);
}
await wipe();

const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
async function mkUser(handle: string, balance: number) {
  const [u] = await db
    .insert(users)
    .values({ handle, displayName: handle, isVerified: true, rsiVerifiedAt: new Date(), auecBalance: balance })
    .returning();
  return u!;
}
const buyer = await mkUser("_ins_buyer", 100_000_000);
const seller = await mkUser("_ins_seller", 1_000_000);
const green = await mkUser("_ins_green", 100_000_000);

/** Give the buyer the settlement record the gate requires. */
async function mkSale(total: number, status: "completed" | "pending") {
  const [l] = await db
    .insert(bazaarListings)
    .values({
      sellerId: seller.id,
      seasonId: season!.id,
      title: "_ins listing",
      category: "ships",
      listingType: "buy_now",
      buyNowPrice: total,
      quantity: 1,
      remainingQuantity: status === "pending" ? 1 : 0,
      status: status === "pending" ? "active" : "sold_out",
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  const [s] = await db
    .insert(bazaarSales)
    .values({
      listingId: l!.id,
      sellerId: seller.id,
      buyerId: buyer.id,
      seasonId: season!.id,
      origin: "buy_now",
      quantity: 1,
      unitPrice: total,
      totalPrice: total,
      status,
      closedAt: status === "completed" ? new Date() : null,
      settleBy: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return s!;
}

// --- the record gate -------------------------------------------------------
const greenGate = await canUseInstalments(db, green.id);
ok("a new account can't use instalments", !greenGate.allowed);

for (let i = 0; i < 5; i++) await mkSale(1_000_000, "completed");
const gate = await canUseInstalments(db, buyer.id);
ok("a buyer with a settlement record can", gate.allowed);

// --- small sales are refused ----------------------------------------------
const small = await mkSale(1_000_000, "pending");
const tooSmall = await proposeInstalmentPlan(db, { saleId: small.id, userId: buyer.id, instalmentCount: 2, intervalDays: 7 });
ok(`sales under ${INSTALMENT_MIN_TOTAL.toLocaleString()} are refused`, !tooSmall.ok);

// --- propose and accept ----------------------------------------------------
const big = await mkSale(40_000_000, "pending");
const bad = await proposeInstalmentPlan(db, { saleId: big.id, userId: buyer.id, instalmentCount: 20, intervalDays: 7 });
ok("more than 12 payments is refused", !bad.ok);

const proposed = await proposeInstalmentPlan(db, { saleId: big.id, userId: buyer.id, instalmentCount: 4, intervalDays: 7 });
ok("a valid schedule is proposed", proposed.ok);

const selfAccept = await respondToInstalmentPlan(db, { planId: proposed.ok ? proposed.planId! : "", userId: buyer.id, action: "accept" });
ok("the proposer can't accept their own schedule", !selfAccept.ok);

const accepted = await respondToInstalmentPlan(db, { planId: proposed.ok ? proposed.planId! : "", userId: seller.id, action: "accept" });
ok("the other side accepts it", accepted.ok);

let plans = await listInstalmentPlans(db, buyer.id);
let plan = plans.find((p) => p.id === (proposed.ok ? proposed.planId : ""))!;
ok("the total equals the sale, not the caller's number", plan.totalAmount === 40_000_000);
ok("the schedule sums to the total", plan.instalments.reduce((s, i) => s + i.amount, 0) === 40_000_000);
ok("rounding lands on the FIRST payment", plan.instalments[0]!.amount >= plan.instalments[3]!.amount);

// --- payments settle in order, both sides ----------------------------------
const outOfOrder = await confirmInstalment(db, { instalmentId: plan.instalments[2]!.id, userId: buyer.id });
ok("payments can't be confirmed out of order", !outOfOrder.ok);

await confirmInstalment(db, { instalmentId: plan.instalments[0]!.id, userId: buyer.id });
let balances = await db.select().from(users).where(eq(users.id, buyer.id));
ok("one confirmation moves no money", balances[0]!.auecBalance === 100_000_000);

await confirmInstalment(db, { instalmentId: plan.instalments[0]!.id, userId: seller.id });
balances = await db.select().from(users).where(eq(users.id, buyer.id));
ok("both confirmations move it", balances[0]!.auecBalance === 100_000_000 - plan.instalments[0]!.amount);

// --- THE important one: goods don't move on a deposit ----------------------
const [saleMid] = await db.select().from(bazaarSales).where(eq(bazaarSales.id, big.id));
ok("the sale is STILL pending after the first payment", saleMid!.status === "pending");

// --- completing the schedule completes the sale ----------------------------
plans = await listInstalmentPlans(db, buyer.id);
plan = plans.find((p) => p.id === (proposed.ok ? proposed.planId : ""))!;
for (const i of plan.instalments.filter((x) => x.status !== "paid")) {
  await confirmInstalment(db, { instalmentId: i.id, userId: buyer.id });
  await confirmInstalment(db, { instalmentId: i.id, userId: seller.id });
}
const [saleDone] = await db.select().from(bazaarSales).where(eq(bazaarSales.id, big.id));
ok("the sale completes only on the final payment", saleDone!.status === "completed");
balances = await db.select().from(users).where(eq(users.id, buyer.id));
ok("the buyer paid exactly the sale price, no more", balances[0]!.auecBalance === 60_000_000);

// --- default --------------------------------------------------------------
const big2 = await mkSale(20_000_000, "pending");
const p2 = await proposeInstalmentPlan(db, { saleId: big2.id, userId: buyer.id, instalmentCount: 4, intervalDays: 7 });
await respondToInstalmentPlan(db, { planId: p2.ok ? p2.planId! : "", userId: seller.id, action: "accept" });
await db.execute(sql`
  UPDATE instalments SET due_at = now() - interval '30 days'
  WHERE plan_id = ${p2.ok ? p2.planId : null}::uuid`);
const defaulted = await expireInstalments(db);
ok("an overdue plan defaults", defaulted === 1);

const [sale2] = await db.select().from(bazaarSales).where(eq(bazaarSales.id, big2.id));
ok("the defaulted sale is cancelled, item stays with the seller", sale2!.status === "cancelled");

const afterDefault = await canUseInstalments(db, buyer.id);
ok("a defaulter can't start another plan", !afterDefault.allowed);

await wipe();
console.log("cleaned up");
await closeDb();
process.exit(0);
