import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { contractBids, contractEvents, contractRatings, serviceContracts } from "../schema/contracts";
import { users } from "../schema/orders";

/**
 * A contract as sent to one particular viewer.
 *
 * Most fields are nullable because a classified contract is redacted down to its TITLE for
 * anyone who hasn't taken it. The nulls are the redaction — there is no second, fuller
 * object behind this one.
 */
export type ServiceContractDto = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  /**
   * Fixed price, or the ceiling in bid mode. Stays visible even on a classified contract —
   * along with the title it is what someone needs to decide whether to take the job.
   */
  payout: number;
  status: string;
  locationName: string | null;
  imageFilename: string | null;
  issuerId: string | null;
  issuerName: string | null;
  executorId: string | null;
  executorName: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  issuerConfirmed: boolean;
  executorConfirmed: boolean;
  /** Viewer-relative flags so the UI needn't re-derive them. */
  isIssuer: boolean;
  isExecutor: boolean;

  pricingMode: string;
  visibility: string;
  /** True when this viewer is being shown a redacted copy. */
  redacted: boolean;

  // --- reverse auction ---
  bidsCloseAt: string | null;
  awardResponseHours: number | null;
  awardedToId: string | null;
  awardedToName: string | null;
  awardedAmount: number | null;
  awardExpiresAt: string | null;
  /** Bids are sealed: everyone sees the count, only the bidder sees their own number. */
  bidCount: number;
  myBid: { amount: number; status: string; note: string | null } | null;
  isAwardee: boolean;
};

export type ServiceContractListOptions = {
  viewerId?: string | null;
  viewerRole?: string | null;
  statuses?: string[];
  mineOnly?: boolean;
  limit?: number;
};

/**
 * Whether a viewer may see anything about a classified contract beyond its title.
 *
 * Deliberately NOT granted to the awarded bidder: the whole point of a classified posting
 * is that details land only once someone has committed to the job, so the reveal happens on
 * acceptance (which sets `executor_id`), not on winning the auction.
 */
export function canSeeContractDetails(
  contract: { visibility: string; issuerId: string; executorId: string | null },
  viewerId: string | null,
  viewerRole?: string | null,
): boolean {
  if (contract.visibility !== "classified") return true;
  if (viewerRole === "mod" || viewerRole === "admin") return true;
  if (!viewerId) return false;
  return contract.issuerId === viewerId || contract.executorId === viewerId;
}

