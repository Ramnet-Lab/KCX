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
  const result = await db.execute<{
    sector: SectorCode;
    value: string;
    constituents: number;
    season_open: string | null;
    season_version: string | null;
  }>(sql`
    WITH season AS (
      SELECT version, live_at FROM game_versions WHERE status = 'active' ORDER BY live_at DESC LIMIT 1
    ),
    latest AS (
      SELECT DISTINCT ON (sector) sector, value, constituents
      FROM market_index_points ORDER BY sector, captured_at DESC
    )
    SELECT
      l.sector, l.value::text AS value, l.constituents,
      -- The index level at the moment this season began. The stored series is continuous
      -- across patches on purpose; season-to-date is a view of it, not a second series, so
      -- switching between the two can never disagree about what happened.
      (SELECT mp.value::text FROM market_index_points mp, season s
        WHERE mp.sector = l.sector AND mp.captured_at >= s.live_at
        ORDER BY mp.captured_at ASC LIMIT 1) AS season_open,
      (SELECT version FROM season) AS season_version
    FROM latest l
  `);
  return result.rows.map((r) => {
    const value = Number(r.value);
    const open = r.season_open != null ? Number(r.season_open) : null;
    return {
      sector: r.sector,
      value,
      constituents: Number(r.constituents),
      seasonOpen: open,
      seasonVersion: r.season_version,
      // Null rather than 0 when the season has no opening point yet: "unknown" and "flat" are
      // different claims, and a young season legitimately has nothing to compare against.
      seasonChangePct: open != null && open > 0 ? Math.round(((value - open) / open) * 10_000) / 100 : null,
    };
  });
}
