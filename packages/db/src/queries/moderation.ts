import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { ACTIVE_BAN, type BanDuration, banDurationMs, banSummary, isBanned } from "./bans";
import { contractBreaches, contractEvents, serviceContracts } from "../schema/contracts";
import { moderationActions } from "../schema/moderation";
import { users } from "../schema/orders";

/**
 * Moderator tooling.
 *
 * Every mutation here writes a row to `moderation_actions` in the same transaction as the
 * change it describes. A moderator log that can drift from what actually happened is worse
 * than none — it reads as authoritative while being wrong.
 */

export type ModResult = { ok: true } | { ok: false; error: string };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function logAction(
  tx: Tx,
  opts: {
    moderatorId: string;
    action: (typeof moderationActions.$inferInsert)["action"];
    targetType: (typeof moderationActions.$inferInsert)["targetType"];
    targetId: string;
    targetUserId?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  await tx.insert(moderationActions).values({
    moderatorId: opts.moderatorId,
    action: opts.action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    targetUserId: opts.targetUserId ?? null,
    reason: opts.reason ?? null,
  });
}

// ---------------------------------------------------------------- overview

export type ModOverview = {
  openBreaches: number;
  disputedBreaches: number;
  liveContracts: number;
  classifiedLive: number;
  bannedUsers: number;
  totalUsers: number;
};

export async function moderationOverview(db: Db): Promise<ModOverview> {
  const res = await db.execute<Record<string, string>>(sql`
    SELECT
      (SELECT count(*) FROM contract_breaches WHERE status = 'reported')::text  AS open_breaches,
      (SELECT count(*) FROM contract_breaches WHERE status = 'disputed')::text  AS disputed_breaches,
      (SELECT count(*) FROM service_contracts
         WHERE status IN ('open','bidding','awarded','in_progress'))::text      AS live_contracts,
      (SELECT count(*) FROM service_contracts
         WHERE visibility = 'classified'
           AND status IN ('open','bidding','awarded','in_progress'))::text      AS classified_live,
      (SELECT count(*) FROM users u2 WHERE u2.banned_at IS NOT NULL
         AND (u2.banned_until IS NULL OR u2.banned_until > now()))::text        AS banned_users,
      (SELECT count(*) FROM users)::text                                        AS total_users
  `);
  const r = res.rows[0] ?? {};
  return {
    openBreaches: Number(r.open_breaches ?? 0),
    disputedBreaches: Number(r.disputed_breaches ?? 0),
    liveContracts: Number(r.live_contracts ?? 0),
    classifiedLive: Number(r.classified_live ?? 0),
    bannedUsers: Number(r.banned_users ?? 0),
    totalUsers: Number(r.total_users ?? 0),
  };
}

// ---------------------------------------------------------------- breaches

export type BreachQueueItem = {
  contractId: string;
  contractTitle: string;
  status: string;
  reason: string;
  response: string | null;
  accusedId: string;
  accusedName: string;
  accusedBreaches: number;
  reporterName: string;
  createdAt: string;
  /** When the accused agreed to the conditions — the claim rests on this existing. */
  acknowledgedAt: string | null;
};

/** Breaches awaiting a ruling, oldest first — the queue is worked from the bottom up. */
export async function breachQueue(db: Db, opts: { includeResolved?: boolean } = {}): Promise<BreachQueueItem[]> {
  const res = await db.execute<{
    contract_id: string; contract_title: string; status: string; reason: string; response: string | null;
    accused_id: string; accused_name: string; accused_breaches: number; reporter_name: string;
    created_at: string | Date; acknowledged_at: string | Date | null;
  }>(sql`
    SELECT cb.contract_id::text, c.title AS contract_title, cb.status, cb.reason, cb.response,
           cb.accused_id::text, acc.display_name AS accused_name,
           (SELECT count(*) FROM contract_breaches x
              WHERE x.accused_id = cb.accused_id AND x.status <> 'dismissed')::int AS accused_breaches,
           rep.display_name AS reporter_name,
           cb.created_at,
           (SELECT max(ce.created_at) FROM contract_events ce
              WHERE ce.contract_id = cb.contract_id
                AND ce.type = 'classified_acknowledged') AS acknowledged_at
    FROM contract_breaches cb
    JOIN service_contracts c ON c.id = cb.contract_id
    JOIN users acc ON acc.id = cb.accused_id
    JOIN users rep ON rep.id = cb.reported_by_id
    ${opts.includeResolved ? sql`` : sql`WHERE cb.status IN ('reported','disputed')`}
    ORDER BY cb.created_at ASC
    LIMIT 200
  `);
  return res.rows.map((r) => ({
    contractId: r.contract_id,
    contractTitle: r.contract_title,
    status: r.status,
    reason: r.reason,
    response: r.response,
    accusedId: r.accused_id,
    accusedName: r.accused_name,
    accusedBreaches: r.accused_breaches,
    reporterName: r.reporter_name,
    createdAt: new Date(r.created_at).toISOString(),
    acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
  }));
}

// ---------------------------------------------------------------- users

export type ModUserRow = {
  id: string;
  handle: string;
  displayName: string;
  role: string;
  isVerified: boolean;
  bannedAt: string | null;
  bannedUntil: string | null;
  banLabel: string | null;
  breaches: number;
  contractsDone: number;
  createdAt: string;
};

export async function listUsersForMod(db: Db, search?: string | null): Promise<ModUserRow[]> {
  const term = search?.trim().toLowerCase();
  const res = await db.execute<{
    id: string; handle: string; display_name: string; role: string; is_verified: boolean;
    banned_at: string | Date | null; banned_until: string | Date | null; breaches: number; contracts_done: number; created_at: string | Date;
  }>(sql`
    SELECT u.id::text, u.handle, u.display_name, u.role, u.is_verified, u.banned_at, u.banned_until, u.created_at,
           (SELECT count(*) FROM contract_breaches cb
              WHERE cb.accused_id = u.id AND cb.status <> 'dismissed')::int AS breaches,
           (SELECT count(*) FROM service_contracts sc
              WHERE (sc.issuer_id = u.id OR sc.executor_id = u.id)
                AND sc.status = 'completed')::int AS contracts_done
    FROM users u
    ${term ? sql`WHERE u.handle LIKE ${`%${term}%`} OR lower(u.display_name) LIKE ${`%${term}%`}` : sql``}
    ORDER BY u.created_at DESC
    LIMIT 100
  `);
  return res.rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    role: r.role,
    isVerified: r.is_verified,
    bannedAt: r.banned_at ? new Date(r.banned_at).toISOString() : null,
    bannedUntil: r.banned_until ? new Date(r.banned_until).toISOString() : null,
    banLabel: banSummary({ bannedAt: r.banned_at, bannedUntil: r.banned_until }),
    breaches: r.breaches,
    contractsDone: r.contracts_done,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Ban for a fixed term or permanently, or reinstate.
 *
 * `duration` of null lifts the ban. A timed ban records when it ends; the checks that matter
 * compare against that time, so it expires on its own whether or not a sweep ever runs.
 */
export async function setUserBanned(
  db: Db,
  opts: { moderatorId: string; userId: string; duration: BanDuration | null; reason?: string },
): Promise<ModResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, opts.userId));
    if (!target) return { ok: false as const, error: "No such user" };
    if (target.id === opts.moderatorId) return { ok: false as const, error: "You can't ban yourself" };
    if (target.role === "admin") return { ok: false as const, error: "Admins can't be banned" };

    const banning = opts.duration !== null;
    const ms = banning ? banDurationMs(opts.duration!) : null;

    await tx
      .update(users)
      .set({
        bannedAt: banning ? new Date() : null,
        bannedUntil: banning && ms !== null ? new Date(Date.now() + ms) : null,
      })
      .where(eq(users.id, opts.userId));
    // Leaving live sessions alive would mean a banned account keeps working until its
    // cookie expires, which is not a ban.
    if (banning) {
      await tx.execute(sql`DELETE FROM auth_sessions WHERE user_id = ${opts.userId}::uuid`);
    }
    await logAction(tx, {
      moderatorId: opts.moderatorId,
      action: banning ? "user_banned" : "user_unbanned",
      targetType: "user",
      targetId: opts.userId,
      targetUserId: opts.userId,
      // The term is part of the record — "banned" alone doesn't say for how long.
      reason: banning ? `[${opts.duration}] ${opts.reason ?? ""}`.trim() : (opts.reason ?? null),
    });
    return { ok: true as const };
  });
}

