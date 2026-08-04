import { bigserial, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./orders";

/**
 * Moderation audit trail.
 *
 * Append-only and never deleted, because the point of moderator powers is that they can be
 * reviewed afterwards. Every action a mod takes lands here with who did it, to whom, and why
 * — including the ones that turn out to be wrong.
 */

export const MODERATION_TARGETS = ["user", "contract", "breach", "order"] as const;

export const MODERATION_ACTIONS = [
  "breach_upheld",
  "breach_dismissed",
  "contract_voided",
  "user_banned",
  "user_unbanned",
  "role_granted",
  "role_revoked",
  "note",
] as const;

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    moderatorId: uuid("moderator_id")
      .notNull()
      .references(() => users.id),
    action: text("action", { enum: MODERATION_ACTIONS }).notNull(),
    targetType: text("target_type", { enum: MODERATION_TARGETS }).notNull(),
    /** Text rather than uuid: targets live in different tables with different key types. */
    targetId: text("target_id").notNull(),
    /** The person affected, when there is one — lets a user's history be pulled in one query. */
    targetUserId: uuid("target_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_actions_recent").on(t.createdAt),
    index("moderation_actions_target_user").on(t.targetUserId, t.createdAt),
  ],
);
