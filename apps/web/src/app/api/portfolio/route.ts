import { buyCapacity, getPortfolio, getDb, savePortfolio } from "@kcx/db";
import { portfolioSaveInput } from "@kcx/shared";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/portfolio — server-held position (the collateral orders are checked against). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ portfolio: null });
  try {
    const db = getDb();
    const [portfolio, buying] = await Promise.all([getPortfolio(db, user.id), buyCapacity(db, user.id)]);
    return NextResponse.json({ portfolio, buying });
  } catch (err) {
    console.error("[portfolio:get]", err instanceof Error ? err.message : err);
    return NextResponse.json({ portfolio: null, error: "Unavailable" }, { status: 503 });
  }
}

/** PUT /api/portfolio — replace declared holdings/balance (rejects uncollateralising edits). */
export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = portfolioSaveInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid portfolio" }, { status: 400 });

  try {
    const result = await savePortfolio(getDb(), user.id, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[portfolio:put]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
