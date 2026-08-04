import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { contractEvents, contractRatings, serviceContracts } from "../schema/contracts";
import { users } from "../schema/orders";

export type ServiceContractDto = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  payout: number;
  status: string;
  locationName: string | null;
  imageFilename: string | null;
  issuerId: string;
  issuerName: string;
  executorId: string | null;
  executorName: string | null;
  expiresAt: string;
  createdAt: string;
  issuerConfirmed: boolean;
  executorConfirmed: boolean;
  /** Viewer-relative flags so the UI needn't re-derive them. */
  isIssuer: boolean;
  isExecutor: boolean;
};

export type ServiceContractListOptions = {
  viewerId?: string | null;
  statuses?: string[];
  mineOnly?: boolean;
  limit?: number;
};

export async function listContractsBoard(db: Db, opts: ServiceContractListOptions = {}): Promise<ServiceContractDto[]> {
  const statuses = opts.statuses ?? ["open", "in_progress"];
  const viewer = opts.viewerId ?? null;

  const rows = await db.execute<{
    id: string; title: string; description: string | null; category: string;
    payout: string; status: string; location_name: string | null; image_filename: string | null;
    issuer_id: string; issuer_name: string; executor_id: string | null; executor_name: string | null;
    // Raw execute() hands back whatever the driver produced — string or Date depending on
    // the column and parser, so these are normalised below rather than trusted.
    expires_at: string | Date; created_at: string | Date;
    issuer_confirmed_at: string | Date | null; executor_confirmed_at: string | Date | null;
  }>(sql`
    SELECT c.id::text, c.title, c.description, c.category, c.payout::text, c.status,
           l.name AS location_name, c.image_filename,
           c.issuer_id::text, iss.display_name AS issuer_name,
           c.executor_id::text, exe.display_name AS executor_name,
           c.expires_at, c.created_at, c.issuer_confirmed_at, c.executor_confirmed_at
    FROM service_contracts c
    JOIN users iss ON iss.id = c.issuer_id
    LEFT JOIN users exe ON exe.id = c.executor_id
    LEFT JOIN locations l ON l.id = c.location_id
    WHERE c.status IN (${sql.join(statuses.map((st) => sql`${st}`), sql`, `)})
      ${opts.mineOnly && viewer ? sql`AND (c.issuer_id = ${viewer}::uuid OR c.executor_id = ${viewer}::uuid)` : sql``}
    ORDER BY c.created_at DESC
    LIMIT ${Math.min(opts.limit ?? 200, 500)}
  `);

  return rows.rows.map((r) => ({
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
    isIssuer: viewer != null && r.issuer_id === viewer,
    isExecutor: viewer != null && r.executor_id === viewer,
  }));
}

/*
 * Contract payouts are collateral like any other obligation, so they are counted inside
 * COMMITTED_AUEC in queries/collateral.ts — not here. Keeping a second, separate figure
 * meant only the one caller that remembered to add it saw a trader's real exposure.
 */

export type ServiceContractResult = { ok: true; contractId?: string } | { ok: false; error: string };

/** Claim an open contract, locking it so several executors don't all start the same job. */
export async function claimContract(db: Db, contractId: string, executorId: string): Promise<ServiceContractResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, contractId)).for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };
    if (c.issuerId === executorId) return { ok: false as const, error: "You can't take your own contract" };
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
    if (c.status !== "open" && c.status !== "in_progress") {
      return { ok: false as const, error: `Contract is already ${c.status}` };
    }

    const now = new Date();

    if (opts.action === "cancel") {
      // An issuer withdrawing an unclaimed contract simply removes it; anyone abandoning
      // work already under way is recorded, because that is what standing is built from.
      const releasedOnly = isExecutor && c.status === "in_progress";
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
    const [issuer] = await tx.select().from(users).where(eq(users.id, c.issuerId)).for("update");
    if ((issuer?.auecBalance ?? 0) < c.payout) {
      return {
        ok: false as const,
        error: `The issuer has ${(issuer?.auecBalance ?? 0).toLocaleString()} aUEC but the payout is ${c.payout.toLocaleString()}. They need to top up their declared balance before this can settle.`,
      };
    }

    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} - ${c.payout}` })
      .where(eq(users.id, c.issuerId));
    await tx
      .update(users)
      .set({ auecBalance: sql`${users.auecBalance} + ${c.payout}` })
      .where(eq(users.id, c.executorId!));

    await tx
      .update(serviceContracts)
      .set({ status: "completed", issuerConfirmedAt, executorConfirmedAt, completedAt: now, updatedAt: now })
      .where(eq(serviceContracts.id, c.id));
    await tx.insert(contractEvents).values({
      contractId: c.id,
      actorId: opts.userId,
      type: "completed",
      data: { payout: c.payout },
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
      .where(and(sql`${serviceContracts.status} IN ('open','in_progress')`, sql`${serviceContracts.expiresAt} <= now()`))
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
