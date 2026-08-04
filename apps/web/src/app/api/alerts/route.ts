import { getDb, listPriceAlerts, markAlertsRead } from "@kcx/db";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — the trader's alert feed, newest first. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ alerts: [] }, { status: 401 });
  try {
    return NextResponse.json({ alerts: await listPriceAlerts(getDb(), user.id) });
  } catch (err) {
    console.error("[alerts:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ alerts: [], error: "Unavailable" }, { status: 503 });
  }
}

/**
 * POST — mark everything read.
 *
 * All-at-once rather than per-alert: the badge exists to say "something moved", and once
 * someone has looked at the list that is answered. Per-alert read state would make the
 * badge a to-do list nobody asked for.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    await markAlertsRead(getDb(), user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[alerts:read]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
