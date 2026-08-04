import type { IndexLatest, IndexPoint, IndexSeries, SectorCode } from "@kcx/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../client";

/** Full index history per sector (points are 30-min captures; fine to ship whole for months). */
export async function indexSeries(db: Db, sinceDays = 90): Promise<IndexSeries> {
  const result = await db.execute<{ sector: SectorCode; t: string; value: string }>(sql`
    SELECT sector, extract(epoch FROM captured_at)::bigint::text AS t, value::text AS value
    FROM market_index_points
    WHERE captured_at >= now() - make_interval(days => ${sinceDays})
    ORDER BY captured_at ASC
  `);
  const series: IndexSeries = {};
  for (const r of result.rows) {
    const point: IndexPoint = { time: Number(r.t), value: Number(r.value) };
    (series[r.sector] ??= []).push(point);
  }
  return series;
}

/** Latest index value per sector — rides along on the ticker broadcast. */
export async function indexLatest(db: Db): Promise<IndexLatest[]> {
  const result = await db.execute<{ sector: SectorCode; value: string; constituents: number }>(sql`
    SELECT DISTINCT ON (sector) sector, value::text AS value, constituents
    FROM market_index_points
    ORDER BY sector, captured_at DESC
  `);
  return result.rows.map((r) => ({
    sector: r.sector,
    value: Number(r.value),
    constituents: Number(r.constituents),
  }));
}
