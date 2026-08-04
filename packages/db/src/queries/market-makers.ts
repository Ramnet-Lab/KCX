import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { marketMakerQuotes } from "../schema/market-makers";
import { buyCapacity, sellCapacity } from "./collateral";
import { canActForOrg } from "./orgs";

/**
 * Market maker quotes: posting them, standing them down, and measuring who actually stayed.
 *
 * The collateral rule is the same one the order board uses, applied to both sides at once —
 * a quote that isn't backed on both sides isn't a market, it is an advertisement.
 */

export type MakerQuoteDto = {
  id: string;
  userId: string;
  handle: string;
  displayName: string;
  orgId: string | null;
  orgSid: string | null;
  commodityId: number;
  commodityName: string;
  commoditySlug: string;
  bidPrice: number;
  askPrice: number;
  bidSizeScu: number;
  askSizeScu: number;
  /** Ask minus bid, and that as a percentage of the mid — the number that ranks makers. */
  spread: number;
  spreadPct: number;
  status: string;
  /** Total quoting time including the stretch currently open. */
  activeMinutes: number;
  fillsHonoured: number;
  scuHonoured: number;
  isMine: boolean;
  createdAt: string;
};

export type MakerResult = { ok: true; quoteId?: string } | { ok: false; error: string };

type QuoteRow = {
  id: string; user_id: string; handle: string; display_name: string;
  org_id: string | null; org_sid: string | null;
  commodity_id: number; commodity_name: string; commodity_slug: string;
  bid_price: string; ask_price: string; bid_size_scu: number; ask_size_scu: number;
  status: string; active_minutes: number; committed_since: string | Date | null;
  fills_honoured: number; scu_honoured: number; created_at: string | Date;
};

