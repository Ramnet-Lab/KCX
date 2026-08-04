import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gameVersions, locations } from "./market";
import { users } from "./orders";

/**
 * Service contracts — player-written work, not commodity trades.
 *
 * "Haul 400 SCU from Lorville to Area 18", "escort me through Pyro", "salvage this wreck".
 * The issuer names the job and the payout; an executor claims it, does the work in-game,
 * and both sides confirm before aUEC moves.
 *
 * Deliberately separate from `trades` (the commodity escrow): the work is freeform, the
 * payout is one-directional, and — per the exchange's design — a hauler's reliability on
 * jobs is a different reputation from a trader's reliability on cargo. Someone can be an
 * excellent merchant and an unreliable escort.
 */

export const CONTRACT_CATEGORIES = [
  "hauling",
  "escort",
  "mining",
  "salvage",
  "medical",
  "combat",
  "exploration",
  "other",
] as const;

export const CONTRACT_STATUSES = [
  /** Posted, nobody has taken it. */
  "open",
  /** Claimed by an executor and locked from others. */
  "in_progress",
  /** Both sides confirmed; payout transferred. */
  "completed",
  /** Withdrawn or abandoned before completion. */
  "cancelled",
  /** Deadline passed without completion. */
  "expired",
] as const;

export const serviceContracts = pgTable(
  "service_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => users.id),
    /** Null until claimed. */
    executorId: uuid("executor_id").references(() => users.id),
    /** Patch-scoped like everything else: cargo and context die at each game patch. */
    seasonId: integer("season_id")
      .notNull()
      .references(() => gameVersions.id),

    title: text("title").notNull(),
    description: text("description"),
    category: text("category", { enum: CONTRACT_CATEGORIES }).notNull().default("other"),
    /** Agreed payment in aUEC, held as a commitment against the issuer's balance. */
    payout: bigint("payout", { mode: "number" }).notNull(),
    locationId: integer("location_id").references(() => locations.id),

    status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("open"),
    /** Dual confirmation, exactly as commodity escrow works — neither side alone settles. */
    issuerConfirmedAt: timestamp("issuer_confirmed_at", { withTimezone: true }),
    executorConfirmedAt: timestamp("executor_confirmed_at", { withTimezone: true }),

    /** Deadline for the whole job: unclaimed or unfinished by then, it expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledById: uuid("cancelled_by_id").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contracts_board").on(t.status, t.createdAt),
    index("contracts_issuer").on(t.issuerId, t.status),
    index("contracts_executor").on(t.executorId, t.status),
    check("contracts_payout_positive", sql`${t.payout} > 0`),
  ],
);

export const CONTRACT_EVENT_TYPES = [
  "created",
  "claimed",
  "released",
  "confirmed_by_executor",
  "confirmed_by_issuer",
  "completed",
  "cancelled",
  "expired",
] as const;

/** Append-only audit trail; contract state is always reconstructible from these. */
export const contractEvents = pgTable(
  "contract_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => serviceContracts.id),
    /** null = system (the expiry sweep). */
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type", { enum: CONTRACT_EVENT_TYPES }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contract_events_contract").on(t.contractId, t.createdAt)],
);

/**
 * Ratings for completed service contracts, kept in their own table so contract standing
 * never mixes with commodity-trading standing.
 */
export const contractRatings = pgTable(
  "contract_ratings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => serviceContracts.id),
    raterId: uuid("rater_id")
      .notNull()
      .references(() => users.id),
    ratedId: uuid("rated_id")
      .notNull()
      .references(() => users.id),
    stars: smallint("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contract_ratings_once").on(t.contractId, t.raterId),
    index("contract_ratings_rated").on(t.ratedId),
    check("contract_ratings_stars_range", sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);
