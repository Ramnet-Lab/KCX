import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_TITLE_MAX,
  MESSAGE_BODY_MAX,
  type FeedbackKind,
  type FeedbackStatus,
} from "@kcx/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { featureRequests, userMessages } from "../schema/feedback";
import { logModerationAction } from "./moderation";

/**
 * The suggestion box and the inbox that answers it.
 *
 * Every reply is written in the same transaction as the status change it accompanies, for
 * the same reason moderator actions are: an answer the author never receives, or a request
 * marked answered with nothing sent, are both worse than the operation failing outright.
 */

export type { FeedbackKind, FeedbackStatus };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// ---------------------------------------------------------------- submitting

export type MyFeatureRequest = {
  id: string;
  kind: FeedbackKind;
  title: string;
  status: FeedbackStatus;
  createdAt: string;
  respondedAt: string | null;
};

/**
 * Post an idea.
 *
 * The daily cap is the only gate. Length is checked here as well as by the column
 * constraints, so an over-long body comes back as a sentence rather than a 500.
 */
export type SubmitResult =
  | { ok: true; id: string }
  /** `reason` so the route can answer 400 vs 429 without reading the sentence. */
  | { ok: false; reason: "invalid" | "rate_limit"; error: string };

export async function submitFeatureRequest(
  db: Db,
  opts: { authorId: string; kind: FeedbackKind; title: string; body: string },
): Promise<SubmitResult> {
  const title = opts.title.trim();
  const body = opts.body.trim();
  const invalid = (error: string) => ({ ok: false as const, reason: "invalid" as const, error });
  if (title.length < 3) return invalid("Give it a title — a few words is plenty");
  if (title.length > FEEDBACK_TITLE_MAX) return invalid(`Title is over ${FEEDBACK_TITLE_MAX} characters`);
  if (body.length < 5) return invalid("Say a little more about what you want");
  if (body.length > FEEDBACK_BODY_MAX) return invalid(`That's over ${FEEDBACK_BODY_MAX} characters`);

  const since = new Date(Date.now() - 86_400_000);
  const [recent] = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(featureRequests)
    .where(and(eq(featureRequests.authorId, opts.authorId), gt(featureRequests.createdAt, since)));
  if (Number(recent?.n ?? 0) >= FEEDBACK_DAILY_LIMIT) {
    return {
      ok: false,
      reason: "rate_limit",
      error: `That's ${FEEDBACK_DAILY_LIMIT} today — the box reopens tomorrow`,
    };
  }

  const [row] = await db
    .insert(featureRequests)
    .values({ authorId: opts.authorId, kind: opts.kind, title, body })
    .returning({ id: featureRequests.id });
  return { ok: true, id: row!.id };
}

/** The author's own submissions, so the panel can show what became of them. */
export async function listMyFeatureRequests(db: Db, authorId: string, limit = 10): Promise<MyFeatureRequest[]> {
  const rows = await db
    .select({
      id: featureRequests.id,
      kind: featureRequests.kind,
      title: featureRequests.title,
      status: featureRequests.status,
      createdAt: featureRequests.createdAt,
      respondedAt: featureRequests.respondedAt,
    })
    .from(featureRequests)
    .where(eq(featureRequests.authorId, authorId))
    .orderBy(sql`${featureRequests.createdAt} DESC`)
    .limit(Math.min(limit, 50));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
  }));
}

// ---------------------------------------------------------------- the queue

export type FeedbackQueueItem = {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  createdAt: string;
  respondedAt: string | null;
  authorId: string;
  authorName: string;
  authorHandle: string;
  /** How many times this author has posted, so a queue of twelve from one person is visible. */
  authorRequests: number;
  reviewedByName: string | null;
  /** Replies already sent on this request, newest last. */
  replies: { body: string; senderName: string | null; createdAt: string }[];
};

/**
 * The review queue, oldest first — same working order as the breach queue, and for the same
 * reason: the thing that has been waiting longest is the thing most likely to be forgotten.
 */
export async function feedbackQueue(
  db: Db,
  opts: { includeClosed?: boolean; limit?: number } = {},
): Promise<FeedbackQueueItem[]> {
  const res = await db.execute<{
    id: string; kind: FeedbackKind; title: string; body: string; status: FeedbackStatus;
    created_at: string | Date; responded_at: string | Date | null;
    author_id: string; author_name: string; author_handle: string; author_requests: number;
    reviewed_by_name: string | null;
    replies: { body: string; sender_name: string | null; created_at: string }[] | null;
  }>(sql`
    SELECT fr.id::text, fr.kind, fr.title, fr.body, fr.status, fr.created_at, fr.responded_at,
           fr.author_id::text, a.display_name AS author_name, a.handle AS author_handle,
           (SELECT count(*) FROM feature_requests x WHERE x.author_id = fr.author_id)::int AS author_requests,
           rev.display_name AS reviewed_by_name,
           (SELECT coalesce(json_agg(json_build_object(
                     'body', m.body,
                     'sender_name', s.display_name,
                     'created_at', m.created_at
                   ) ORDER BY m.created_at), '[]'::json)
              FROM user_messages m
              LEFT JOIN users s ON s.id = m.sender_id
             WHERE m.request_id = fr.id) AS replies
      FROM feature_requests fr
      JOIN users a ON a.id = fr.author_id
      LEFT JOIN users rev ON rev.id = fr.reviewed_by_id
     ${opts.includeClosed ? sql`` : sql`WHERE fr.status IN ('new','reviewing','planned')`}
     ORDER BY fr.created_at ASC
     LIMIT ${Math.min(opts.limit ?? 200, 500)}
  `);
  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null,
    authorId: r.author_id,
    authorName: r.author_name,
    authorHandle: r.author_handle,
    authorRequests: r.author_requests,
    reviewedByName: r.reviewed_by_name,
    replies: (r.replies ?? []).map((m) => ({
      body: m.body,
      senderName: m.sender_name,
      createdAt: new Date(m.created_at).toISOString(),
    })),
  }));
}