function toDto(r: QuoteRow, viewerId: string | null): MakerQuoteDto {
  const bid = Number(r.bid_price);
  const ask = Number(r.ask_price);
  const mid = (bid + ask) / 2;
  // The open stretch is added on read rather than written every minute — a background job
  // that ticks a counter for every live quote is a lot of writes to answer a question that
  // can simply be computed.
  const openMinutes = r.committed_since
    ? Math.floor((Date.now() - new Date(r.committed_since).getTime()) / 60_000)
    : 0;
  return {
    id: r.id,
    userId: r.user_id,
    handle: r.handle,
    displayName: r.display_name,
    orgId: r.org_id,
    orgSid: r.org_sid,
    commodityId: r.commodity_id,
    commodityName: r.commodity_name,
    commoditySlug: r.commodity_slug,
    bidPrice: bid,
    askPrice: ask,
    bidSizeScu: r.bid_size_scu,
    askSizeScu: r.ask_size_scu,
    spread: ask - bid,
    spreadPct: mid > 0 ? ((ask - bid) / mid) * 100 : 0,
    status: r.status,
    activeMinutes: r.active_minutes + Math.max(0, openMinutes),
    fillsHonoured: r.fills_honoured,
    scuHonoured: r.scu_honoured,
    isMine: viewerId != null && r.user_id === viewerId,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const QUOTE_SELECT = sql`
  SELECT q.id::text, q.user_id::text, u.handle, u.display_name,
         q.org_id::text, o.sid AS org_sid,
         q.commodity_id, c.name AS commodity_name, c.slug AS commodity_slug,
         q.bid_price::text, q.ask_price::text, q.bid_size_scu, q.ask_size_scu,
         q.status, q.active_minutes, q.committed_since,
         q.fills_honoured, q.scu_honoured, q.created_at
  FROM market_maker_quotes q
  JOIN users u ON u.id = q.user_id
  JOIN commodities c ON c.id = q.commodity_id
  LEFT JOIN orgs o ON o.id = q.org_id
`;

/**
 * Live quotes, tightest spread first.
 *
 * Ranked on spread rather than uptime because a tight quote is what a trader clearing right
 * now actually wants; uptime and honoured fills are shown beside it so they can tell a
 * tight quote from a tight quote that will still be there tomorrow.
 */
export async function listMakerQuotes(
  db: Db,
  opts: { commodityId?: number; userId?: string; viewerId?: string | null; includeInactive?: boolean } = {},
): Promise<MakerQuoteDto[]> {
  const rows = await db.execute<QuoteRow>(sql`
    ${QUOTE_SELECT}
    WHERE ${opts.includeInactive ? sql`q.status <> 'retired'` : sql`q.status = 'active'`}
      ${opts.commodityId ? sql`AND q.commodity_id = ${opts.commodityId}` : sql``}
      ${opts.userId ? sql`AND q.user_id = ${opts.userId}::uuid` : sql``}
    ORDER BY (q.ask_price - q.bid_price)::numeric / nullif((q.ask_price + q.bid_price) / 2.0, 0) ASC,
             q.active_minutes DESC
    LIMIT 200
  `);
  return rows.rows.map((r) => toDto(r, opts.viewerId ?? null));
}

/**
 * Post or revise a two-sided quote.
 *
 * BOTH sides are collateral-checked, and that is the whole point: the bid against aUEC (or
 * the org treasury, when quoting for one) and the ask against declared cargo. A quote
 * backed on one side only is an advertisement, not a market.
 *
 * The checks run against remaining capacity, so a maker who already has resting orders
 * cannot quote the same aUEC twice. Note this deliberately does NOT reserve the capacity in
 * `COMMITTED_AUEC`: a quote is an intention to trade at a price, not an order, and freezing
 * a maker's whole book behind a standing quote would stop them doing anything else.
 */
export async function upsertMakerQuote(
  db: Db,
  opts: {
    userId: string;
    orgId?: string | null;
    commodityId: number;
    bidPrice: number;
    askPrice: number;
    bidSizeScu: number;
    askSizeScu: number;
  },
): Promise<MakerResult> {
  if (opts.askPrice <= opts.bidPrice) {
    return { ok: false, error: "Your ask has to be above your bid — a crossed quote is free money for whoever spots it." };
  }
  if (opts.bidPrice <= 0 || opts.bidSizeScu <= 0 || opts.askSizeScu <= 0) {
    return { ok: false, error: "Prices and sizes have to be positive" };
  }

  const bidCost = opts.bidPrice * opts.bidSizeScu;
  if (opts.orgId) {
    const check = await canActForOrg(db, { orgId: opts.orgId, userId: opts.userId, amount: bidCost });
    if (!check.allowed) return { ok: false, error: check.reason ?? "The org can't back that bid" };
  } else {
    const capacity = await buyCapacity(db, opts.userId);
    if (bidCost > capacity.available) {
      return {
        ok: false,
        error: `Your bid side needs ${bidCost.toLocaleString()} aUEC but you have ${Math.max(0, capacity.available).toLocaleString()} free.`,
      };
    }
  }

  const cargo = await sellCapacity(db, opts.userId, opts.commodityId);
  if (opts.askSizeScu > cargo.available) {
    return {
      ok: false,
      error:
        cargo.held === 0
          ? "You hold none of this commodity — an ask you can't fill isn't a quote."
          : `Your ask side needs ${opts.askSizeScu.toLocaleString()} SCU but only ${cargo.available.toLocaleString()} of your declared holding is uncommitted.`,
    };
  }

  const now = new Date();
  const [row] = await db
    .insert(marketMakerQuotes)
    .values({
      userId: opts.userId,
      orgId: opts.orgId ?? null,
      commodityId: opts.commodityId,
      bidPrice: opts.bidPrice,
      askPrice: opts.askPrice,
      bidSizeScu: opts.bidSizeScu,
      askSizeScu: opts.askSizeScu,
      status: "active",
      committedSince: now,
    })
    .onConflictDoUpdate({
      target: [marketMakerQuotes.userId, marketMakerQuotes.commodityId],
      set: {
        orgId: opts.orgId ?? null,
        bidPrice: opts.bidPrice,
        askPrice: opts.askPrice,
        bidSizeScu: opts.bidSizeScu,
        askSizeScu: opts.askSizeScu,
        status: "active",
        // Revising prices does NOT reset uptime — a maker adjusting to the market is still
        // making it, and punishing that would push them toward leaving a stale quote up.
        // Only a stretch that actually stopped is closed, which `resumeMakerQuote` handles.
        committedSince: sql`coalesce(${marketMakerQuotes.committedSince}, ${now})`,
        updatedAt: now,
      },
    })
    .returning({ id: marketMakerQuotes.id });
  return row ? { ok: true, quoteId: row.id } : { ok: false, error: "Could not save the quote" };
}

/**
 * Stand a quote down, or retire it.
 *
 * Folds the open stretch into the accumulated total. Pausing is deliberately a first-class,
 * visible state: a maker who says "I'm away" is behaving better than one who leaves a quote
 * up they won't honour, and the record should be able to tell those apart.
 */
export async function setMakerQuoteStatus(
  db: Db,
  opts: { quoteId: string; userId: string; status: "active" | "paused" | "retired" },
): Promise<MakerResult> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(marketMakerQuotes).where(eq(marketMakerQuotes.id, opts.quoteId)).for("update");
    if (!q) return { ok: false as const, error: "Quote not found" };
    if (q.userId !== opts.userId) return { ok: false as const, error: "Not your quote" };
    if (q.status === opts.status) return { ok: true as const, quoteId: q.id };

    const now = new Date();
    const openMinutes = q.committedSince
      ? Math.max(0, Math.floor((now.getTime() - q.committedSince.getTime()) / 60_000))
      : 0;

    await tx
      .update(marketMakerQuotes)
      .set({
        status: opts.status,
        // Going active opens a new stretch; anything else closes the current one.
        activeMinutes: opts.status === "active" ? q.activeMinutes : q.activeMinutes + openMinutes,
        committedSince: opts.status === "active" ? now : null,
        updatedAt: now,
      })
      .where(eq(marketMakerQuotes.id, q.id));
    return { ok: true as const, quoteId: q.id };
  });
}