export async function listContractsBoard(db: Db, opts: ServiceContractListOptions = {}): Promise<ServiceContractDto[]> {
  const statuses = opts.statuses ?? ["open", "bidding", "awarded", "in_progress"];
  const viewer = opts.viewerId ?? null;

  const rows = await db.execute<{
    id: string; title: string; description: string | null; category: string;
    payout: string; status: string; location_name: string | null; image_filename: string | null;
    issuer_id: string; issuer_name: string; executor_id: string | null; executor_name: string | null;
    // Raw execute() hands back whatever the driver produced — string or Date depending on
    // the column and parser, so these are normalised below rather than trusted.
    expires_at: string | Date; created_at: string | Date;
    issuer_confirmed_at: string | Date | null; executor_confirmed_at: string | Date | null;
    pricing_mode: string; visibility: string;
    bids_close_at: string | Date | null; award_response_hours: number | null;
    awarded_to_id: string | null; awarded_to_name: string | null;
    awarded_amount: string | null; award_expires_at: string | Date | null;
    bid_count: number; my_bid_amount: string | null; my_bid_status: string | null; my_bid_note: string | null;
  }>(sql`
    SELECT c.id::text, c.title, c.description, c.category, c.payout::text, c.status,
           l.name AS location_name, c.image_filename,
           c.issuer_id::text, iss.display_name AS issuer_name,
           c.executor_id::text, exe.display_name AS executor_name,
           c.expires_at, c.created_at, c.issuer_confirmed_at, c.executor_confirmed_at,
           c.pricing_mode, c.visibility,
           c.bids_close_at, c.award_response_hours,
           c.awarded_to_id::text, awd.display_name AS awarded_to_name,
           c.awarded_amount::text, c.award_expires_at,
           coalesce(b.bid_count, 0)::int AS bid_count,
           mine.amount::text AS my_bid_amount, mine.status AS my_bid_status, mine.note AS my_bid_note
    FROM service_contracts c
    JOIN users iss ON iss.id = c.issuer_id
    LEFT JOIN users exe ON exe.id = c.executor_id
    LEFT JOIN users awd ON awd.id = c.awarded_to_id
    LEFT JOIN locations l ON l.id = c.location_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS bid_count FROM contract_bids cb
      WHERE cb.contract_id = c.id AND cb.status <> 'withdrawn'
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT cb.amount, cb.status, cb.note FROM contract_bids cb
      WHERE cb.contract_id = c.id
        AND ${viewer ? sql`cb.bidder_id = ${viewer}::uuid` : sql`false`}
    ) mine ON true
    WHERE c.status IN (${sql.join(statuses.map((st) => sql`${st}`), sql`, `)})
      ${opts.mineOnly && viewer ? sql`AND (c.issuer_id = ${viewer}::uuid OR c.executor_id = ${viewer}::uuid OR c.awarded_to_id = ${viewer}::uuid)` : sql``}
    ORDER BY c.created_at DESC
    LIMIT ${Math.min(opts.limit ?? 200, 500)}
  `);

  return rows.rows.map((r) => {
    const isIssuer = viewer != null && r.issuer_id === viewer;
    const isExecutor = viewer != null && r.executor_id === viewer;
    // Redaction happens HERE, on the way out of the database, so there is no hidden copy
    // sitting in a payload for the UI to be trusted not to render.
    const canSee = canSeeContractDetails(
      { visibility: r.visibility, issuerId: r.issuer_id, executorId: r.executor_id },
      viewer,
      opts.viewerRole,
    );

    if (!canSee) {
      // A classified contract shows its TITLE and its PAYOUT — the two things someone needs
      // to decide whether to take it — and nothing else. What else survives is only what the
      // board physically cannot work without: the id to act on, the status and pricing mode
      // to know which button to draw, and the viewer's own bid. Every field that describes
      // the job, the location or the people is gone.
      return {
        id: r.id,
        title: r.title,
        description: null,
        category: null,
        payout: Number(r.payout),
        status: r.status,
        locationName: null,
        imageFilename: null,
        issuerId: null,
        issuerName: null,
        executorId: null,
        executorName: null,
        expiresAt: null,
        // Board order is decided in SQL, so the client never needs this — and when it was
        // posted is one more fact about the contract.
        createdAt: null,
        issuerConfirmed: false,
        executorConfirmed: false,
        isIssuer: false,
        isExecutor: false,
        pricingMode: r.pricing_mode,
        visibility: r.visibility,
        redacted: true,
        // Auction deadlines stay: without them nobody can tell whether there is still time
        // to bid, and they describe the listing's clock rather than the work itself.
        bidsCloseAt: r.bids_close_at ? new Date(r.bids_close_at).toISOString() : null,
        awardResponseHours: null,
        awardedToId: null,
        awardedToName: null,
        awardedAmount: null,
        awardExpiresAt: r.award_expires_at ? new Date(r.award_expires_at).toISOString() : null,
        bidCount: 0,
        // Their own bid is theirs to see — it is not a fact about the contract.
        myBid:
          r.my_bid_amount != null
            ? { amount: Number(r.my_bid_amount), status: r.my_bid_status!, note: r.my_bid_note }
            : null,
        isAwardee: viewer != null && r.awarded_to_id === viewer,
      };
    }

    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      payout: Number(r.payout),
      status: r.status,
      locationName: r.location_name,
      imageFilename: r.image_filename,
      issuerId: r.issuer_id,
      issuerName: r.issuer_name,
      executorId: r.executor_id,
      executorName: r.executor_name,
      expiresAt: new Date(r.expires_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
      issuerConfirmed: r.issuer_confirmed_at != null,
      executorConfirmed: r.executor_confirmed_at != null,
      isIssuer,
      isExecutor,
      pricingMode: r.pricing_mode,
      visibility: r.visibility,
      redacted: false,
      bidsCloseAt: r.bids_close_at ? new Date(r.bids_close_at).toISOString() : null,
      awardResponseHours: r.award_response_hours,
      awardedToId: r.awarded_to_id,
      awardedToName: r.awarded_to_name,
      awardedAmount: r.awarded_amount != null ? Number(r.awarded_amount) : null,
      awardExpiresAt: r.award_expires_at ? new Date(r.award_expires_at).toISOString() : null,
      bidCount: r.bid_count,
      myBid:
        r.my_bid_amount != null
          ? { amount: Number(r.my_bid_amount), status: r.my_bid_status!, note: r.my_bid_note }
          : null,
      isAwardee: viewer != null && r.awarded_to_id === viewer,
    };
  });
}

