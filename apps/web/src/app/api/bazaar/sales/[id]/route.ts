import { getDb, resolveBazaarSale } from "@kcx/db";
import { bazaarSaleActionInput } from "@kcx/shared";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * PATCH — confirm the handover happened, or back out of it.
 *
 * Both sides have to confirm before aUEC moves between the declared balances. A single
 * confirmation records only that one of them says it's done: the seller can't declare a
 * delivery that never happened, and the buyer can't quietly keep the goods.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = bazaarSaleActionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const result = await resolveBazaarSale(getDb(), {
      saleId: id,
      userId: user.id,
      action: parsed.data.action,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bazaar:sale]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
