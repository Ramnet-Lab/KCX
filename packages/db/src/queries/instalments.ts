import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { bazaarSales } from "../schema/bazaar";
import { instalmentDefaults, instalmentPlans, instalments } from "../schema/instalments";
import { users } from "../schema/orders";
import {
  INSTALMENT_MAX_RATE_BPS,
  INSTALMENT_MAX_WINDOWS,
  INSTALMENT_MIN_WINDOWS,
  quoteInstalments,
} from "@kcx/shared";
import { bazaarStandingFor } from "./bazaar";

/**
 * Instalment plans: proposing, accepting, paying, and defaulting.
 *
 * Read the header of schema/instalments.ts first — the guards here only make sense against
 * the reasoning there. In short: this is a payment SCHEDULE, not a loan; the goods do not
 * move until it completes; and access is gated on identity and record because the cheapest
 * attack is a fresh account with nothing to lose.
 */

/**
 * There is no minimum sale price and no cap on the rate.
 *
 * Both were removed deliberately: what a schedule is worth is between the two parties, and a
 * seller who wants to offer terms on a small item — or to charge a lot for waiting — is
 * making a commercial decision, not one the exchange has any standing to overrule. What the
 * exchange still enforces is that the terms are visible before anyone agrees to them.
 *
 * The window range in @kcx/shared is the one remaining bound, and it is mechanical rather
 * than a policy: every window is a row.
 */

/** The buyer must be RSI-verified and have a real settlement record behind them. */
export const INSTALMENT_MIN_SETTLED = 5;
export const INSTALMENT_MIN_COMPLETION_PCT = 80;

/** How long past its due date a payment can sit before the plan defaults. */
export const INSTALMENT_GRACE_DAYS = 3;

/** One live plan at a time. Stacking schedules is how someone owes four people at once. */
export const MAX_ACTIVE_PLANS = 1;

export type InstalmentDto = {
  id: number;
  sequence: number;
  amount: number;
  dueAt: string;
  status: string;
  buyerConfirmed: boolean;
  sellerConfirmed: boolean;
  paidAt: string | null;
};

export type InstalmentPlanDto = {
  id: string;
  saleId: string;
  listingTitle: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  /** The sale price, before the charge for paying over time. */
  principal: number;
  /** The seller's advertised rate, and what the chosen window count actually costs. */
  baseRateBps: number;
  effectiveRateBps: number;
  interestAmount: number;
  totalAmount: number;
  instalmentCount: number;
  intervalDays: number;
  status: string;
  paidAmount: number;
  outstanding: number;
  /** The next payment still owed, if any. */
  nextDue: InstalmentDto | null;
  instalments: InstalmentDto[];
  isBuyer: boolean;
  isSeller: boolean;
  proposedByMe: boolean;
  createdAt: string;
};

export type InstalmentResult = { ok: true; planId?: string } | { ok: false; error: string };

/**
 * Whether this buyer may enter an instalment plan at all.
 *
 * Three gates, each closing a specific hole:
 *
 *  1. **RSI verified.** An unverified account is free to make, so without this the whole
 *     scheme is "take delivery of a schedule with a throwaway handle".
 *  2. **A settlement record.** Five settled sales at 80%+ completion. Not a credit score —
 *     a floor, so the first thing someone does on this site cannot be to owe somebody
 *     forty million.
 *  3. **No live plan already, and no prior default.** Someone who stopped paying once does
 *     not get a second schedule, and nobody runs two at a time.
 */