/*
 * Contract payouts are collateral like any other obligation, so they are counted inside
 * COMMITTED_AUEC in queries/collateral.ts — not here. Keeping a second, separate figure
 * meant only the one caller that remembered to add it saw a trader's real exposure.
 */

export type ServiceContractResult = { ok: true; contractId?: string } | { ok: false; error: string };

/** Transaction handle, as handed to the callback of `db.transaction`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const DEFAULT_AWARD_RESPONSE_HOURS = 24;

/**
 * Hand the contract to the cheapest bidder still standing.
 *
 * Ranking is amount ascending, then created_at ascending, so a tie goes to whoever bid
 * first — an arbitrary but fixed rule, which matters because the alternative is a winner
 * that changes depending on row order.
 *
 * Returns null when the bidder pool is empty, which is the caller's cue to close the
 * contract out rather than leave it awarded to nobody.
 */
async function awardNextBidder(
  tx: Tx,
  contract: { id: string; awardResponseHours: number | null; expiresAt: Date },
): Promise<{ bidderId: string; amount: number } | null> {
  const [next] = await tx
    .select()
    .from(contractBids)
    .where(and(eq(contractBids.contractId, contract.id), eq(contractBids.status, "active")))
    .orderBy(asc(contractBids.amount), asc(contractBids.createdAt))
    .limit(1);
  if (!next) return null;

  const now = new Date();
  const hours = contract.awardResponseHours ?? DEFAULT_AWARD_RESPONSE_HOURS;
  // Never let the acceptance window outlive the job's own deadline — otherwise someone
  // could accept a contract that has already expired.
  const window = new Date(now.getTime() + hours * 3_600_000);
  const awardExpiresAt = window > contract.expiresAt ? contract.expiresAt : window;

  await tx.update(contractBids).set({ status: "won", updatedAt: now }).where(eq(contractBids.id, next.id));
  await tx
    .update(serviceContracts)
    .set({
      status: "awarded",
      awardedToId: next.bidderId,
      awardedAmount: next.amount,
      awardExpiresAt,
      updatedAt: now,
    })
    .where(eq(serviceContracts.id, contract.id));
  await tx.insert(contractEvents).values({
    contractId: contract.id,
    actorId: null,
    type: "awarded",
    data: { bidderId: next.bidderId, amount: next.amount },
  });
  return { bidderId: next.bidderId, amount: next.amount };
}

