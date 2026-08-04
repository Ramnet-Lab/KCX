import { acceptBazaarOffer, getDb, resolveBazaarOffer } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({ action: z.enum(["accept", "decline", "withdraw"]) });

/**
 * POST — take an offer, turn it down, or pull your own.
 *
 * Accepting strikes the sale, which is the moment the buyer's aUEC is committed and the
 * units come off the listing. Nothing has moved in-game yet: the pair still have to meet and
 * both confirm, exactly as a buy-it-now purchase does.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle first" }, { status: 403 });
  }

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const db = getDb();
    const result =
      parsed.data.action === "accept"
        ? await acceptBazaarOffer(db, { messageId, userId: user.id })
        : await resolveBazaarOffer(db, { messageId, userId: user.id, action: parsed.data.action });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, saleId: "saleId" in result ? result.saleId : undefined });
  } catch (err) {
    console.error("[bazaar:offer]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
