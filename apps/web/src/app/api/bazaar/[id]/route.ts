import {
  BAZAAR_BUMP_COOLDOWN_MS,
  bazaarBids,
  bazaarEvents,
  bazaarListings,
  bazaarSales,
  getBazaarListing,
  getDb,
} from "@kcx/db";
import { BAZAAR_DEFAULT_HOURS, bazaarActionInput } from "@kcx/shared";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  try {
    const listing = await getBazaarListing(getDb(), id, user?.id ?? null);
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    return NextResponse.json({ listing });
  } catch (err) {
    console.error("[bazaar:get]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}

/**
 * PATCH — the seller's own controls: pause, resume, cancel, bump, relist, edit.
 *
 * The consistent rule underneath all of them is that a listing's TERMS cannot change out
 * from under someone who already acted on them. Pricing mode and the auction clock are
 * fixed at post time, a live auction can't be paused, and stock can't be cut below what has
 * already been sold. Everything else is the seller's to adjust.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = bazaarActionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const { action, edit, runForHours } = parsed.data;

  const db = getDb();
  const isMod = user.role === "mod" || user.role === "admin";

  try {
    const result = await db.transaction(async (tx) => {
      const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, id)).for("update");
      if (!l) return { status: 404, body: { error: "Listing not found" } };
      if (l.sellerId !== user.id && !isMod) {
        return { status: 403, body: { error: "Not your listing" } };
      }

      const now = new Date();
      const isAuction = l.listingType !== "buy_now";
      const [{ pending } = { pending: 0 }] = await tx
        .select({ pending: sql<number>`count(*)::int` })
        .from(bazaarSales)
        .where(and(eq(bazaarSales.listingId, l.id), eq(bazaarSales.status, "pending")));

      switch (action) {
        case "pause": {
          if (l.status !== "active") return { status: 409, body: { error: `Listing is ${l.status.replace(/_/g, " ")}` } };
          // An auction's clock is a promise to everyone watching it; pausing would let a
          // seller stall a bid war they didn't like the shape of.
          if (isAuction) return { status: 409, body: { error: "An auction runs to its close — cancel it instead." } };
          await tx.update(bazaarListings).set({ status: "paused", updatedAt: now }).where(eq(bazaarListings.id, l.id));
          await tx.insert(bazaarEvents).values({ listingId: l.id, actorId: user.id, type: "paused", data: {} });
          return { status: 200, body: { ok: true, status: "paused" } };
        }

        case "resume": {
          if (l.status !== "paused") return { status: 409, body: { error: "That listing isn't paused" } };
          if (l.expiresAt <= now) {
            return { status: 409, body: { error: "This listing has run out of time — relist it instead." } };
          }
          await tx.update(bazaarListings).set({ status: "active", updatedAt: now }).where(eq(bazaarListings.id, l.id));
          await tx.insert(bazaarEvents).values({ listingId: l.id, actorId: user.id, type: "resumed", data: {} });
          return { status: 200, body: { ok: true, status: "active" } };
        }

        case "cancel": {
          if (!["active", "paused", "sold_out"].includes(l.status)) {
            return { status: 409, body: { error: `Listing is already ${l.status.replace(/_/g, " ")}` } };
          }
          // Pulling the listing must not quietly abandon a buyer who is mid-handover.
          if (pending > 0) {
            return {
              status: 409,
              body: { error: `${pending} sale(s) are still waiting to settle — resolve those first.` },
            };
          }
          // Everyone still bidding gets their committed aUEC back on the spot.
          await tx
            .update(bazaarBids)
            .set({ status: "lost", updatedAt: now })
            .where(and(eq(bazaarBids.listingId, l.id), eq(bazaarBids.status, "active")));
          await tx
            .update(bazaarListings)
            .set({ status: "cancelled", currentBid: null, currentBidderId: null, updatedAt: now })
            .where(eq(bazaarListings.id, l.id));
          await tx.insert(bazaarEvents).values({
            listingId: l.id,
            actorId: user.id,
            type: isMod && l.sellerId !== user.id ? "removed_by_mod" : "cancelled",
            data: { hadBids: l.bidCount },
          });
          return { status: 200, body: { ok: true, status: "cancelled" } };
        }

        case "bump": {
          if (l.status !== "active") return { status: 409, body: { error: "Only a live listing can be bumped" } };
          if (now.getTime() - l.bumpedAt.getTime() < BAZAAR_BUMP_COOLDOWN_MS) {
            const hours = Math.ceil((BAZAAR_BUMP_COOLDOWN_MS - (now.getTime() - l.bumpedAt.getTime())) / 3_600_000);
            return { status: 429, body: { error: `You can bump again in ${hours}h` } };
          }
          // Bumping re-sorts the board and buys a fixed-price listing more time. It must
          // never move an auction's close — that clock belongs to the bidders.
          const extended = new Date(now.getTime() + BAZAAR_DEFAULT_HOURS * 3_600_000);
          await tx
            .update(bazaarListings)
            .set({
              bumpedAt: now,
              expiresAt: isAuction ? l.expiresAt : extended > l.expiresAt ? extended : l.expiresAt,
              updatedAt: now,
            })
            .where(eq(bazaarListings.id, l.id));
          await tx.insert(bazaarEvents).values({ listingId: l.id, actorId: user.id, type: "bumped", data: {} });
          return { status: 200, body: { ok: true } };
        }

        case "relist": {
          if (!["expired", "cancelled", "sold_out"].includes(l.status)) {
            return { status: 409, body: { error: "This listing is still live" } };
          }
          if (pending > 0) {
            return { status: 409, body: { error: "A sale on this listing hasn't settled yet" } };
          }
          const hours = runForHours ?? BAZAAR_DEFAULT_HOURS;
          const until = new Date(now.getTime() + hours * 3_600_000);
          // A fresh run is a fresh auction: old bids are settled as lost so nobody's aUEC
          // stays committed to a sale that already ended.
          await tx
            .update(bazaarBids)
            .set({ status: "lost", updatedAt: now })
            .where(and(eq(bazaarBids.listingId, l.id), eq(bazaarBids.status, "active")));
          await tx
            .update(bazaarListings)
            .set({
              status: "active",
              remainingQuantity: l.quantity,
              currentBid: null,
              currentBidderId: null,
              bidCount: 0,
              auctionEndsAt: isAuction ? until : null,
              expiresAt: until,
              bumpedAt: now,
              updatedAt: now,
            })
            .where(eq(bazaarListings.id, l.id));
          await tx.insert(bazaarEvents).values({
            listingId: l.id,
            actorId: user.id,
            type: "listed",
            data: { relisted: true, hours },
          });
          return { status: 200, body: { ok: true, status: "active" } };
        }

        case "edit": {
          if (!edit) return { status: 400, body: { error: "Nothing to change" } };
          if (!["active", "paused"].includes(l.status)) {
            return { status: 409, body: { error: "Only a live listing can be edited — relist it first." } };
          }

          const patch: Partial<typeof bazaarListings.$inferInsert> = { updatedAt: now };
          if (edit.title != null) patch.title = edit.title;
          if (edit.description !== undefined) patch.description = edit.description?.trim() || null;
          if (edit.category != null) patch.category = edit.category;
          if (edit.locationId !== undefined) patch.locationId = edit.locationId ?? null;

          if (edit.buyNowPrice != null) {
            if (l.listingType === "auction") {
              return { status: 409, body: { error: "This listing is bids only — it has no asking price." } };
            }
            if (l.listingType === "auction_buy_now" && l.bidCount > 0) {
              return { status: 409, body: { error: "Bidding has started — the buy-it-now price is fixed now." } };
            }
            if (l.startPrice != null && edit.buyNowPrice <= l.startPrice) {
              return { status: 409, body: { error: "The buy-it-now price has to stay above the starting bid." } };
            }
            patch.buyNowPrice = edit.buyNowPrice;
          }

          if (edit.quantity != null) {
            if (l.listingType !== "buy_now") {
              return { status: 409, body: { error: "An auction is a single lot" } };
            }
            const spokenFor = l.quantity - l.remainingQuantity;
            if (edit.quantity < spokenFor) {
              return {
                status: 409,
                body: { error: `${spokenFor} already sold — you can't drop the count below that.` },
              };
            }
            patch.quantity = edit.quantity;
            patch.remainingQuantity = edit.quantity - spokenFor;
            // Restocking a sold-out listing puts it back on the board.
            if (l.status === "active" && patch.remainingQuantity > 0) patch.status = "active";
          }

          await tx.update(bazaarListings).set(patch).where(eq(bazaarListings.id, l.id));
          await tx.insert(bazaarEvents).values({
            listingId: l.id,
            actorId: user.id,
            type: "edited",
            data: { fields: Object.keys(edit) },
          });
          return { status: 200, body: { ok: true } };
        }
      }
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[bazaar:action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
