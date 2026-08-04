import { getDb, notifyMarketChange, resolveContract } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({ action: z.enum(["confirm", "cancel"]) });

/** PATCH /api/contracts/:id — confirm (settles when both agree) or cancel (releases the lock). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const db = getDb();
    const result = await resolveContract(db, { tradeId: id, userId: user.id, action: parsed.data.action });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    await notifyMarketChange(db, {
      kind: "contract",
      tradeId: id,
      commodityId: result.commodityId,
      // A settlement writes a print, so the market price moves with it.
      priceMoved: result.settled,
      participants: [result.ownerId, result.claimerId],
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[contracts:resolve]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not update contract" }, { status: 500 });
  }
}
