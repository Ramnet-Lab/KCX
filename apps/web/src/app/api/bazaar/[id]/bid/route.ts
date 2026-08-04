import { getDb, placeBazaarBid } from "@kcx/db";
import { bazaarBidInput } from "@kcx/shared";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST — bid on an auction, or raise your own bid.
 *
 * Bids are binding and cannot be retracted, which is why the amount is committed against
 * the bidder's declared balance the moment it lands and released the moment they're beaten.
 * There is no DELETE here on purpose.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to bid" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to bid" }, { status: 403 });
  }

  const parsed = bazaarBidInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a valid bid" }, { status: 400 });

  try {
    const result = await placeBazaarBid(getDb(), {
      listingId: id,
      bidderId: user.id,
      amount: parsed.data.amount,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bazaar:bid]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not place the bid" }, { status: 500 });
  }
}
