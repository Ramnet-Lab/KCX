import { buyBazaarNow, getDb } from "@kcx/db";
import { bazaarBuyInput } from "@kcx/shared";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST — take a listing at its asking price.
 *
 * This does not transfer anything. It records that the two of them agreed, reserves the
 * units against the listing, and starts the clock they have to meet in-game inside. The
 * aUEC moves only when both confirm the handover happened.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to buy" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to buy" }, { status: 403 });
  }

  const parsed = bazaarBuyInput.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });

  try {
    const result = await buyBazaarNow(getDb(), {
      listingId: id,
      buyerId: user.id,
      quantity: parsed.data.quantity,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, saleId: result.saleId }, { status: 201 });
  } catch (err) {
    console.error("[bazaar:buy]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not complete the purchase" }, { status: 500 });
  }
}
