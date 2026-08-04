import { getDb, respondToAward } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({ action: z.enum(["accept", "decline"]) });

/**
 * POST — the winning bidder takes the job or turns it down.
 *
 * Declining is not a penalty-free no-op for the board: it hands the contract straight to the
 * next-cheapest bidder, so the issuer isn't left with a dead auction and the other bidders
 * aren't left waiting on someone who has already walked away.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!user.isVerified) return NextResponse.json({ error: "Verify your RSI handle first" }, { status: 403 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const result = await respondToAward(getDb(), {
      contractId: id,
      userId: user.id,
      action: parsed.data.action,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contracts:award]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
