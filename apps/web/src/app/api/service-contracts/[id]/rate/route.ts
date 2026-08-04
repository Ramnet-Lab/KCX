import { contractRatings, getDb, serviceContracts } from "@kcx/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(280).optional() });

/**
 * Rate the other party to a completed contract.
 *
 * Stored in contract_ratings, entirely apart from commodity-trading ratings: being a
 * dependable hauler says nothing about being a dependable merchant, and averaging the two
 * together would hide exactly the distinction someone hiring an escort cares about.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Rating must be 1–5 stars" }, { status: 400 });

  const db = getDb();
  const [c] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, id));
  if (!c) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const isIssuer = c.issuerId === user.id;
  const isExecutor = c.executorId === user.id;
  if (!isIssuer && !isExecutor) return NextResponse.json({ error: "You weren't party to this" }, { status: 403 });
  if (c.status !== "completed") {
    return NextResponse.json({ error: "Only completed contracts can be rated" }, { status: 409 });
  }

  const ratedId = isIssuer ? c.executorId : c.issuerId;
  if (!ratedId) return NextResponse.json({ error: "No counterparty to rate" }, { status: 409 });

  try {
    const existing = await db
      .select({ id: contractRatings.id })
      .from(contractRatings)
      .where(and(eq(contractRatings.contractId, id), eq(contractRatings.raterId, user.id)));
    if (existing.length > 0) {
      return NextResponse.json({ error: "You have already rated this contract" }, { status: 409 });
    }
    await db.insert(contractRatings).values({
      contractId: id,
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
