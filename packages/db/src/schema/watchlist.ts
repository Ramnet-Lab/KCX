import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bazaarItems } from "./bazaar";
import { commodities } from "./market";
import { users } from "./orders";

/**
 * Watchlists and price alerts.
 *
 * The point of a settled-price series is that it tells you something an asking price can't.
 * That is only useful if you find out when it moves — nobody refreshes a commodity page for
 * three days waiting to see whether a Polaris finally cleared under 35 million.
 *
 * Alerts fire against the same settled numbers the rest of the exchange publishes: a
 * commodity's mark, or an item's last settled sale. An unsold listing at a tempting price
 * never triggers anything, because it is not evidence that anyone paid it.
 */

export const WATCH_TARGETS = ["commodity", "item"] as const;

/**
 * Which way the price has to cross to be worth telling someone about.
 *
 * `below` is the buyer's alert and `above` the seller's. `any` fires on either side of a
 * band and exists for the case where what you care about is movement rather than direction.
 */
export const ALERT_DIRECTIONS = ["below", "above", "any"] as const;

export const watchlistEntries = pgTable(
  "watchlist_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    target: text("target", { enum: WATCH_TARGETS }).notNull(),
    /** Exactly one of these is set, enforced by the check below. */
    commodityId: integer("commodity_id").references(() => commodities.id),
    itemId: bigint("item_id", { mode: "number" }).references(() => bazaarItems.id),

    /**
     * Null means "watch it, don't alert me". A watchlist without silent entries becomes a
     * list of alarms, and people stop adding things to it.
     */
    threshold: bigint("threshold", { mode: "number" }),
    direction: text("direction", { enum: ALERT_DIRECTIONS }).notNull().default("below"),

    /**
     * Set when the condition last fired, and cleared once the price crosses back.
     *
     * Without this an alert set at "below 35M" re-fires on every settlement for as long as
     * the price stays under — which is the fastest way to teach someone to ignore alerts.
     */
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    /** The price that tripped it, so the notification can say what actually happened. */
    triggeredPrice: bigint("triggered_price", { mode: "number" }),
    /** Cleared by the user reading it; the badge counts unacknowledged ones. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),

    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One entry per person per thing — editing beats stacking duplicates. */
    uniqueIndex("watchlist_unique_commodity")
      .on(t.userId, t.commodityId)
      .where(sql`${t.commodityId} IS NOT NULL`),
    uniqueIndex("watchlist_unique_item")
      .on(t.userId, t.itemId)
      .where(sql`${t.itemId} IS NOT NULL`),
    index("watchlist_user").on(t.userId),
    /** The sweep walks armed alerts by target. */
    index("watchlist_armed_commodity").on(t.commodityId).where(sql`${t.threshold} IS NOT NULL`),
    index("watchlist_armed_item").on(t.itemId).where(sql`${t.threshold} IS NOT NULL`),
    check(
      "watchlist_exactly_one_target",
      sql`(${t.commodityId} IS NOT NULL)::int + (${t.itemId} IS NOT NULL)::int = 1`,
    ),
    check("watchlist_target_matches", sql`
      (${t.target} = 'commodity' AND ${t.commodityId} IS NOT NULL)
      OR (${t.target} = 'item' AND ${t.itemId} IS NOT NULL)
    `),
    check("watchlist_threshold_positive", sql`${t.threshold} IS NULL OR ${t.threshold} > 0`),
  ],
);

/**
 * Delivered alerts, kept after the watchlist entry re-arms.
 *
 * Separate from the entry because the entry describes a standing intention while these are
 * things that happened: overwriting the last firing on the entry would mean a trader who
 * missed two alerts in a row can only ever see the most recent one.
 */
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    watchlistId: bigint("watchlist_id", { mode: "number" })
      .notNull()
      .references(() => watchlistEntries.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Denormalised so the feed reads without joining back through the entry. */
    label: text("label").notNull(),
    /**
     * The price that tripped it, in whole aUEC.
     *
     * A commodity mark is a volume-weighted average and therefore fractional, so this is
     * rounded on the way in — like every other money column here. Half an aUEC is not a
     * distinction anyone reading an alert can act on.
     */
    price: bigint("price", { mode: "number" }).notNull(),
    threshold: bigint("threshold", { mode: "number" }).notNull(),
    direction: text("direction", { enum: ALERT_DIRECTIONS }).notNull(),
    /** Where to send them — a commodity page or a bazaar item. */
    href: text("href").notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_alerts_user").on(t.userId, t.createdAt), index("price_alerts_unread").on(t.userId).where(sql`NOT ${t.read}`)],
);