export async function canUseInstalments(
  db: Db,
  userId: string,
): Promise<{ allowed: boolean; reason: string | null }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { allowed: false, reason: "Sign in first" };
  if (!user.rsiVerifiedAt) {
    return { allowed: false, reason: "Instalment plans need a verified RSI handle." };
  }

  const standing = (await bazaarStandingFor(db, [userId])).get(userId);
  const settled = standing?.completed ?? 0;
  const pct = standing?.completionPct ?? 0;
  if (settled < INSTALMENT_MIN_SETTLED) {
    return {
      allowed: false,
      reason: `You need ${INSTALMENT_MIN_SETTLED} settled bazaar sales before paying in instalments — you have ${settled}.`,
    };
  }
  if (pct < INSTALMENT_MIN_COMPLETION_PCT) {
    return {
      allowed: false,
      reason: `Instalment plans need a settlement record of ${INSTALMENT_MIN_COMPLETION_PCT}% or better; yours is ${pct}%.`,
    };
  }

  const [{ defaults } = { defaults: 0 }] = await db
    .select({ defaults: sql<number>`count(*)::int` })
    .from(instalmentDefaults)
    .where(eq(instalmentDefaults.buyerId, userId));
  if (defaults > 0) {
    return { allowed: false, reason: "You have a recorded default on a previous instalment plan." };
  }

  const [{ live } = { live: 0 }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(instalmentPlans)
    .where(and(eq(instalmentPlans.buyerId, userId), sql`${instalmentPlans.status} IN ('proposed','active')`));
  if (live >= MAX_ACTIVE_PLANS) {
    return { allowed: false, reason: "You already have an instalment plan running. Finish it first." };
  }

  return { allowed: true, reason: null };
}

/**
 * Propose a schedule against a pending sale.
 *
 * The PRINCIPAL is taken from the sale, never from the caller — a plan cannot quietly change
 * what the goods cost. What it can add is the seller's advertised charge for waiting, priced
 * by @kcx/shared so the figure on the proposal screen and the figure in the schedule are
 * computed by the same code.
 *
 * Only the seller may set a rate. A buyer proposing their own interest is not a term anyone
 * would honour, so a buyer-side proposal is always at zero and the seller is free to decline
 * and put up their own.
 */
export async function proposeInstalmentPlan(
  db: Db,
  opts: {
    saleId: string;
    userId: string;
    instalmentCount: number;
    intervalDays: number;
    /** Basis points; 500 = 5.00%. Ignored unless the proposer is the seller. */
    rateBps?: number;
  },
): Promise<InstalmentResult> {
  const count = Math.floor(opts.instalmentCount);
  const interval = Math.floor(opts.intervalDays);
  if (count < INSTALMENT_MIN_WINDOWS || count > INSTALMENT_MAX_WINDOWS) {
    return { ok: false, error: `Between ${INSTALMENT_MIN_WINDOWS} and ${INSTALMENT_MAX_WINDOWS} payments.` };
  }
  if (interval < 1 || interval > 30) return { ok: false, error: "Payments must be 1–30 days apart." };
  const requestedRate = Math.max(0, Math.floor(opts.rateBps ?? 0));
  if (requestedRate > INSTALMENT_MAX_RATE_BPS) return { ok: false, error: "That rate isn't a real number." };

  return db.transaction(async (tx) => {
    const [sale] = await tx.select().from(bazaarSales).where(eq(bazaarSales.id, opts.saleId)).for("update");
    if (!sale) return { ok: false as const, error: "Sale not found" };
    if (sale.status !== "pending") return { ok: false as const, error: `That sale is already ${sale.status}` };
    if (sale.buyerId !== opts.userId && sale.sellerId !== opts.userId) {
      return { ok: false as const, error: "You're not party to that sale" };
    }
    const [existing] = await tx.select().from(instalmentPlans).where(eq(instalmentPlans.saleId, sale.id));
    if (existing) return { ok: false as const, error: "This sale already has a plan" };

    const gate = await canUseInstalments(tx as unknown as Db, sale.buyerId);
    if (!gate.allowed) {
      return {
        ok: false as const,
        error:
          sale.buyerId === opts.userId ? gate.reason! : `The buyer can't use instalments: ${gate.reason}`,
      };
    }

    // Only the seller's rate counts. A buyer-side proposal carries none.
    const baseRate = sale.sellerId === opts.userId ? requestedRate : 0;
    const quote = quoteInstalments(sale.totalPrice, baseRate, count);

    const [plan] = await tx
      .insert(instalmentPlans)
      .values({
        saleId: sale.id,
        buyerId: sale.buyerId,
        sellerId: sale.sellerId,
        proposedById: opts.userId,
        principal: quote.principal,
        baseRateBps: quote.baseRateBps,
        effectiveRateBps: quote.effectiveRateBps,
        interestAmount: quote.interest,
        totalAmount: quote.total,
        instalmentCount: count,
        intervalDays: interval,
      })
      .returning();

    // The whole schedule is written up front so both sides see every date and amount at the
    // moment they agree, rather than discovering the next one as it arrives. The rounding
    // sits on the FIRST payment — a buyer should not find the final instalment is the
    // awkward one after they have already paid everything else.
    const now = Date.now();
    await tx.insert(instalments).values(
      quote.schedule.map((amount, i) => ({
        planId: plan!.id,
        sequence: i + 1,
        amount,
        dueAt: new Date(now + i * interval * 86_400_000),
      })),
    );

    return { ok: true as const, planId: plan!.id };
  });
}

