import {
  bazaarEvents,
  bazaarListings,
  buyCapacity,
  gameVersions,
  getBazaarItem,
  getDb,
  listBazaarListings,
  resolveOrCreateItem,
} from "@kcx/db";
import { BAZAAR_CATEGORIES, BAZAAR_INTENTS, BAZAAR_LISTING_TYPES, bazaarCreateInput } from "@kcx/shared";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const SORTS = ["newest", "ending", "price_asc", "price_desc"] as const;

/** GET — the public board. */
export async function GET(request: Request) {
  const user = await currentUser();
  const url = new URL(request.url);
  const q = url.searchParams;

  // Anything unrecognised falls back to the default rather than reaching a query: these all
  // reach SQL, and an unvalidated sort key is the one that would reach it as an identifier.
  const category = BAZAAR_CATEGORIES.find((c) => c === q.get("category")) ?? null;
  const listingType = BAZAAR_LISTING_TYPES.find((t) => t === q.get("type")) ?? null;
  const intent = BAZAAR_INTENTS.find((i) => i === q.get("intent")) ?? null;
  const sort = SORTS.find((s) => s === q.get("sort")) ?? "newest";

  try {
    const listings = await listBazaarListings(getDb(), {
      viewerId: user?.id ?? null,
      category,
      listingType,
      intent,
      sort,
      search: q.get("q"),
      mineOnly: q.get("mine") === "1",
      // "Everything" includes what has already gone, so a buyer can see what things
      // actually sold for rather than only what is still unsold.
      statuses: q.get("all") === "1" ? ["active", "sold_out", "expired"] : ["active"],
    });
    return NextResponse.json({ listings });
  } catch (err) {
    console.error("[bazaar:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ listings: [], error: "Unavailable" }, { status: 503 });
  }
}

/**
 * POST — put something up for sale.
 *
 * No collateral is taken from the seller: a ship or a crate of crafted goods isn't a
 * declared holding the exchange can check, unlike commodity cargo. What backs the listing
 * is the seller's standing, which is why it travels with every card on the board.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to sell" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to sell on the bazaar" }, { status: 403 });
  }

  const parsed = bazaarCreateInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid listing" }, { status: 400 });
  }
  const input = parsed.data;

  const db = getDb();
  const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
  if (!season) return NextResponse.json({ error: "No active season" }, { status: 503 });

  const isAuction = input.listingType !== "buy_now";
  const runsUntil = new Date(Date.now() + input.runForHours * 3_600_000);

  // A wanted ad is an offer, not a wish: the money behind it is committed for as long as it
  // stands, so it has to be there when it goes up. Sell listings post no collateral — an
  // arbitrary item isn't a declared holding the exchange can check.
  if (input.intent === "buy") {
    const cost = (input.buyNowPrice ?? 0) * input.quantity;
    const capacity = await buyCapacity(db, user.id);
    if (cost > capacity.available) {
      return NextResponse.json(
        {
          error: `That wanted ad commits ${cost.toLocaleString()} aUEC but you have ${Math.max(0, capacity.available).toLocaleString()} free — your orders, contracts, bids and other wanted ads are already committed against your declared balance.`,
          capacity,
        },
        { status: 409 },
      );
    }
  }

  // Resolve the catalogue entry before anything is written. A picked id is used as given; a
  // typed name is matched on its normalised key and only creates a row when it is genuinely
  // the first of its kind — that is what stops "P4-AR" and "p4 ar" becoming two items with
  // half the price history each.
  let itemId: number | null = null;
  if (input.itemId != null) {
    const item = await getBazaarItem(db, input.itemId);
    if (!item) return NextResponse.json({ error: "That item isn't in the catalogue" }, { status: 400 });
    itemId = item.id;
  } else if (input.itemName) {
    const resolved = await resolveOrCreateItem(db, { name: input.itemName, userId: user.id });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    itemId = resolved.item.id;
  }

  try {
    const listing = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(bazaarListings)
        .values({
          // `sellerId` is the POSTER — the buyer on a wanted ad. See schema/bazaar.ts.
          sellerId: user.id,
          intent: input.intent,
          seasonId: season.id,
          itemId,
          title: input.title,
          description: input.description?.trim() || null,
          category: input.category,
          listingType: input.listingType,
          buyNowPrice: input.listingType === "auction" ? null : (input.buyNowPrice ?? null),
          startPrice: isAuction ? (input.startPrice ?? null) : null,
          // The auction and the listing share a deadline at creation. A late bid can push
          // the auction out (soft close), and that pushes the listing with it.
          auctionEndsAt: isAuction ? runsUntil : null,
          quantity: input.quantity,
          remainingQuantity: input.quantity,
          locationId: input.locationId ?? null,
          expiresAt: runsUntil,
        })
        .returning();
      await tx.insert(bazaarEvents).values({
        listingId: created!.id,
        actorId: user.id,
        type: "listed",
        data: {
          intent: input.intent,
          listingType: input.listingType,
          buyNowPrice: input.buyNowPrice ?? null,
          startPrice: input.startPrice ?? null,
          quantity: input.quantity,
        },
      });
      return created!;
    });
    return NextResponse.json({ id: listing.id }, { status: 201 });
  } catch (err) {
    console.error("[bazaar:create]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not post the listing" }, { status: 500 });
  }
}
