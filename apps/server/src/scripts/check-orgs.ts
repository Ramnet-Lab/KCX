/**
 * End-to-end check of the org model.
 *
 * The rules worth proving, in the order they matter:
 *   - membership is DERIVED from RSI; nobody joins or leaves on KCX
 *   - an unverified org cannot trade at all
 *   - only the presumed leader (highest rank stars) may open a leadership claim
 *   - once verified, the president overrides the star ranking outright
 *   - authority goes stale, so someone who quietly left stops being able to spend
 *   - the board's threshold binds, and the proposer can never supply their own quorum
 *
 * WRITES TO THE DATABASE — creates throwaway accounts and an org, then removes them.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error("check-orgs writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true, dev DB only.");
  process.exit(1);
}

import {
  ORG_AUTHORITY_STALE_DAYS,
  canActForOrg,
  closeDb,
  completeOrgVerification,
  createOrgProposal,
  getDb,
  getOrgBySid,
  liveOrgVerification,
  listOrgMembers,
  modSetOrgSuspended,
  presumedLeader,
  setOrgBoardRules,
  setOrgMemberRole,
  setOrgTreasury,
  startOrgVerification,
  syncMembershipFromProfile,
  transferOrgLeadership,
  users,
  voteOnOrgProposal,
} from "@kcx/db";
import type { RsiProfile } from "@kcx/shared";
import { sql } from "drizzle-orm";

const db = getDb();
const ok = (label: string, cond: boolean) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const SID = "ZZTESTORG";
const HANDLES = sql.join(
  ["_org_boss", "_org_hand", "_org_grunt", "_org_out"].map((h) => sql`${h}`),
  sql`, `,
);
async function wipe() {
  const mine = sql`(SELECT id FROM users WHERE handle IN (${HANDLES}))`;
  await db.execute(sql`DELETE FROM org_proposal_approvals WHERE member_id IN ${mine}`);
  await db.execute(sql`DELETE FROM org_proposals WHERE proposed_by_id IN ${mine}`);
  await db.execute(sql`DELETE FROM org_events WHERE org_id IN (SELECT id FROM orgs WHERE sid IN (${sql`${SID}`}, ${sql`${"ZZOTHER"}`}))`);
  await db.execute(sql`DELETE FROM org_verifications WHERE claimant_id IN ${mine}`);
  await db.execute(sql`DELETE FROM org_members WHERE user_id IN ${mine}`);
  await db.execute(sql`DELETE FROM orgs WHERE sid IN (${sql`${SID}`}, ${sql`${"ZZOTHER"}`})`);
  await db.execute(sql`DELETE FROM users WHERE handle IN (${HANDLES})`);
}
await wipe();

async function mkUser(handle: string) {
  const [u] = await db
    .insert(users)
    .values({ handle, displayName: handle, isVerified: true, rsiVerifiedAt: new Date(), auecBalance: 0 })
    .returning();
  return u!;
}
const boss = await mkUser("_org_boss");
const hand = await mkUser("_org_hand");
const grunt = await mkUser("_org_grunt");
const outsider = await mkUser("_org_out");

/** A dossier reading, as the parser would produce it. */
const profile = (sid: string | null, rank: string | null, stars: number | null): RsiProfile => ({
  handle: "x",
  displayName: "x",
  bio: null,
  enlistedAt: new Date("2015-01-01"),
  citizenRecord: null,
  mainOrgSid: sid,
  avatarUrl: null,
  mainOrgName: sid ? "Test Org" : null,
  mainOrgRank: rank,
  mainOrgRankStars: stars,
  mainOrgLogoUrl: null,
  mainOrgVisibility: sid ? "visible" : "none",
});

// --- the roster is derived -------------------------------------------------
await syncMembershipFromProfile(db, { userId: hand.id, profile: profile(SID, "Beta", 3) });
let org = await getOrgBySid(db, SID, hand.id);
ok("an org appears from the first member's profile", !!org && org.status === "derived");
ok("and it cannot trade yet", org?.canTrade === false);

await syncMembershipFromProfile(db, { userId: boss.id, profile: profile(SID, "Alpha", 5) });
await syncMembershipFromProfile(db, { userId: grunt.id, profile: profile(SID, "Recruit", 1) });
const roster = await listOrgMembers(db, org!.id);
ok("everyone naming it lands on the roster", roster.length === 3);
ok("ranks come off the dossier", roster.find((m) => m.userId === boss.id)?.rsiRankStars === 5);

const orgId = org!.id;
const gateBefore = await canActForOrg(db, { orgId, userId: boss.id, amount: 1 });
ok("an unverified org can't spend at all", !gateBefore.allowed);
ok("and it says why", (gateBefore.reason ?? "").includes("leadership"));

// --- the claim belongs to the highest-ranked member -------------------------
ok("the presumed leader is the highest-ranked", (await presumedLeader(db, orgId)) === boss.id);
const wrongClaim = await startOrgVerification(db, { orgId, claimantId: grunt.id, code: "KCXORG-AAA-AAA" });
ok("a junior member can't open the claim", !wrongClaim.ok);

const claim = await startOrgVerification(db, { orgId, claimantId: boss.id, code: "KCXORG-AAA-AAA" });
ok("the presumed leader can", claim.ok);
const live = await liveOrgVerification(db, orgId);
ok("the claim is live", live?.claimantId === boss.id);

