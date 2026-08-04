import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/price-history?ids=13,35&days=90
 * Hourly best-sell close per requested commodity (from reference_candles 1h), for
 * client-side portfolio valuation. Capped at 50 ids; unknown ids simply return no rows.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 90, 1), 365);
  if (ids.length === 0) return NextResponse.json({});

  try {
    const result = await getDb().execute<{ commodity_id: number; t: string; v: string }>(sql`
      SELECT commodity_id,
             extract(epoch FROM bucket_start)::bigint::text AS t,
             sell_close::text AS v
      FROM reference_candles
      WHERE period = '1h'
        AND sell_close IS NOT NULL
        AND commodity_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND bucket_start >= now() - make_interval(days => ${days})
      ORDER BY bucket_start ASC
    `);
    const series: Record<number, { t: number; v: number }[]> = {};
    for (const row of result.rows) {
      (series[row.commodity_id] ??= []).push({ t: Number(row.t), v: Number(row.v) });
    }
    return NextResponse.json(series, { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    console.error("[price-history] query failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({}, { status: 503 });
  }
}
