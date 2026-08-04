import { getDb, placeBid, withdrawBid } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const bidInput = z.object({
  amount: z.number().int().positive().max(1_000_000_000),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST — place or revise a sealed bid on a contract out for auction.
 *
 * There is no GET here on purpose. Bids stay sealed until the window closes, so no endpoint
 * exposes another bidder's number; a bidder sees only their own, returned with the board.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to bid" }, { status: 401 });
  if (!user.isVerified) return NextResponse.json({ error: "Verify your RSI handle to bid" }, { status: 403 });

  const parsed = bidInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid bid" }, { status: 400 });
  }

  try {
    const result = await placeBid(getDb(), {
      contractId: id,
      bidderId: user.id,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[contracts:bid]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not place bid" }, { status: 500 });
  }
}

/** DELETE — pull your bid while the window is still open. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  try {
    const result = await withdrawBid(getDb(), id, user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contracts:bid-withdraw]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not withdraw bid" }, { status: 500 });
  }
}
