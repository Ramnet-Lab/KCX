import { getDb } from "@kcx/db";
import { sql } from "drizzle-orm";
import { apiCsv, apiError, apiLimit, apiOptions } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/prints.csv — bulk download of settled player trades.
 *
 * The whole tape, as a file, so anyone can check our arithmetic instead of taking the mark
 * on trust. Withheld prints are included with their reason: an export that quietly dropped
 * them would let us publish a clean-looking history precisely when something had been
 * attempted.
 *
 * **No handles.** The per-commodity tape names both parties, because checking a specific
 * price means checking who traded it, and those names are already on the site. A
 * whole-history file is a different object: it is about prices, and shipping one that makes
 * mass profiling of individual traders trivial is not the same as being auditable.
 * Counterparty *pairing* survives as an anonymous per-row pair key, which is what someone
 * reproducing the integrity rules actually needs.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = apiLimit(url.searchParams.get("limit"), 10_000, 50_000);
  const since = url.searchParams.get("since");
  const sinceDate = since ? new Date(since) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    return apiError("`since` must be an ISO 8601 timestamp", 400);
  }

  try {
    const rows = await getDb().execute<{
      id: string; executed_at: string | Date; commodity_slug: string; commodity_name: string;
      side: string; price_per_scu: string; quantity_scu: number;
      excluded: boolean; exclusion_reason: string | null; pair_key: string | null;
    }>(sql`
      SELECT p.id::text, p.executed_at, c.slug AS commodity_slug, c.name AS commodity_name,
             p.side, p.price_per_scu::text, p.quantity_scu,
             p.excluded, p.exclusion_reason,
             -- Stable, order-independent, and not reversible to a handle: enough to group
             -- trades by relationship without naming anyone.
             CASE WHEN p.buyer_id IS NULL OR p.seller_id IS NULL THEN NULL
                  ELSE substr(md5(least(p.buyer_id::text, p.seller_id::text)
                                || greatest(p.buyer_id::text, p.seller_id::text)), 1, 12)
             END AS pair_key
      FROM trade_prints p
      JOIN commodities c ON c.id = p.commodity_id
      ${sinceDate ? sql`WHERE p.executed_at >= ${sinceDate.toISOString()}` : sql``}
      ORDER BY p.executed_at DESC
      LIMIT ${limit}
    `);

    return apiCsv(
      "kcx-prints.csv",
      [
        "print_id",
        "executed_at",
        "commodity_slug",
        "commodity_name",
        "side",
        "price_per_scu",
        "quantity_scu",
        "excluded",
        "exclusion_reason",
        "pair_key",
      ],
      rows.rows.map((r) => [
        r.id,
        new Date(r.executed_at).toISOString(),
        r.commodity_slug,
        r.commodity_name,
        r.side,
        r.price_per_scu,
        r.quantity_scu,
        r.excluded ? "true" : "false",
        r.exclusion_reason,
        r.pair_key,
      ]),
    );
  } catch (err) {
    console.error("[api:v1:prints.csv]", err instanceof Error ? err.message : err);
    return apiError("Unavailable", 503);
  }
}

export const OPTIONS = apiOptions;