/** The other side accepts the schedule, or turns it down. */
export async function respondToInstalmentPlan(
  db: Db,
  opts: { planId: string; userId: string; action: "accept" | "decline" },
): Promise<InstalmentResult> {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(instalmentPlans).where(eq(instalmentPlans.id, opts.planId)).for("update");
    if (!plan) return { ok: false as const, error: "Plan not found" };
    if (plan.status !== "proposed") return { ok: false as const, error: `That plan is already ${plan.status}` };
    if (plan.buyerId !== opts.userId && plan.sellerId !== opts.userId) {
      return { ok: false as const, error: "You're not party to this plan" };
    }
    if (plan.proposedById === opts.userId) {
      return { ok: false as const, error: "You proposed it — the other side has to accept." };
    }

    const now = new Date();
    if (opts.action === "decline") {
      await tx
        .update(instalmentPlans)
        .set({ status: "cancelled", cancelledById: opts.userId, updatedAt: now })
        .where(eq(instalmentPlans.id, plan.id));
      return { ok: true as const, planId: plan.id };
    }

    // The sale's settlement window would otherwise expire out from under a plan that is
    // supposed to run for weeks.
    await tx
      .update(bazaarSales)
      .set({ settleBy: new Date(now.getTime() + (plan.instalmentCount * plan.intervalDays + INSTALMENT_GRACE_DAYS + 7) * 86_400_000) })
      .where(eq(bazaarSales.id, plan.saleId));

    await tx
      .update(instalmentPlans)
      .set({ status: "active", acceptedAt: now, updatedAt: now })
      .where(eq(instalmentPlans.id, plan.id));
    return { ok: true as const, planId: plan.id };
  });
}

/**
 * Confirm one instalment. Dual confirmation, as everywhere else.
 *
 * The buyer says they paid, the seller agrees, and only then does aUEC move. One
 * confirmation moves nothing: a seller cannot mark a payment received that never arrived,
 * and a buyer cannot mark one made.
 *
 * When the final instalment lands the whole sale completes — and that is the point at which
 * the goods are supposed to change hands, which both parties were told up front.
 */
