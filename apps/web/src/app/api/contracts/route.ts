import { getDb, listContracts } from "@kcx/db";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/contracts?open=1 — escrow contracts the signed-in trader is party to. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ contracts: [] });
  const onlyOpen = new URL(request.url).searchParams.get("open") === "1";
  try {
    return NextResponse.json({ contracts: await listContracts(getDb(), user.id, onlyOpen) });
  } catch (err) {
    console.error("[contracts:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ contracts: [], error: "Unavailable" }, { status: 503 });
  }
}
