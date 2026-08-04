import { getDb, trades, tradeRatings } from "@kcx/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(280).optional(),
});

/**
 * POST /api/contracts/:id/rate — rate the counterparty of a settled contract.
 *
 * Only the two parties may rate, only after settlement, and only once each: ratings that
 * anyone can leave, or leave repeatedly, are worth nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Rating must be 1–5 stars" }, { status: 400 });

  const db = getDb();
  const [trade] = await db.select().from(trades).where(eq(trades.id, id));
  if (!trade) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const isOwner = trade.ownerId === user.id;
  const isClaimer = trade.claimerId === user.id;
  if (!isOwner && !isClaimer) {
    return NextResponse.json({ error: "You weren't party to this contract" }, { status: 403 });
  }
  if (trade.status !== "settled") {
    return NextResponse.json({ error: "Only settled contracts can be rated" }, { status: 409 });
  }

  const ratedId = isOwner ? trade.claimerId : trade.ownerId;

  try {
    const existing = await db
      .select({ id: tradeRatings.id })
      .from(tradeRatings)
      .where(and(eq(tradeRatings.tradeId, id), eq(tradeRatings.raterId, user.id)));
    if (existing.length > 0) {
      return NextResponse.json({ error: "You've already rated this contract" }, { status: 409 });
    }

    await db.insert(tradeRatings).values({
      tradeId: id,
      raterId: user.id,
      ratedId,
      stars: parsed.data.stars,
      comment: parsed.data.comment?.trim() || null,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[contracts:rate]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save rating" }, { status: 500 });
  }
}