export async function confirmInstalment(
  db: Db,
  opts: { instalmentId: number; userId: string },
): Promise<InstalmentResult> {
  return db.transaction(async (tx) => {
    const [ins] = await tx.select().from(instalments).where(eq(instalments.id, opts.instalmentId)).for("update");
    if (!ins) return { ok: false as const, error: "Instalment not found" };
    if (ins.status === "paid") return { ok: false as const, error: "That payment is already settled" };

    const [plan] = await tx.select().from(instalmentPlans).where(eq(instalmentPlans.id, ins.planId)).for("update");
    if (!plan) return { ok: false as const, error: "Plan not found" };
    if (plan.status !== "active") return { ok: false as const, error: `The plan is ${plan.status}` };

    const isBuyer = plan.buyerId === opts.userId;
    const isSeller = plan.sellerId === opts.userId;
    if (!isBuyer && !isSeller) return { ok: false as const, error: "You're not party to this plan" };

    // Payments settle in order. Confirming out of sequence would let a buyer skip an
    // awkward one and leave a hole nobody notices until the end.
    const [earlier] = await tx
      .select({ id: instalments.id })
      .from(instalments)
      .where(
        and(
          eq(instalments.planId, plan.id),
          sql`${instalments.sequence} < ${ins.sequence}`,
          sql`${instalments.status} <> 'paid'`,
        ),
      )
      .limit(1);
    if (earlier) return { ok: false as const, error: "Settle the earlier payments first." };

    const now = new Date();
    const buyerConfirmedAt = isBuyer ? (ins.buyerConfirmedAt ?? now) : ins.buyerConfirmedAt;
    const sellerConfirmedAt = isSeller ? (ins.sellerConfirmedAt ?? now) : ins.sellerConfirmedAt;

    if (!buyerConfirmedAt || !sellerConfirmedAt) {
      await tx
        .update(instalments)
        .set({ buyerConfirmedAt, sellerConfirmedAt, status: buyerConfirmedAt ? "buyer_confirmed" : ins.status })
        .where(eq(instalments.id, ins.id));
      return { ok: true as const, planId: plan.id };
    }

    // --- Both agreed: move this instalment ---
    const [buyer] = await tx.select().from(users).where(eq(users.id, plan.buyerId)).for("update");
    if ((buyer?.auecBalance ?? 0) < ins.amount) {
      return {
        ok: false as const,
        error: `The buyer has ${(buyer?.auecBalance ?? 0).toLocaleString()} aUEC declared but this payment is ${ins.amount.toLocaleString()}.`,
      };
    }
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} - ${ins.amount}` })
      .where(eq(users.id, plan.buyerId));
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} + ${ins.amount}` })
      .where(eq(users.id, plan.sellerId));

    await tx
      .update(instalments)
      .set({ status: "paid", buyerConfirmedAt, sellerConfirmedAt, paidAt: now })
      .where(eq(instalments.id, ins.id));

    const [{ outstanding } = { outstanding: 0 }] = await tx
      .select({ outstanding: sql<number>`count(*)::int` })
      .from(instalments)
      .where(and(eq(instalments.planId, plan.id), sql`${instalments.status} <> 'paid'`));

    if (outstanding === 0) {
      await tx
        .update(instalmentPlans)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(eq(instalmentPlans.id, plan.id));
      // The sale itself completes here — this is when the item is handed over. The aUEC has
      // already moved instalment by instalment, so settlement records it without moving it
      // a second time.
      await tx
        .update(bazaarSales)
        .set({ status: "completed", buyerConfirmedAt: now, sellerConfirmedAt: now, closedAt: now })
        .where(eq(bazaarSales.id, plan.saleId));
    }

    return { ok: true as const, planId: plan.id };
  });
}

/**
 * Default plans whose payment is past its grace period.
 *
 * The record is kept permanently and separately: a missed sale is somebody who didn't turn
 * up once, a default is somebody who took a schedule and stopped partway through. It notes
 * how far they got, because "defaulted on payment 6 of 8" and "took delivery and paid one"
 * are different facts and a bare count loses that.
 */
export async function expireInstalments(db: Db): Promise<number> {
  const due = await db
    .select({ id: instalments.id, planId: instalments.planId })
    .from(instalments)
    .innerJoin(instalmentPlans, eq(instalmentPlans.id, instalments.planId))
    .where(
      and(
        eq(instalmentPlans.status, "active"),
        sql`${instalments.status} IN ('due','buyer_confirmed')`,
        lte(instalments.dueAt, new Date(Date.now() - INSTALMENT_GRACE_DAYS * 86_400_000)),
      ),
    );

  const planIds = [...new Set(due.map((d) => d.planId))];
  let defaulted = 0;

  for (const planId of planIds) {
    await db.transaction(async (tx) => {
      const [plan] = await tx.select().from(instalmentPlans).where(eq(instalmentPlans.id, planId)).for("update");
      if (!plan || plan.status !== "active") return;

      const rows = await tx.select().from(instalments).where(eq(instalments.planId, plan.id));
      const paid = rows.filter((r) => r.status === "paid");
      const paidAmount = paid.reduce((sum, r) => sum + r.amount, 0);

      const now = new Date();
      await tx
        .update(instalments)
        .set({ status: "missed" })
        .where(and(eq(instalments.planId, plan.id), sql`${instalments.status} IN ('due','buyer_confirmed')`));
      await tx
        .update(instalmentPlans)
        .set({ status: "defaulted", defaultedAt: now, updatedAt: now })
        .where(eq(instalmentPlans.id, plan.id));
      await tx.insert(instalmentDefaults).values({
        planId: plan.id,
        buyerId: plan.buyerId,
        sellerId: plan.sellerId,
        paidInstalments: paid.length,
        totalInstalments: rows.length,
        amountPaid: paidAmount,
        amountOutstanding: plan.totalAmount - paidAmount,
      });
      // The underlying sale falls through: the seller never handed the item over, so the
      // units go back on the board rather than being stranded against a dead plan.
      await tx
        .update(bazaarSales)
        .set({ status: "cancelled", cancelledById: null, closedAt: now })
        .where(eq(bazaarSales.id, plan.saleId));
      defaulted += 1;
    });
  }
  return defaulted;
}