/** Ban by RSI handle, for when a moderator has the name and not the row. */
export async function banUserByHandle(
  db: Db,
  opts: { moderatorId: string; handle: string; duration: BanDuration | null; reason?: string },
): Promise<ModResult> {
  const handle = opts.handle.trim().toLowerCase();
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle));
  if (!target) return { ok: false, error: `No account with the handle "${handle}"` };
  return setUserBanned(db, {
    moderatorId: opts.moderatorId,
    userId: target.id,
    duration: opts.duration,
    reason: opts.reason,
  });
}

/**
 * Set someone's role, including admin. Admin-only at the route; guarded again here.
 *
 * Demoting an existing admin is allowed — an owner needs to be able to undo an appointment —
 * but never the last one, and never your own. Locking every admin out of a system whose only
 * other route back in is a container restart is not a mistake worth allowing.
 */
export async function setUserRole(
  db: Db,
  opts: { moderatorId: string; userId: string; role: "user" | "mod" | "admin"; reason?: string },
): Promise<ModResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, opts.userId));
    if (!target) return { ok: false as const, error: "No such user" };
    if (target.id === opts.moderatorId) return { ok: false as const, error: "You can't change your own role" };
    if (target.role === opts.role) return { ok: false as const, error: `Already ${opts.role}` };

    if (target.role === "admin" && opts.role !== "admin") {
      const admins = await tx
        .select({ n: sql<string>`count(*)::text` })
        .from(users)
        .where(eq(users.role, "admin"));
      if (Number(admins[0]?.n ?? 0) <= 1) {
        return { ok: false as const, error: "That's the last admin — promote someone else first" };
      }
    }
    if (opts.role !== "user" && isBanned(target)) {
      return { ok: false as const, error: "Reinstate this account before giving it a role" };
    }

    await tx.update(users).set({ role: opts.role }).where(eq(users.id, opts.userId));
    await logAction(tx, {
      moderatorId: opts.moderatorId,
      action: opts.role === "user" ? "role_revoked" : "role_granted",
      targetType: "user",
      targetId: opts.userId,
      targetUserId: opts.userId,
      reason: `[${target.role} → ${opts.role}] ${opts.reason ?? ""}`.trim(),
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- contracts

/**
 * Pull a contract off the board.
 *
 * Only reaches contracts that haven't settled — a completed contract has already moved aUEC
 * and its record is what both parties' standing is built from, so it is not a mod's to erase.
 */
export async function voidContract(
  db: Db,
  opts: { moderatorId: string; contractId: string; reason: string },
): Promise<ModResult> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(serviceContracts).where(eq(serviceContracts.id, opts.contractId)).for("update");
    if (!c) return { ok: false as const, error: "Contract not found" };
    if (!["open", "bidding", "awarded", "in_progress"].includes(c.status)) {
      return { ok: false as const, error: `Contract is already ${c.status}` };
    }

    await tx
      .update(serviceContracts)
      .set({ status: "cancelled", cancelledById: opts.moderatorId, updatedAt: new Date() })
      .where(eq(serviceContracts.id, c.id));
    await tx.insert(contractEvents).values({
      contractId: c.id,
      actorId: opts.moderatorId,
      type: "cancelled",
      data: { byModerator: true },
    });
    await logAction(tx, {
      moderatorId: opts.moderatorId,
      action: "contract_voided",
      targetType: "contract",
      targetId: c.id,
      targetUserId: c.issuerId,
      reason: opts.reason,
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- log

export type ModLogRow = {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  moderatorName: string;
  targetUserName: string | null;
  reason: string | null;
  createdAt: string;
};

export async function moderationLog(db: Db, limit = 100): Promise<ModLogRow[]> {
  const res = await db.execute<{
    id: number; action: string; target_type: string; target_id: string;
    moderator_name: string; target_user_name: string | null; reason: string | null; created_at: string | Date;
  }>(sql`
    SELECT ma.id, ma.action, ma.target_type, ma.target_id, ma.reason, ma.created_at,
           mod_u.display_name AS moderator_name,
           tgt.display_name   AS target_user_name
    FROM moderation_actions ma
    JOIN users mod_u ON mod_u.id = ma.moderator_id
    LEFT JOIN users tgt ON tgt.id = ma.target_user_id
    ORDER BY ma.id DESC
    LIMIT ${Math.min(limit, 500)}
  `);
  return res.rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    moderatorName: r.moderator_name,
    targetUserName: r.target_user_name,
    reason: r.reason,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Shared with resolveContractBreach so a ruling and its log entry commit together.
 * Exported for that one caller rather than made public API.
 */
export { logAction as logModerationAction };

// ---------------------------------------------------------------- bootstrap

/**
 * Make sure the project owner holds admin.
 *
 * Runs at every worker boot rather than in a migration, because the account may not exist
 * when migrations run — someone has to sign up first.
 *
 * Admin rather than mod because someone has to be able to appoint the first moderators, and
 * granting the role is deliberately admin-only. Promotes from `user` or `mod`, so it also
 * upgrades an owner who was bootstrapped under the earlier mod-only behaviour. It is a
 * no-op once they are admin, and it never touches a banned account.
 */
export async function ensureBootstrapAdmin(db: Db, handle: string | undefined): Promise<string | null> {
  const target = (handle ?? "").trim().toLowerCase();
  if (!target) return null;

  const promoted = await db
    .update(users)
    .set({ role: "admin" })
    .where(
      and(
        eq(users.handle, target),
        sql`${users.role} IN ('user','mod')`,
        sql`NOT ${ACTIVE_BAN}`,
      ),
    )
    .returning({ handle: users.handle });
  return promoted[0]?.handle ?? null;
}

/** Recent breaches ruled on, for the log tab's "resolved" view. */
export async function resolvedBreaches(db: Db, limit = 50) {
  return db
    .select({
      contractId: contractBreaches.contractId,
      status: contractBreaches.status,
      resolvedAt: contractBreaches.resolvedAt,
    })
    .from(contractBreaches)
    .where(sql`${contractBreaches.status} IN ('upheld','dismissed')`)
    .orderBy(desc(contractBreaches.resolvedAt))
    .limit(limit);
}