/** Winner said no (or said nothing) — pass it down the list, or close it if nobody is left. */
async function cascadeAfterRefusal(
  tx: Tx,
  contract: { id: string; awardResponseHours: number | null; expiresAt: Date; awardedToId: string | null },
  eventType: "award_declined" | "award_lapsed" | "released",
  actorId: string | null,
): Promise<void> {
  const now = new Date();
  if (contract.awardedToId) {
    await tx
      .update(contractBids)
      .set({ status: "passed", updatedAt: now })
      .where(and(eq(contractBids.contractId, contract.id), eq(contractBids.bidderId, contract.awardedToId)));
  }
  await tx.insert(contractEvents).values({ contractId: contract.id, actorId, type: eventType, data: {} });

  await tx
    .update(serviceContracts)
    .set({ awardedToId: null, awardedAmount: null, awardExpiresAt: null, executorId: null, claimedAt: null, updatedAt: now })
    .where(eq(serviceContracts.id, contract.id));

  const next = await awardNextBidder(tx, contract);
  if (!next) {
    await tx
      .update(serviceContracts)
      .set({ status: "expired", updatedAt: now })
      .where(eq(serviceContracts.id, contract.id));
    await tx.insert(contractEvents).values({
      contractId: contract.id,
      actorId: null,
      type: "bidding_exhausted",
      data: {},
    });
  }
}

/** Place or revise a sealed bid. Bidders post no collateral — they are selling labour. */
export async function placeBid(
  db: Db,
  opts: { contractId: string; bidderId: string; amount: number; note?: string | null },
): Promise<ServiceContractResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, opts.contractId)).for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };
    if (c.pricingMode !== "bid") return { ok: false as const, error: "This contract isn't open to bids" };
    if (c.issuerId === opts.bidderId) return { ok: false as const, error: "You can't bid on your own contract" };
    if (c.status !== "bidding") return { ok: false as const, error: `Bidding is ${c.status === "open" ? "not open" : "closed"}` };
    if (c.bidsCloseAt && c.bidsCloseAt <= new Date()) return { ok: false as const, error: "Bidding has closed" };
    if (opts.amount > c.payout) {
      // Safe to quote the ceiling: the payout is listed on classified contracts too.
      return {
        ok: false as const,
        error: `Bid of ${opts.amount.toLocaleString()} aUEC is above the ${c.payout.toLocaleString()} ceiling.`,
      };
    }

    const [existing] = await tx
      .select()
      .from(contractBids)
      .where(and(eq(contractBids.contractId, c.id), eq(contractBids.bidderId, opts.bidderId)));

    const now = new Date();
    if (existing) {
      await tx
        .update(contractBids)
        .set({ amount: opts.amount, note: opts.note ?? null, status: "active", updatedAt: now })
        .where(eq(contractBids.id, existing.id));
    } else {
      await tx.insert(contractBids).values({
        contractId: c.id,
        bidderId: opts.bidderId,
        amount: opts.amount,
        note: opts.note ?? null,
      });
    }
    await tx.insert(contractEvents).values({
      contractId: c.id,
      actorId: opts.bidderId,
      type: existing ? "bid_revised" : "bid_placed",
      // No amount in the audit payload: contract_events is readable wherever the contract
      // is, and a sealed bid that leaks through its own event log is not sealed.
      data: {},
    });
    return { ok: true as const };
  });
}

export async function withdrawBid(db: Db, contractId: string, bidderId: string): Promise<ServiceContractResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, contractId)).for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };
    if (c.status !== "bidding") return { ok: false as const, error: "Bidding has closed — you can't withdraw now" };

    const [bid] = await tx
      .select()
      .from(contractBids)
      .where(and(eq(contractBids.contractId, contractId), eq(contractBids.bidderId, bidderId)));
    if (!bid || bid.status !== "active") return { ok: false as const, error: "You have no active bid here" };

    await tx.update(contractBids).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(contractBids.id, bid.id));
    await tx.insert(contractEvents).values({ contractId, actorId: bidderId, type: "bid_withdrawn", data: {} });
    return { ok: true as const };
  });
}

/**
 * Close every auction whose window has run out and award each to its lowest bidder.
 *
 * One transaction per contract rather than one for the batch: a single stuck row shouldn't
 * hold a lock across every other auction closing at the same minute.
 */
