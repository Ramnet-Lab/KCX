/**
 * The suggestion box, and the inbox that answers it.
 *
 * These live here rather than in the schema package for the same reason the bazaar's
 * categories do: the panel on the front page and the moderator console both render them in
 * the browser, and importing them from `@kcx/db` would drag the database client into the
 * client bundle. `packages/db/src/schema/feedback.ts` re-exports them so the columns and the
 * form can never disagree about what a valid value is.
 */

/** What was submitted. Bug reports arrive in an idea box whether or not it invites them. */
export const FEEDBACK_KINDS = ["idea", "feature", "bug"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  idea: "Idea",
  feature: "Feature request",
  bug: "Something's broken",
};

/**
 * Where a request has got to.
 *
 * `declined` is a decision and not a deletion — the author is told, and the record of the
 * answer stays. A suggestion box that silently swallows what it won't build teaches people
 * not to use it.
 */
export const FEEDBACK_STATUSES = ["new", "reviewing", "planned", "shipped", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  reviewing: "Looking at it",
  planned: "Planned",
  shipped: "Shipped",
  declined: "Not planned",
};

/** Where an inbox message came from, so the UI can label it without parsing the body. */
export const MESSAGE_KINDS = ["feedback_reply", "moderation", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  feedback_reply: "Reply to your idea",
  moderation: "From the moderators",
  system: "From the exchange",
};

/** Per person, per day. A cap the honest user never notices and a script hits immediately. */
export const FEEDBACK_DAILY_LIMIT = 5;

export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_BODY_MAX = 4000;
export const MESSAGE_BODY_MAX = 4000;