function toInstalmentDto(r: typeof instalments.$inferSelect): InstalmentDto {
  return {
    id: r.id,
    sequence: r.sequence,
    amount: r.amount,
    dueAt: r.dueAt.toISOString(),
    status: r.status,
    buyerConfirmed: r.buyerConfirmedAt != null,
    sellerConfirmed: r.sellerConfirmedAt != null,
    paidAt: r.paidAt?.toISOString() ?? null,
  };
}

/** Every plan this trader is party to, with its full schedule. */
export async function listInstalmentPlans(db: Db, userId: string): Promise<InstalmentPlanDto[]> {
  const rows = await db.execute<{
    id: string; sale_id: string; listing_title: string;
    buyer_id: string; buyer_name: string; seller_id: string; seller_name: string;
    principal: string; base_rate_bps: number; effective_rate_bps: number; interest_amount: string;
    total_amount: string; instalment_count: number; interval_days: number;
    status: string; proposed_by_id: string; created_at: string | Date;
  }>(sql`
    SELECT p.id::text, p.sale_id::text, l.title AS listing_title,
           p.buyer_id::text, b.display_name AS buyer_name,
           p.seller_id::text, s.display_name AS seller_name,
           p.principal::text, p.base_rate_bps, p.effective_rate_bps, p.interest_amount::text,
           p.total_amount::text, p.instalment_count, p.interval_days,
           p.status, p.proposed_by_id::text, p.created_at
    FROM instalment_plans p
    JOIN bazaar_sales sa ON sa.id = p.sale_id
    JOIN bazaar_listings l ON l.id = sa.listing_id
    JOIN users b ON b.id = p.buyer_id
    JOIN users s ON s.id = p.seller_id
    WHERE p.buyer_id = ${userId}::uuid OR p.seller_id = ${userId}::uuid
    ORDER BY p.created_at DESC
    LIMIT 50
  `);

  const out: InstalmentPlanDto[] = [];
  for (const r of rows.rows) {
    const schedule = await db
      .select()
      .from(instalments)
      .where(eq(instalments.planId, r.id))
      .orderBy(asc(instalments.sequence));
    const dtos = schedule.map(toInstalmentDto);
    const paidAmount = dtos.filter((d) => d.status === "paid").reduce((s, d) => s + d.amount, 0);
    out.push({
      id: r.id,
      saleId: r.sale_id,
      listingTitle: r.listing_title,
      buyerId: r.buyer_id,
      buyerName: r.buyer_name,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      principal: Number(r.principal),
      baseRateBps: r.base_rate_bps,
      effectiveRateBps: r.effective_rate_bps,
      interestAmount: Number(r.interest_amount),
      totalAmount: Number(r.total_amount),
      instalmentCount: r.instalment_count,
      intervalDays: r.interval_days,
      status: r.status,
      paidAmount,
      outstanding: Number(r.total_amount) - paidAmount,
      nextDue: dtos.find((d) => d.status !== "paid") ?? null,
      instalments: dtos,
      isBuyer: r.buyer_id === userId,
      isSeller: r.seller_id === userId,
      proposedByMe: r.proposed_by_id === userId,
      createdAt: new Date(r.created_at).toISOString(),
    });
  }
  return out;
}

/** Defaults on record against a trader — shown wherever their standing is. */
export async function instalmentDefaultCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(instalmentDefaults)
    .where(eq(instalmentDefaults.buyerId, userId));
  return row?.n ?? 0;
}
