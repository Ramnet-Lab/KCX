import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  FEEDBACK_TITLE_MAX,
  MESSAGE_BODY_MAX,
  MESSAGE_KINDS,
} from "@kcx/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./orders";

/**
 * Feature requests, and the inbox that carries the answer back.
 *
 * Two tables rather than one thread, because they are not the same object. A request is a
 * thing somebody asked for and that a moderator triages; a message is a thing delivered to
 * one person's inbox. Modelling the answer as "a reply row on the request" would mean the
 * only way to tell a trader anything is to invent a request for them to have made.
 *
 * The inbox is therefore generic from the start: `user_messages` carries a subject, a body,
 * and an optional link, and knows nothing about feature requests beyond an optional foreign
 * key back to the one that prompted it. Anything else that needs to reach a specific person
 * — a moderation note, a settlement warning — uses the same table instead of growing a
 * second notification system next to it.
 *
 * Distinct from `price_alerts`, which is a machine-generated feed of things that happened to
 * the market and is read as a batch. These are addressed to you by a person, so they carry
 * per-message read state and are kept until you delete them.
 *
 * Requests are signed-in only. There is no way to answer an anonymous idea, and an
 * unauthenticated box on the front page is a spam endpoint with extra steps.
 */

/**
 * The value lists live in `@kcx/shared` because the front-page panel and the moderator
 * console both need them in the browser; re-declaring them here is how the two copies would
 * drift. See packages/shared/src/feedback.ts for what each one means.
 */
export {
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  FEEDBACK_TITLE_MAX,
  FEEDBACK_BODY_MAX,
  MESSAGE_KINDS,
} from "@kcx/shared";

export const featureRequests = pgTable(
  "feature_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: FEEDBACK_KINDS }).notNull().default("idea"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: FEEDBACK_STATUSES }).notNull().default("new"),

    /** Who last touched it, so the queue shows whether a colleague is already on it. */
    reviewedById: uuid("reviewed_by_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /**
     * When an answer was last sent.
     *
     * Separate from `reviewedAt` because triaging is not replying, and the thing the author
     * is waiting on is the reply. The queue badge counts requests nobody has answered.
     */
    respondedAt: timestamp("responded_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The moderator queue reads by status, oldest first. */
    index("feature_requests_queue").on(t.status, t.createdAt),
    /** One author's own list, and the count the daily cap is checked against. */
    index("feature_requests_author").on(t.authorId, t.createdAt),
    check(
      "feature_requests_title_length",
      sql`char_length(${t.title}) BETWEEN 3 AND ${sql.raw(String(FEEDBACK_TITLE_MAX))}`,
    ),
    check(
      "feature_requests_body_length",
      sql`char_length(${t.body}) BETWEEN 5 AND ${sql.raw(String(FEEDBACK_BODY_MAX))}`,
    ),
  ],
);

export const userMessages = pgTable(
  "user_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    /** Null for anything the exchange itself sent — there is no fake account to attribute it to. */
    senderId: uuid("sender_id").references(() => users.id),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull().default("system"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** Optional deep link — where the message is actually about. */
    href: text("href"),
    /** The request this answers, when there is one. */
    requestId: uuid("request_id").references(() => featureRequests.id),

    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * Soft delete.
     *
     * The recipient clearing their inbox should not erase the record that a moderator sent
     * something — the audit log names the action, and this is the text of it.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_messages_inbox").on(t.recipientId, t.createdAt),
    /** The header badge counts this, on every page load, for every signed-in visitor. */
    index("user_messages_unread")
      .on(t.recipientId)
      .where(sql`${t.readAt} IS NULL AND ${t.deletedAt} IS NULL`),
    check("user_messages_subject_length", sql`char_length(${t.subject}) BETWEEN 1 AND 200`),
    check(
      "user_messages_body_length",
      sql`char_length(${t.body}) BETWEEN 1 AND ${sql.raw(String(MESSAGE_BODY_MAX))}`,
    ),
    /** Nobody messages themselves; a self-addressed row is a bug, not a use case. */
    check("user_messages_distinct_parties", sql`${t.senderId} IS NULL OR ${t.senderId} <> ${t.recipientId}`),
  ],
);
