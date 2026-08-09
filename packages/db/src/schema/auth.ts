import { sql } from "drizzle-orm";
import { bigserial, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./orders";

/**
 * Authentication: RSI account ownership is the identity, a passkey is the key.
 *
 * Star Citizen has no OAuth, so we can't authenticate *through* RSI. What we can do is prove
 * someone CONTROLS an RSI account: issue a one-time code, have them paste it into their public
 * profile bio, then read that profile. Only the account holder can do that.
 *
 * Because that proof can be repeated on demand, it doubles as account recovery — which is why
 * this design needs no email address, no password, and no third-party sign-in provider.
 */

export const VERIFICATION_STATUSES = ["pending", "verified", "failed", "expired"] as const;

/** Codes are short and unambiguous — they get typed into a game-website bio by hand. */
export const rsiVerifications = pgTable(
  "rsi_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null until the account exists: signup verifies BEFORE a user row is created. */
    userId: uuid("user_id").references(() => users.id),
    handle: text("handle").notNull(),
    code: text("code").notNull(),
    status: text("status", { enum: VERIFICATION_STATUSES }).notNull().default("pending"),
    /** Rate-limits polling of RSI's servers per verification attempt. */
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /**
     * Set when this verification has been spent on a privileged action — currently a
     * password reset. Proving the RSI bio is what replaces knowing the old password, and
     * one proof should authorise one reset, not stay live for the rest of its window.
     */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rsi_verif_handle").on(t.handle),
    index("rsi_verif_pending").on(t.handle).where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Registered passkeys (WebAuthn credentials). A trader may enrol several — laptop, phone,
 * hardware key — and losing all of them is survivable via a fresh RSI bio verification.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    /** Base64url credential ID from the authenticator. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    /** Signature counter — a decrease signals a cloned authenticator. */
    counter: integer("counter").notNull().default(0),
    transports: text("transports").array(),
    /** Human label so a trader can tell their devices apart when revoking one. */
    deviceName: text("device_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("passkeys_user").on(t.userId)],
);

/** Short-lived WebAuthn challenges; single-use and deleted on consumption. */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challenge: text("challenge").notNull(),
    purpose: text("purpose", { enum: ["register", "login"] }).notNull(),
    userId: uuid("user_id").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webauthn_challenge_lookup").on(t.challenge)],
);

/**
 * Sessions. The cookie carries an opaque random token; only its hash is stored, so a database
 * leak doesn't hand out live sessions.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Salted hash only — never the raw address (privacy policy commitment). */
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [index("auth_sessions_user").on(t.userId)],
);

/** Audit trail for sign-ins and verification attempts; feeds moderation and alt detection. */
export const authEvents = pgTable(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    handle: text("handle"),
    type: text("type", {
      enum: [
        "verification_started",
        "verification_succeeded",
        "verification_failed",
        "account_created",
        "passkey_registered",
        "passkey_revoked",
        "login",
        "login_failed",
        "password_set",
        "password_removed",
        "logout",
        /** An admin stepped into, or back out of, another trader's account. */
        "impersonation_started",
        "impersonation_ended",
      ],
    }).notNull(),
    detail: text("detail"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_events_user").on(t.userId, t.createdAt)],
);
