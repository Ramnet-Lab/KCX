import { getDb, listMyOrgs } from "@kcx/db";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET — the orgs this trader belongs to.
 *
 * There is deliberately no POST. Orgs are not created here: one appears the moment a
 * verified trader's RSI profile names it, and the roster is whatever set of verified traders
 * currently name it. That removes the whole class of abuse where somebody registers a name
 * they have nothing to do with — you join an org on RSI, not on KCX.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ orgs: [] }, { status: 401 });
  try {
    return NextResponse.json({ orgs: await listMyOrgs(getDb(), user.id) });
  } catch (err) {
    console.error("[orgs:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ orgs: [], error: "Unavailable" }, { status: 503 });
  }
}
