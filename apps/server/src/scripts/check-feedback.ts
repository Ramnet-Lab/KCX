/**
 * End-to-end check of the suggestion box and the inbox that answers it.
 *
 * The rules worth proving, in the order they matter:
 *   - anyone signed in can file, but not without end — the daily cap binds
 *   - a reply reaches the AUTHOR's inbox and nobody else's
 *   - replying stamps the request answered, so it leaves the "waiting" count
 *   - the unread count is what the header badge shows, and reading clears it
 *   - one person can never read, clear, or delete another person's mail
 *   - a deleted message leaves the inbox but not the database
 *
 * WRITES TO THE DATABASE — creates throwaway accounts, then removes them.
 */
import { loadRootEnv } from "../env";
loadRootEnv();

if (process.env.ALLOW_DESTRUCTIVE_CHECKS !== "true") {
  console.error("check-feedback writes and deletes rows. Set ALLOW_DESTRUCTIVE_CHECKS=true, dev DB only.");
  process.exit(1);
}

import {
  closeDb,
  deleteMessage,
  feedbackQueue,
  getDb,
  listInbox,
  listMyFeatureRequests,
  markMessagesRead,
  moderationOverview,
  respondToFeatureRequest,
  setFeedbackStatus,
  submitFeatureRequest,
  unansweredFeedbackCount,
  unreadMessageCount,
  users,
} from "@kcx/db";
import { FEEDBACK_DAILY_LIMIT } from "@kcx/shared";
import { sql } from "drizzle-orm";

const db = getDb();
const ok = (label: string, cond: boolean) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const HANDLES = sql.join(["_fb_author", "_fb_other", "_fb_mod"].map((h) => sql`${h}`), sql`, `);

async function wipe() {
  const mine = sql`(SELECT id FROM users WHERE handle IN (${HANDLES}))`;
  await db.execute(sql`DELETE FROM user_messages WHERE recipient_id IN ${mine} OR sender_id IN ${mine}`);
  await db.execute(sql`DELETE FROM moderation_actions WHERE moderator_id IN ${mine} OR target_user_id IN ${mine}`);
  await db.execute(sql`DELETE FROM feature_requests WHERE author_id IN ${mine} OR reviewed_by_id IN ${mine}`);
  await db.execute(sql`DELETE FROM users WHERE handle IN (${HANDLES})`);
}
await wipe();

async function mkUser(handle: string, role: "user" | "mod" = "user") {
  const [u] = await db
    .insert(users)
    .values({ handle, displayName: handle, role, isVerified: true, auecBalance: 0 })
    .returning();
  return u!;
}
const author = await mkUser("_fb_author");
const other = await mkUser("_fb_other");
const mod = await mkUser("_fb_mod", "mod");

// --- filing -----------------------------------------------------------------

const filed = await submitFeatureRequest(db, {
  authorId: author.id,
  kind: "feature",
  title: "Show cargo capacity on the order board",
  body: "So I can tell at a glance whether a lot fits in one run.",
});
ok("an idea can be filed", filed.ok);
const requestId = filed.ok ? filed.id : "";

const tooShort = await submitFeatureRequest(db, { authorId: author.id, kind: "idea", title: "hm", body: "x" });
ok("a two-character title is refused", !tooShort.ok && tooShort.reason === "invalid");

// Fill the day's allowance. One is already spent, so the cap is reached FEEDBACK_DAILY_LIMIT-1 later.
for (let i = 1; i < FEEDBACK_DAILY_LIMIT; i++) {
  await submitFeatureRequest(db, { authorId: author.id, kind: "idea", title: `Filler ${i}`, body: "padding text" });
}
const capped = await submitFeatureRequest(db, {
  authorId: author.id,
  kind: "idea",
  title: "One too many",
  body: "this should bounce off the daily cap",
});
ok(`the ${FEEDBACK_DAILY_LIMIT}-a-day cap binds`, !capped.ok && capped.reason === "rate_limit");

const otherCanStillFile = await submitFeatureRequest(db, {
  authorId: other.id,
  kind: "bug",
  title: "The chart is blank on a fresh database",
  body: "Nothing renders until the first ingest runs.",
});
ok("the cap is per person, not global", otherCanStillFile.ok);

// --- the queue --------------------------------------------------------------

const queue = await feedbackQueue(db);
const mine = queue.find((q) => q.id === requestId);
ok("the request reaches the moderator queue", !!mine);
ok("it arrives as new, with the author attached", mine?.status === "new" && mine?.authorHandle === "_fb_author");
ok("and with no reply on it yet", mine?.replies.length === 0 && mine?.respondedAt === null);
ok("the queue is oldest first", queue.length > 1 && queue[0]!.createdAt <= queue[queue.length - 1]!.createdAt);

