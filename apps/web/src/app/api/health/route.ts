import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness for the container healthcheck and any uptime monitor.
 * Reports degraded (503) when the database is unreachable so an orchestrator can act,
 * while still returning a body that says which part is unhappy.
 */
export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, db: "up", ms: Date.now() - started });
  } catch (err) {
    return NextResponse.json(
      { ok: false, db: "down", error: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