/**
 * Credit a maker for a fill they honoured.
 *
 * Called from settlement when a settled trade matches a live quote on the maker's side.
 * Uptime says they were there; this says they actually dealt when someone turned up, which
 * is the claim that matters and the one a quote left up unattended cannot fake.
 */
export async function creditMakerFill(
  db: Db,
  opts: { userId: string; commodityId: number; quantityScu: number },
): Promise<void> {
  await db
    .update(marketMakerQuotes)
    .set({
      fillsHonoured: sql`${marketMakerQuotes.fillsHonoured} + 1`,
      scuHonoured: sql`${marketMakerQuotes.scuHonoured} + ${opts.quantityScu}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(marketMakerQuotes.userId, opts.userId),
        eq(marketMakerQuotes.commodityId, opts.commodityId),
        eq(marketMakerQuotes.status, "active"),
      ),
    );
}

export type MakerStanding = {
  commodities: number;
  activeQuotes: number;
  totalMinutes: number;
  fillsHonoured: number;
  scuHonoured: number;
};

/** A trader's record as a maker, for their profile and the leaderboard. */
export async function makerStanding(db: Db, userId: string): Promise<MakerStanding> {
  const rows = await db.execute<{
    commodities: number; active: number; minutes: number; open_minutes: string | null;
    fills: number; scu: number;
  }>(sql`
    SELECT count(*)::int AS commodities,
           count(*) FILTER (WHERE status = 'active')::int AS active,
           coalesce(sum(active_minutes), 0)::int AS minutes,
           coalesce(sum(EXTRACT(EPOCH FROM (now() - committed_since)) / 60)
             FILTER (WHERE committed_since IS NOT NULL), 0)::text AS open_minutes,
           coalesce(sum(fills_honoured), 0)::int AS fills,
           coalesce(sum(scu_honoured), 0)::int AS scu
    FROM market_maker_quotes
    WHERE user_id = ${userId}::uuid AND status <> 'retired'
  `);
  const r = rows.rows[0];
  return {
    commodities: r?.commodities ?? 0,
    activeQuotes: r?.active ?? 0,
    totalMinutes: (r?.minutes ?? 0) + Math.floor(Number(r?.open_minutes ?? 0)),
    fillsHonoured: r?.fills ?? 0,
    scuHonoured: r?.scu ?? 0,
  };
}
