import { claimOrder, getDb, notifyMarketChange } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({ quantityScu: z.number().int().positive().max(1_000_000).optional() });

/** POST /api/orders/:id/claim — lock the order into an escrow contract. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to claim orders" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to trade" }, { status: 403 });
  }

  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });

  const db = getDb();
  try {
    const result = await claimOrder(db, {
      orderId: id,
      claimerId: user.id,
      quantityScu: parsed.data.quantityScu,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    await notifyMarketChange(db, {
      kind: "contract",
      orderId: id,
      tradeId: result.tradeId,
      participants: [user.id, ...(result.ownerId ? [result.ownerId] : [])],
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[orders:claim]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not claim order" }, { status: 500 });
  }
}
