import { getDb, moderationLog, moderationOverview } from "@kcx/db";
import { NextResponse } from "next/server";
import { requireMod } from "@/lib/require-mod";

export const dynamic = "force-dynamic";

/** GET — dashboard counters plus the moderation audit log. */
export async function GET() {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  try {
    const db = getDb();
    const [overview, log] = await Promise.all([moderationOverview(db), moderationLog(db, 100)]);
    return NextResponse.json({ overview, log });
  } catch (err) {
    console.error("[admin:overview]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
