import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/candles?commodityId=13&period=1h&limit=3
 *
 * The tail of a commodity's candle series, so a chart already on screen can repaint the
 * buckets that just moved instead of remounting. Fetching the whole series (or calling
 * router.refresh()) would work but throws away the viewer's pan and zoom every time
 * somebody, anywhere, settles a trade in that commodity.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const commodityId = Number(url.searchParams.get("commodityId"));
  const period = url.searchParams.get("period") === "1d" ? "1d" : "1h";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 500);
  if (!Number.isInteger(commodityId) || commodityId <= 0) {
    return NextResponse.json({ candles: [] }, { status: 400 });
  }

  try {
    const result = await getDb().execute<{
      t: string;
      mkt_open: string | null;
      mkt_high: string | null;
      mkt_low: string | null;
      mkt_close: string | null;
      sell_close: string | null;
      buy_close: string | null;
    }>(sql`
      SELECT
        extract(epoch FROM bucket_start)::bigint::text AS t,
        mkt_open::text, mkt_high::text, mkt_low::text, mkt_close::text,
        sell_close::text, buy_close::text
      FROM reference_candles
      WHERE commodity_id = ${commodityId} AND period = ${period}
      ORDER BY bucket_start DESC
      LIMIT ${limit}
    `);

    const n = (v: string | null) => (v != null ? Number(v) : null);
    const candles = result.rows.reverse().map((r) => ({
      time: Number(r.t),
      // Same fallback as the page's server render: buckets recorded before the mark existed
      // only have the baseline series.
      mktOpen: n(r.mkt_open) ?? n(r.sell_close),
      mktHigh: n(r.mkt_high) ?? n(r.sell_close),
      mktLow: n(r.mkt_low) ?? n(r.sell_close),
      mktClose: n(r.mkt_close) ?? n(r.sell_close),
      sellClose: n(r.sell_close),
      buyClose: n(r.buy_close),
    }));
    return NextResponse.json({ candles });
  } catch (err) {
    console.error("[candles] query failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ candles: [] }, { status: 503 });
  }
}
