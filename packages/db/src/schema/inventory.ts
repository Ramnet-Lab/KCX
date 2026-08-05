import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bazaarItems } from "./bazaar";
import { users } from "./orders";

/**
 * What a trader is holding, item by item.
 *
 * Distinct from `user_holdings`, which is commodity cargo measured in SCU against a market
 * price. This is discrete stuff — ships, components, armour, crafted goods — counted in
 * units, with no market price at all until somebody lists one. The two could not share a
 * table without one of them lying about its unit.
 *
 * Self-declared, like every other position on KCX: nothing can read your actual hangar. The
 * value is that it lets a seller keep a running tally and list from it in one step, and that
 * the exchange can then say how many of a thing are still free to promise rather than
 * already spoken for.
 */
export const userInventory = pgTable(
  "user_inventory",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /**
     * Always a catalogue item, never free text. The picker creates the catalogue row first
     * when something genuinely new is typed, so an inventory line can always be listed and
     * always joins to the same price history as everyone else's.
     */
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => bazaarItems.id),
    /** Units held. Zero is allowed so a line can be kept at hand after selling out. */
    quantity: integer("quantity").notNull().default(0),
    /** Where it is, what condition, which ship it's fitted to — whatever the owner needs. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemId] }),
    // Negative stock is not a position, it's a bug that already happened. Enforced here so a
    // miscounted decrement fails loudly at the write instead of quietly rendering "-2 held".
    check("user_inventory_quantity_non_negative", sql`${t.quantity} >= 0`),
  ],
);
