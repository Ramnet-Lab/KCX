import {
  bazaarEvents,
  bazaarListings,
  buyCapacity,
  canActForOrg,
  createOrgProposal,
  gameVersions,
  getBazaarItem,
  getDb,
  getOrgProposal,
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

  /*
   * A board-approved replay. The id is trusted only after the proposal is re-read here and
   * found approved, of the right kind, and for this org — so nobody can hand-craft one.
   *
   * Honouring it does two things: the listing belongs to whoever PROPOSED it rather than to
   * whoever cast the deciding vote, and the board gate below is skipped, without which the
   * replay would open a fresh proposal and every approval would spawn another.
   */
  let actingUserId = user.id;
  if (input.approvedProposalId) {
    const proposal = await getOrgProposal(db, input.approvedProposalId);
    const valid =
      proposal &&
      proposal.status === "approved" &&
      proposal.kind === "bazaar_listing" &&
      proposal.orgId === input.orgId;
    if (!valid) {
      return NextResponse.json({ error: "That proposal isn't approved for this action" }, { status: 409 });
    }
    actingUserId = proposal.proposedById;
  }

  if (input.orgId && !input.approvedProposalId) {
    /*
     * Acting for an org runs the org gate, not the personal one: verified-and-unsuspended,
     * a role that touches money, a membership reading that isn't stale, the treasury, and
     * the member's delegated slice.
     *
     * A wanted ad is valued at what it commits; a sell listing commits nothing up front but
     * still routes proceeds to the treasury, so membership must be real either way.
     */
    const cost = input.intent === "buy" ? (input.buyNowPrice ?? 0) * input.quantity : 0;
    const check = await canActForOrg(db, { orgId: input.orgId, userId: user.id, amount: cost });
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason ?? "You can't act for that org", check }, { status: 409 });
    }

    // Above the org's threshold this doesn't happen now — it goes to the board, and the
    // same payload is replayed against this endpoint once the vote carries.
    if (check.needsBoard) {
      const proposal = await createOrgProposal(db, {
        orgId: input.orgId,
        proposedById: user.id,
        kind: "bazaar_listing",
        value: cost,
        summary:
          input.intent === "buy"
            ? `Wanted ad: ${input.title} — up to ${cost.toLocaleString()} aUEC`
            : `List for sale: ${input.title}`,
        payload: input,
        requiredApprovals: check.requiredApprovals,
      });
      if (!proposal.ok) return NextResponse.json({ error: proposal.error }, { status: 500 });
      return NextResponse.json(
        {
          pendingBoardApproval: true,
          proposalId: proposal.proposalId,
          requiredApprovals: check.requiredApprovals,
        },
        { status: 202 },
      );
    }
  }

  /*
   * A wanted ad is an offer, not a wish: the money behind it is committed for as long as it
   * stands, so it has to be there when it goes up. Sell listings post no collateral — an
   * arbitrary item isn't a declared holding the exchange can check.
   *
   * Org ads were gated above against the treasury, so they never reach here.
   */
  if (input.intent === "buy" && !input.orgId) {
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
    const resolved = await resolveOrCreateItem(db, { name: input.itemName, userId: actingUserId });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    itemId = resolved.item.id;
  }

  try {
    const listing = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(bazaarListings)
        .values({
          // `sellerId` is the POSTER — the buyer on a wanted ad. See schema/bazaar.ts.
          sellerId: actingUserId,
          intent: input.intent,
          orgId: input.orgId ?? null,
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
        actorId: actingUserId,
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
