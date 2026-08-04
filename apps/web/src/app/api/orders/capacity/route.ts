import { buyCapacity, getDb, sellCapacity } from "@kcx/db";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/orders/capacity?commodityId= — what this trader can back right now. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ sell: null, buy: null });

  const commodityId = Number(new URL(request.url).searchParams.get("commodityId"));
  try {
    const db = getDb();
    const [sell, buy] = await Promise.all([
      Number.isInteger(commodityId) && commodityId > 0 ? sellCapacity(db, user.id, commodityId) : Promise.resolve(null),
      buyCapacity(db, user.id),
    ]);
    return NextResponse.json({ sell, buy });
  } catch (err) {
    console.error("[orders:capacity]", err instanceof Error ? err.message : err);
    return NextResponse.json({ sell: null, buy: null }, { status: 503 });
  }
}