export async function closeContractBidding(db: Db): Promise<number> {
  const due = await db
    .select({ id: serviceContracts.id })
    .from(serviceContracts)
    .where(and(eq(serviceContracts.status, "bidding"), lte(serviceContracts.bidsCloseAt, new Date())));

  let closed = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, id)).for("update");
      if (!c || c.status !== "bidding") return;

      await tx.insert(contractEvents).values({ contractId: c.id, actorId: null, type: "bidding_closed", data: {} });

      const winner = await awardNextBidder(tx, c);
      if (!winner) {
        // Nobody bid. Expire it rather than leaving a dead auction on the board.
        await tx
          .update(serviceContracts)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(serviceContracts.id, c.id));
        await tx.insert(contractEvents).values({
          contractId: c.id,
          actorId: null,
          type: "bidding_exhausted",
          data: { reason: "no_bids" },
        });
      }
      closed += 1;
    });
  }
  return closed;
}

/** The winner accepts the award (becoming the executor) or turns it down. */
export async function respondToAward(
  db: Db,
  opts: { contractId: string; userId: string; action: "accept" | "decline" },
): Promise<ServiceContractResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, opts.contractId)).for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };
    if (c.status !== "awarded") return { ok: false as const, error: `Contract is ${c.status.replace("_", " ")}` };
    if (c.awardedToId !== opts.userId) return { ok: false as const, error: "This contract wasn't awarded to you" };
    if (c.awardExpiresAt && c.awardExpiresAt <= new Date()) {
      return { ok: false as const, error: "Your window to accept has passed" };
    }

    const now = new Date();
    if (opts.action === "decline") {
      await cascadeAfterRefusal(tx, c, "award_declined", opts.userId);
      return { ok: true as const };
    }

    if (c.expiresAt <= now) return { ok: false as const, error: "Contract has expired" };

    await tx
      .update(serviceContracts)
      .set({ executorId: opts.userId, status: "in_progress", claimedAt: now, updatedAt: now })
      .where(eq(serviceContracts.id, c.id));
    // Everyone else's bid is settled now, so the board stops showing them as live.
    await tx
      .update(contractBids)
      .set({ status: "lost", updatedAt: now })
      .where(and(eq(contractBids.contractId, c.id), eq(contractBids.status, "active")));
    await tx.insert(contractEvents).values({
      contractId: c.id,
      actorId: opts.userId,
      type: "award_accepted",
      data: { amount: c.awardedAmount },
    });
    return { ok: true as const };
  });
}

/** Winners who never answered — pass the job down the list. Runs on the expiry sweep. */
export async function expireContractAwards(db: Db): Promise<number> {
  const due = await db
    .select({ id: serviceContracts.id })
    .from(serviceContracts)
    .where(and(eq(serviceContracts.status, "awarded"), lte(serviceContracts.awardExpiresAt, new Date())));

  let lapsed = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, id)).for("update");
      if (!c || c.status !== "awarded") return;
      await cascadeAfterRefusal(tx, c, "award_lapsed", null);
      lapsed += 1;
    });
  }
  return lapsed;
}

/** Claim an open contract, locking it so several executors don't all start the same job. */
export async function claimContract(db: Db, contractId: string, executorId: string): Promise<ServiceContractResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, contractId)).for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };
    if (c.issuerId === executorId) return { ok: false as const, error: "You can't take your own contract" };
    if (c.pricingMode === "bid") {
      return { ok: false as const, error: "This contract goes to the lowest bidder — place a bid instead" };
    }
    if (c.status !== "open") return { ok: false as const, error: `Contract is ${c.status.replace("_", " ")}` };
    if (c.expiresAt <= new Date()) return { ok: false as const, error: "Contract has expired" };

    await tx
      .update(serviceContracts)
      .set({ executorId, status: "in_progress", claimedAt: new Date(), updatedAt: new Date() })
      .where(eq(serviceContracts.id, contractId));
    await tx.insert(contractEvents).values({ contractId, actorId: executorId, type: "claimed", data: {} });
    return { ok: true as const };
  });
}