/** Requests nobody has answered yet — the number on the moderator's tab. */
export async function unansweredFeedbackCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(featureRequests)
    .where(and(isNull(featureRequests.respondedAt), sql`${featureRequests.status} IN ('new','reviewing','planned')`));
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------- answering

/**
 * Reply to a request, optionally moving its status in the same breath.
 *
 * The reply lands in the author's inbox, the request is stamped answered, and the moderator
 * log records that it happened — all or nothing. `status` of null leaves the status alone,
 * which is the case where a moderator is asking the author a question rather than ruling.
 */
export async function respondToFeatureRequest(
  db: Db,
  opts: { moderatorId: string; requestId: string; body: string; status?: FeedbackStatus | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = opts.body.trim();
  if (body.length < 2) return { ok: false, error: "Write something to send" };
  if (body.length > MESSAGE_BODY_MAX) {
    return { ok: false, error: `That reply is over ${MESSAGE_BODY_MAX} characters` };
  }

  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(featureRequests).where(eq(featureRequests.id, opts.requestId)).for("update");
    if (!req) return { ok: false as const, error: "No such request" };
    if (req.authorId === opts.moderatorId) {
      return { ok: false as const, error: "That's your own request — nothing to deliver" };
    }

    const status = opts.status ?? req.status;
    const now = new Date();

    await tx.insert(userMessages).values({
      recipientId: req.authorId,
      senderId: opts.moderatorId,
      kind: "feedback_reply",
      subject: `Re: ${req.title}`.slice(0, 200),
      body,
      href: "/account#inbox",
      requestId: req.id,
    });

    await tx
      .update(featureRequests)
      .set({
        status,
        respondedAt: now,
        reviewedById: opts.moderatorId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(featureRequests.id, req.id));

    await logModerationAction(tx as Tx, {
      moderatorId: opts.moderatorId,
      action: "feedback_answered",
      targetType: "feature_request",
      targetId: req.id,
      targetUserId: req.authorId,
      reason: status === req.status ? null : `[${req.status} → ${status}]`,
    });
    return { ok: true as const };
  });
}

/** Move a request between statuses without writing to the author. */
export async function setFeedbackStatus(
  db: Db,
  opts: { moderatorId: string; requestId: string; status: FeedbackStatus },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(featureRequests).where(eq(featureRequests.id, opts.requestId)).for("update");
    if (!req) return { ok: false as const, error: "No such request" };
    if (req.status === opts.status) return { ok: false as const, error: `Already ${opts.status}` };

    await tx
      .update(featureRequests)
      .set({
        status: opts.status,
        reviewedById: opts.moderatorId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(featureRequests.id, req.id));

    await logModerationAction(tx as Tx, {
      moderatorId: opts.moderatorId,
      action: "feedback_triaged",
      targetType: "feature_request",
      targetId: req.id,
      targetUserId: req.authorId,
      reason: `[${req.status} → ${opts.status}]`,
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- the inbox

export type InboxMessageDto = {
  id: string;
  kind: (typeof userMessages.$inferSelect)["kind"];
  subject: string;
  body: string;
  href: string | null;
  senderName: string | null;
  read: boolean;
  createdAt: string;
};

export async function listInbox(db: Db, userId: string, limit = 100): Promise<InboxMessageDto[]> {
  const res = await db.execute<{
    id: string; kind: InboxMessageDto["kind"]; subject: string; body: string; href: string | null;
    sender_name: string | null; read_at: string | Date | null; created_at: string | Date;
  }>(sql`
    SELECT m.id::text, m.kind, m.subject, m.body, m.href, m.read_at, m.created_at,
           s.display_name AS sender_name
      FROM user_messages m
      LEFT JOIN users s ON s.id = m.sender_id
     WHERE m.recipient_id = ${userId}::uuid
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT ${Math.min(limit, 200)}
  `);
  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    href: r.href,
    senderName: r.sender_name,
    read: r.read_at != null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * How many unread messages are waiting.
 *
 * Called on every session read, so it is a partial-index count and nothing else. A badge
 * that costs a join is a badge that slows down every page on the site.
 */
export async function unreadMessageCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(userMessages)
    .where(
      and(
        eq(userMessages.recipientId, userId),
        isNull(userMessages.readAt),
        isNull(userMessages.deletedAt),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Mark one message read, or all of them when `messageId` is omitted. */
export async function markMessagesRead(db: Db, userId: string, messageId?: string): Promise<void> {
  await db
    .update(userMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(userMessages.recipientId, userId),
        isNull(userMessages.readAt),
        isNull(userMessages.deletedAt),
        messageId ? eq(userMessages.id, messageId) : undefined,
      ),
    );
}

/**
 * Clear a message from the recipient's view.
 *
 * Scoped to the recipient in the WHERE clause rather than checked first — a caller passing
 * somebody else's message id updates nothing instead of racing a check.
 */
export async function deleteMessage(db: Db, userId: string, messageId: string): Promise<boolean> {
  const rows = await db
    .update(userMessages)
    .set({ deletedAt: new Date(), readAt: sql`coalesce(${userMessages.readAt}, now())` })
    .where(
      and(
        eq(userMessages.id, messageId),
        eq(userMessages.recipientId, userId),
        isNull(userMessages.deletedAt),
      ),
    )
    .returning({ id: userMessages.id });
  return rows.length > 0;
}