const waitingBefore = await unansweredFeedbackCount(db);

// --- answering --------------------------------------------------------------

const empty = await respondToFeatureRequest(db, { moderatorId: mod.id, requestId, body: "" });
ok("an empty reply is refused", !empty.ok);

const missing = await respondToFeatureRequest(db, {
  moderatorId: mod.id,
  requestId: "00000000-0000-0000-0000-000000000000",
  body: "into the void",
});
ok("replying to a request that isn't there fails", !missing.ok);

const replied = await respondToFeatureRequest(db, {
  moderatorId: mod.id,
  requestId,
  body: "Good call — it's on the list for the next board pass.",
  status: "planned",
});
ok("a moderator can reply", replied.ok);

const waitingAfter = await unansweredFeedbackCount(db);
ok("answering takes it out of the waiting count", waitingAfter === waitingBefore - 1);

const overview = await moderationOverview(db);
ok("the console's overview counts the same thing", overview.unansweredFeedback === waitingAfter);

const answered = await feedbackQueue(db);
const now = answered.find((q) => q.id === requestId);
ok("the request is now planned and stamped answered", now?.status === "planned" && now?.respondedAt !== null);
ok("the reply is visible from the moderator's side", now?.replies.length === 1);
ok("with the moderator's name on it", now?.replies[0]?.senderName === "_fb_mod");

const mineNow = await listMyFeatureRequests(db, author.id);
ok("the author sees the new status on their own list", mineNow.find((r) => r.id === requestId)?.status === "planned");

// --- the inbox --------------------------------------------------------------

const inbox = await listInbox(db, author.id);
ok("the reply lands in the author's inbox", inbox.length === 1);
ok("subject quotes the request", inbox[0]?.subject === "Re: Show cargo capacity on the order board");
ok("and it arrives unread", inbox[0]?.read === false);

const otherInbox = await listInbox(db, other.id);
ok("it lands in NOBODY else's inbox", otherInbox.length === 0);

ok("the badge counts one unread", (await unreadMessageCount(db, author.id)) === 1);
ok("and zero for everyone else", (await unreadMessageCount(db, other.id)) === 0);

const messageId = inbox[0]!.id;

await markMessagesRead(db, other.id, messageId);
ok("a stranger can't mark someone else's mail read", (await unreadMessageCount(db, author.id)) === 1);

const stolen = await deleteMessage(db, other.id, messageId);
ok("nor delete it", !stolen && (await listInbox(db, author.id)).length === 1);

await markMessagesRead(db, author.id, messageId);
ok("the recipient can read it", (await unreadMessageCount(db, author.id)) === 0);
ok("and it stays in the list once read", (await listInbox(db, author.id))[0]?.read === true);

// A second reply on the same request, to prove the badge comes back.
await respondToFeatureRequest(db, { moderatorId: mod.id, requestId, body: "Shipped it — have a look." });
ok("a follow-up reply lights the badge again", (await unreadMessageCount(db, author.id)) === 1);
await markMessagesRead(db, author.id);
ok("mark-all-read clears the lot", (await unreadMessageCount(db, author.id)) === 0);

const removed = await deleteMessage(db, author.id, messageId);
ok("the recipient can clear a message", removed && (await listInbox(db, author.id)).length === 1);

const kept = await db.execute<{ n: string }>(
  sql`SELECT count(*)::text AS n FROM user_messages WHERE id = ${messageId}::uuid AND deleted_at IS NOT NULL`,
);
ok("but the row survives for the record", kept.rows[0]?.n === "1");

const twice = await deleteMessage(db, author.id, messageId);
ok("deleting it again is a no-op", !twice);

// --- triage without writing -------------------------------------------------

const otherId = otherCanStillFile.ok ? otherCanStillFile.id : "";
const filedOnly = await setFeedbackStatus(db, { moderatorId: mod.id, requestId: otherId, status: "declined" });
ok("a request can be re-filed without a reply", filedOnly.ok);
ok("and that sends no mail", (await listInbox(db, other.id)).length === 0);
const noop = await setFeedbackStatus(db, { moderatorId: mod.id, requestId: otherId, status: "declined" });
ok("re-filing it as what it already is fails", !noop.ok);

const logged = await db.execute<{ n: string }>(sql`
  SELECT count(*)::text AS n FROM moderation_actions
   WHERE moderator_id = ${mod.id}::uuid AND action IN ('feedback_answered','feedback_triaged')
`);
ok("every moderator action is in the audit log", Number(logged.rows[0]?.n ?? 0) === 3);

await wipe();
console.log("cleaned up");
await closeDb();
process.exit(0);