/**
 * Confirm or abandon a contract.
 *
 * Settlement needs BOTH sides — the executor saying the work is done and the issuer
 * agreeing it was. One confirmation alone changes nothing, exactly as commodity escrow
 * behaves, because only the issuer can judge whether the job actually got done.
 */
export async function resolveServiceContract(
  db: Db,
  opts: { contractId: string; userId: string; action: "confirm" | "cancel" },
): Promise<ServiceContractResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(serviceContracts)
      .where(eq(serviceContracts.id, opts.contractId))
      .for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };

    const isIssuer = c.issuerId === opts.userId;
    const isExecutor = c.executorId === opts.userId;
    if (!isIssuer && !isExecutor) return { ok: false as const, error: "You're not party to this contract" };
    if (!["open", "bidding", "awarded", "in_progress"].includes(c.status)) {
      return { ok: false as const, error: `Contract is already ${c.status}` };
    }

    const now = new Date();

    if (opts.action === "cancel") {
      // An issuer withdrawing an unclaimed contract simply removes it; anyone abandoning
      // work already under way is recorded, because that is what standing is built from.
      const releasedOnly = isExecutor && c.status === "in_progress";

      if (releasedOnly && c.pricingMode === "bid") {
        // An executor walking away from an auction job hands it to the next-cheapest
        // bidder rather than reverting to an open contract that has no agreed price.
        await tx
          .update(serviceContracts)
          .set({ executorConfirmedAt: null, updatedAt: now })
          .where(eq(serviceContracts.id, c.id));
        await cascadeAfterRefusal(tx, c, "released", opts.userId);
        return { ok: true as const };
      }

      await tx
        .update(serviceContracts)
        .set(
          releasedOnly
            ? { executorId: null, status: "open", claimedAt: null, executorConfirmedAt: null, updatedAt: now }
            : { status: "cancelled", cancelledById: opts.userId, updatedAt: now },
        )
        .where(eq(serviceContracts.id, c.id));
      await tx.insert(contractEvents).values({
        contractId: c.id,
        actorId: opts.userId,
        type: releasedOnly ? "released" : "cancelled",
        data: {},
      });
      return { ok: true as const };
    }

    if (c.status !== "in_progress") {
      return { ok: false as const, error: "Nobody has taken this contract yet" };
    }

    const issuerConfirmedAt = isIssuer ? (c.issuerConfirmedAt ?? now) : c.issuerConfirmedAt;
    const executorConfirmedAt = isExecutor ? (c.executorConfirmedAt ?? now) : c.executorConfirmedAt;

    await tx.insert(contractEvents).values({
      contractId: c.id,
      actorId: opts.userId,
      type: isIssuer ? "confirmed_by_issuer" : "confirmed_by_executor",
      data: {},
    });

    if (!issuerConfirmedAt || !executorConfirmedAt) {
      await tx
        .update(serviceContracts)
        .set({ issuerConfirmedAt, executorConfirmedAt, updatedAt: now })
        .where(eq(serviceContracts.id, c.id));
      return { ok: true as const };
    }

    // --- Both agreed: move the payout ---
    // An auction settles at the winning bid, never the advertised ceiling.
    const settlement = c.awardedAmount ?? c.payout;

    const [issuer] = await tx.select().from(users).where(eq(users.id, c.issuerId)).for("update");
    if ((issuer?.auecBalance ?? 0) < settlement) {
      return {
        ok: false as const,
        error: `The issuer has ${(issuer?.auecBalance ?? 0).toLocaleString()} aUEC but the payout is ${settlement.toLocaleString()}. They need to top up their declared balance before this can settle.`,
      };
    }

    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} - ${settlement}` })
      .where(eq(users.id, c.issuerId));
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} + ${settlement}` })
      .where(eq(users.id, c.executorId!));

    await tx
      .update(serviceContracts)
      .set({ status: "completed", issuerConfirmedAt, executorConfirmedAt, completedAt: now, updatedAt: now })
      .where(eq(serviceContracts.id, c.id));
    await tx.insert(contractEvents).values({
      contractId: c.id,
      actorId: opts.userId,
      type: "completed",
      data: { payout: settlement, ceiling: c.payout },
    });
    return { ok: true as const };
  });
}

