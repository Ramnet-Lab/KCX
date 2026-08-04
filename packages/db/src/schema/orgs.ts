import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./orders";

/**
 * Orgs as economic actors.
 *
 * Orgs are the real economic units in Star Citizen — fleets buy together, mining crews sell
 * together, and the aUEC that funds it belongs to a group rather than a person. Until now
 * KCX could only see individuals, which meant a nine-person operation showed up as nine
 * unrelated traders with no shared record and no shared money.
 *
 * The SID is the org's identity, exactly as an RSI handle is a person's, and membership is
 * anchored to the `main_org_sid` KCX already reads off the public RSI profile at
 * verification time. So an org here is not a club someone invents — it is a claim on a real
 * RSI org, and the founder has to have it on their profile.
 */

export const ORG_ROLES = [
  /** Can spend the treasury, manage members, and close the org. */
  "owner",
  /** Can spend the treasury and admit members, but not remove an owner. */
  "officer",
  /** Can act on the org's behalf up to their own delegated limit. */
  "trader",
  /** Counted in standing, spends nothing. */
  "member",
] as const;

/** Roles permitted to commit the org's money at all. */
export const ORG_SPENDING_ROLES = ["owner", "officer", "trader"] as const;

export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** RSI org SID, stored uppercase. The durable identity. */
    sid: text("sid").notNull(),
    name: text("name").notNull(),
    /**
     * Self-declared aUEC held by the org, on exactly the same footing as a personal balance:
     * KCX never holds it, and it is the figure obligations are checked against.
     */
    treasury: bigint("treasury", { mode: "number" }).notNull().default(0),
    description: text("description"),
    /**
     * Who created it. Kept even if they later leave, so an org can never end up with no
     * record of where it came from.
     */
    foundedById: uuid("founded_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orgs_sid").on(t.sid),
    check("orgs_treasury_non_negative", sql`${t.treasury} >= 0`),
  ],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ORG_ROLES }).notNull().default("member"),
    /**
     * The most of the treasury this member may have committed at any one time.
     *
     * Null means no cap beyond the treasury itself, which is only sane for owners. A
     * delegated trader with a limit is the whole point: an org can let someone buy on its
     * behalf without handing them everything, and the limit is enforced the same way a
     * personal balance is — against what they have already committed, not what they have
     * already spent.
     */
    spendLimit: bigint("spend_limit", { mode: "number" }),
    invitedById: uuid("invited_by_id").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_members_once").on(t.orgId, t.userId),
    index("org_members_user").on(t.userId),
    check("org_members_limit_positive", sql`${t.spendLimit} IS NULL OR ${t.spendLimit} >= 0`),
  ],
);

export const ORG_EVENT_TYPES = [
  "founded",
  "member_joined",
  "member_left",
  "member_removed",
  "role_changed",
  "limit_changed",
  "treasury_set",
  "renamed",
] as const;

/** Append-only audit trail. Who let whom spend what is exactly the thing orgs argue about. */
export const orgEvents = pgTable(
  "org_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    actorId: uuid("actor_id").references(() => users.id),
    subjectId: uuid("subject_id").references(() => users.id),
    type: text("type", { enum: ORG_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("org_events_org").on(t.orgId, t.createdAt)],
);