// The charter fetch itself is exercised by hand; here we take the code as found.
await completeOrgVerification(db, { verificationId: live!.id, logoFilename: null });
org = await getOrgBySid(db, SID, boss.id);
ok("verifying makes the claimant president", org?.charterHolderId === boss.id && org?.myRole === "president");
ok("and the org can now trade", org?.canTrade === true);

// --- the president overrides the ranking ------------------------------------
await setOrgTreasury(db, { orgId, actorId: boss.id, treasury: 100_000_000 });
const notPresident = await setOrgTreasury(db, { orgId, actorId: hand.id, treasury: 5 });
ok("nobody else can set the treasury", !notPresident.ok);

await setOrgMemberRole(db, { orgId, actorId: boss.id, userId: grunt.id, role: "treasurer", spendLimit: 10_000_000 });
const gruntGate = await canActForOrg(db, { orgId, userId: grunt.id, amount: 5_000_000 });
ok("the president can promote the LOWEST-ranked member to treasurer", gruntGate.allowed);
const gruntOver = await canActForOrg(db, { orgId, userId: grunt.id, amount: 50_000_000 });
ok("their delegated limit still binds", !gruntOver.allowed);

const handGate = await canActForOrg(db, { orgId, userId: hand.id, amount: 1 });
ok("a plain member can't spend despite 3 stars", !handGate.allowed);

const selfPromote = await setOrgMemberRole(db, { orgId, actorId: hand.id, userId: hand.id, role: "treasurer" });
ok("members can't promote themselves", !selfPromote.ok);

const addOutsider = await setOrgMemberRole(db, { orgId, actorId: boss.id, userId: outsider.id, role: "treasurer" });
ok("you can't add somebody who isn't on the RSI roster", !addOutsider.ok);

// --- authority goes stale ---------------------------------------------------
await db.execute(sql`
  UPDATE org_members SET confirmed_at = now() - interval '${sql.raw(String(ORG_AUTHORITY_STALE_DAYS + 5))} days'
  WHERE org_id = ${orgId}::uuid AND user_id = ${grunt.id}::uuid`);
const stale = await canActForOrg(db, { orgId, userId: grunt.id, amount: 1_000_000 });
ok("stale authority stops spending", !stale.allowed);
await syncMembershipFromProfile(db, { userId: grunt.id, profile: profile(SID, "Recruit", 1) });
const refreshed = await canActForOrg(db, { orgId, userId: grunt.id, amount: 1_000_000 });
ok("re-verifying restores it", refreshed.allowed);

// --- leaving the org --------------------------------------------------------
await syncMembershipFromProfile(db, { userId: hand.id, profile: profile("ZZOTHER", "Grunt", 1) });
const afterLeave = await listOrgMembers(db, orgId);
ok("naming a different org removes you from the old roster", !afterLeave.some((m) => m.userId === hand.id));

// --- the board --------------------------------------------------------------
await setOrgMemberRole(db, { orgId, actorId: boss.id, userId: grunt.id, isBoardMember: true });
await setOrgBoardRules(db, { orgId, actorId: boss.id, threshold: 1, minValue: 1_000_000 });

const small = await canActForOrg(db, { orgId, userId: grunt.id, amount: 500_000 });
ok("below the minimum the board isn't involved", small.allowed && !small.needsBoard);
const big = await canActForOrg(db, { orgId, userId: grunt.id, amount: 5_000_000 });
ok("at or above it, the board is", big.allowed && big.needsBoard && big.requiredApprovals === 1);

const proposal = await createOrgProposal(db, {
  orgId,
  proposedById: grunt.id,
  kind: "bazaar_listing",
  value: 5_000_000,
  summary: "test",
  payload: {},
  requiredApprovals: big.requiredApprovals,
});
ok("a proposal opens", proposal.ok);
const pid = proposal.ok ? proposal.proposalId : "";

const selfVote = await voteOnOrgProposal(db, { proposalId: pid, userId: grunt.id, approve: true });
ok("the proposer can't vote on their own proposal", !selfVote.ok);
const outsiderVote = await voteOnOrgProposal(db, { proposalId: pid, userId: outsider.id, approve: true });
ok("a non-board member can't vote", !outsiderVote.ok);

const bossVote = await voteOnOrgProposal(db, { proposalId: pid, userId: boss.id, approve: true });
ok("a board member carries it", bossVote.ok && bossVote.readyToExecute);

const held = await canActForOrg(db, { orgId, userId: boss.id, amount: 100_000_000 });
ok("an open proposal holds the treasury against it", !held.allowed);

// --- suspension -------------------------------------------------------------
await modSetOrgSuspended(db, { orgId, moderatorId: boss.id, suspended: true, reason: "test" });
const suspended = await canActForOrg(db, { orgId, userId: boss.id, amount: 1 });
ok("a suspended org stops trading", !suspended.allowed);
await modSetOrgSuspended(db, { orgId, moderatorId: boss.id, suspended: false });

// --- leadership transfer ----------------------------------------------------
const moved = await transferOrgLeadership(db, { orgId, actorId: boss.id, toUserId: grunt.id });
ok("the president can hand leadership on", moved.ok);
const afterMove = await getOrgBySid(db, SID, grunt.id);
ok("and the successor is president", afterMove?.charterHolderId === grunt.id && afterMove?.myRole === "president");

await wipe();
console.log("cleaned up");
await closeDb();
process.exit(0);