/** Close out contracts past their deadline. Runs on the same sweep as order expiry. */
export async function expireServiceContracts(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(serviceContracts)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          sql`${serviceContracts.status} IN ('open','bidding','awarded','in_progress')`,
          sql`${serviceContracts.expiresAt} <= now()`,
        ),
      )
      .returning({ id: serviceContracts.id });
    if (expired.length > 0) {
      await tx
        .insert(contractEvents)
        .values(expired.map((c) => ({ contractId: c.id, actorId: null, type: "expired" as const, data: {} })));
    }
    return expired.length;
  });
}

/**
 * Contract standing — the same two-signal shape as trading standing, computed from an
 * entirely separate pool of work so the two reputations never bleed into each other.
 */
export type ContractStanding = {
  completed: number;
  undertaken: number;
  completionPct: number | null;
  stars: number | null;
  ratingCount: number;
};

export const EMPTY_CONTRACT_STANDING: ContractStanding = {
  completed: 0,
  undertaken: 0,
  completionPct: null,
  stars: null,
  ratingCount: 0,
};

export async function contractStandingFor(db: Db, userIds: string[]): Promise<Map<string, ContractStanding>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const res = await db.execute<{
    user_id: string; completed: number; undertaken: number; avg_stars: string | null; rating_count: number;
  }>(sql`
    SELECT u.id::text AS user_id,
           coalesce(c.completed, 0)::int   AS completed,
           coalesce(c.undertaken, 0)::int  AS undertaken,
           r.avg_stars::text               AS avg_stars,
           coalesce(r.rating_count, 0)::int AS rating_count
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE sc.status = 'completed') AS completed,
             count(*) FILTER (WHERE sc.status IN ('completed','cancelled','expired')) AS undertaken
      FROM service_contracts sc
      WHERE sc.issuer_id = u.id OR sc.executor_id = u.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT avg(stars)::numeric(3,2) AS avg_stars, count(*) AS rating_count
      FROM contract_ratings WHERE rated_id = u.id
    ) r ON true
    WHERE u.id IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
  `);

  return new Map(
    res.rows.map((r) => [
      r.user_id,
      {
        completed: r.completed,
        undertaken: r.undertaken,
        completionPct: r.undertaken > 0 ? Math.round((r.completed / r.undertaken) * 100) : null,
        stars: r.avg_stars != null ? Number(r.avg_stars) : null,
        ratingCount: r.rating_count,
      },
    ]),
  );
}

/** Completed contracts the viewer can still rate. */
export async function pendingContractRatings(
  db: Db,
  userId: string,
): Promise<{ contractId: string; counterpartyName: string; title: string }[]> {
  const res = await db.execute<{ contract_id: string; counterparty_name: string; title: string }>(sql`
    SELECT c.id::text AS contract_id, other.display_name AS counterparty_name, c.title
    FROM service_contracts c
    JOIN users other
      ON other.id = CASE WHEN c.issuer_id = ${userId}::uuid THEN c.executor_id ELSE c.issuer_id END
    WHERE c.status = 'completed'
      AND (c.issuer_id = ${userId}::uuid OR c.executor_id = ${userId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM contract_ratings cr
        WHERE cr.contract_id = c.id AND cr.rater_id = ${userId}::uuid
      )
    ORDER BY c.completed_at DESC
    LIMIT 20
  `);
  return res.rows.map((r) => ({
    contractId: r.contract_id,
    counterpartyName: r.counterparty_name,
    title: r.title,
  }));
}
