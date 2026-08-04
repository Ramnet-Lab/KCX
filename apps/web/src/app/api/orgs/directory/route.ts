import { getDb, listPublicOrgs } from "@kcx/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/orgs/directory?q=&verified=1 — the public org list.
 *
 * Public and unauthenticated. It carries no treasury and no roster: how much an org has and
 * who may spend it are members' business. What it does carry is exactly what a counterparty
 * needs before dealing with them — verified or not, how much they trade, and whether they
 * settle.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  try {
    const orgs = await listPublicOrgs(getDb(), {
      search: q.get("q"),
      verifiedOnly: q.get("verified") === "1",
      limit: 60,
    });
    return NextResponse.json({ orgs });
  } catch (err) {
    console.error("[orgs:directory]", err instanceof Error ? err.message : err);
    return NextResponse.json({ orgs: [], error: "Unavailable" }, { status: 503 });
  }
}
