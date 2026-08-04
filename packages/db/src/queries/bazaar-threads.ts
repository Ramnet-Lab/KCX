import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { bazaarListings, bazaarMessages, bazaarSales, bazaarThreads } from "../schema/bazaar";
import { users } from "../schema/orders";
import { BAZAAR_SETTLE_HOURS } from "./bazaar";
import { committedAuecSql } from "./collateral";

/**
 * Negotiation on the bazaar: talking, offering, and turning an accepted offer into a sale.
 *
 * The rule underneath all of it is that an offer is a thing one party said and the OTHER
 * party accepts. Nobody can accept their own number, because that isn't a negotiation — it
 * is a unilateral price change with extra steps, and it would let a seller manufacture a
 * settled print at any figure they liked.
 */

export const MESSAGE_MAX = 2000;

export type BazaarMessageDto = {
  id: number;
  senderId: string | null;
  senderName: string | null;
  kind: string;
  body: string | null;
  offerUnitPrice: number | null;
  offerQuantity: number | null;
  offerStatus: string | null;
  saleId: string | null;
  isMine: boolean;
  createdAt: string;
};

export type BazaarThreadDto = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingIntent: string;
  listingStatus: string;
  thumbnail: string | null;
  ownerId: string;
  ownerName: string;
  counterpartyId: string;
  counterpartyName: string;
  /** Viewer-relative, so the UI needn't work out which end it is looking from. */
  isOwner: boolean;
  otherPartyName: string;
  status: string;
  unread: boolean;
  lastMessageAt: string;
  createdAt: string;
  /** Populated by getBazaarThread; empty on the list view. */
  messages: BazaarMessageDto[];
  /** The one offer currently on the table, if any. */
  openOffer: BazaarMessageDto | null;
};

export type ThreadResult =
  | { ok: true; threadId: string; saleId?: string }
  | { ok: false; error: string };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type ThreadRow = {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_intent: string;
  listing_status: string;
  thumbnail: string | null;
  owner_id: string;
  owner_name: string;
  counterparty_id: string;
  counterparty_name: string;
  status: string;
  last_message_at: string | Date;
  owner_read_at: string | Date | null;
  counterparty_read_at: string | Date | null;
  created_at: string | Date;
};

function toThreadDto(r: ThreadRow, viewerId: string): BazaarThreadDto {
  const isOwner = r.owner_id === viewerId;
  const readAt = isOwner ? r.owner_read_at : r.counterparty_read_at;
  return {
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    listingIntent: r.listing_intent,
    listingStatus: r.listing_status,
    thumbnail: r.thumbnail,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    counterpartyId: r.counterparty_id,
    counterpartyName: r.counterparty_name,
    isOwner,
    otherPartyName: isOwner ? r.counterparty_name : r.owner_name,
    status: r.status,
    // Never read at all counts as unread — otherwise a brand-new thread looks seen.
    unread: readAt == null || new Date(readAt) < new Date(r.last_message_at),
    lastMessageAt: new Date(r.last_message_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    messages: [],
    openOffer: null,
  };
}

const THREAD_SELECT = sql`
  SELECT t.id::text, t.listing_id::text, l.title AS listing_title,
         l.intent AS listing_intent, l.status AS listing_status,
         img.filename AS thumbnail,
         t.owner_id::text, o.display_name AS owner_name,
         t.counterparty_id::text, c.display_name AS counterparty_name,
         t.status, t.last_message_at, t.owner_read_at, t.counterparty_read_at, t.created_at
  FROM bazaar_threads t
  JOIN bazaar_listings l ON l.id = t.listing_id
  JOIN users o ON o.id = t.owner_id
  JOIN users c ON c.id = t.counterparty_id
  LEFT JOIN LATERAL (
    SELECT i.filename FROM bazaar_listing_images i
    WHERE i.listing_id = l.id ORDER BY i.sort_index, i.id LIMIT 1
  ) img ON true
`;

/** Every conversation this trader is part of, most recently active first. */
export async function listBazaarThreads(db: Db, userId: string): Promise<BazaarThreadDto[]> {
  const rows = await db.execute<ThreadRow>(sql`
    ${THREAD_SELECT}
    WHERE t.owner_id = ${userId}::uuid OR t.counterparty_id = ${userId}::uuid
    ORDER BY t.last_message_at DESC
    LIMIT 200
  `);
  return rows.rows.map((r) => toThreadDto(r, userId));
}

/** How many conversations are waiting on this trader — the badge on the desk. */
export async function unreadThreadCount(db: Db, userId: string): Promise<number> {
  const res = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM bazaar_threads t
    WHERE (t.owner_id = ${userId}::uuid AND (t.owner_read_at IS NULL OR t.owner_read_at < t.last_message_at))
       OR (t.counterparty_id = ${userId}::uuid AND (t.counterparty_read_at IS NULL OR t.counterparty_read_at < t.last_message_at))
  `);
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * One thread with its messages.
 *
 * Returns null for anyone who isn't a party or a moderator — a private negotiation that
 * leaks on a guessed id is not private, and the id is the only thing standing between the
 * two of them and everyone else.
 */
export async function getBazaarThread(
  db: Db,
  threadId: string,
  viewerId: string,
  viewerRole?: string | null,
): Promise<BazaarThreadDto | null> {
  const rows = await db.execute<ThreadRow>(sql`${THREAD_SELECT} WHERE t.id = ${threadId}::uuid LIMIT 1`);
  const row = rows.rows[0];
  if (!row) return null;

  const isMod = viewerRole === "mod" || viewerRole === "admin";
  if (row.owner_id !== viewerId && row.counterparty_id !== viewerId && !isMod) return null;

  const messages = await db
    .select({
      id: bazaarMessages.id,
      senderId: bazaarMessages.senderId,
      senderName: users.displayName,
      kind: bazaarMessages.kind,
      body: bazaarMessages.body,
      offerUnitPrice: bazaarMessages.offerUnitPrice,
      offerQuantity: bazaarMessages.offerQuantity,
      offerStatus: bazaarMessages.offerStatus,
      saleId: bazaarMessages.saleId,
      createdAt: bazaarMessages.createdAt,
    })
    .from(bazaarMessages)
    .leftJoin(users, eq(users.id, bazaarMessages.senderId))
    .where(eq(bazaarMessages.threadId, threadId))
    .orderBy(asc(bazaarMessages.createdAt), asc(bazaarMessages.id));

  const dto = toThreadDto(row, viewerId);
  dto.messages = messages.map((m) => ({
    id: m.id,
    senderId: m.senderId,
    senderName: m.senderName,
    kind: m.kind,
    body: m.body,
    offerUnitPrice: m.offerUnitPrice,
    offerQuantity: m.offerQuantity,
    offerStatus: m.offerStatus,
    saleId: m.saleId,
    isMine: m.senderId === viewerId,
    createdAt: m.createdAt.toISOString(),
  }));
  dto.openOffer = dto.messages.find((m) => m.offerStatus === "open") ?? null;
  return dto;
}

/** Mark a thread read by this viewer, so the badge clears. */
export async function markThreadRead(db: Db, threadId: string, userId: string): Promise<void> {
  const now = new Date();
  await db
    .update(bazaarThreads)
    .set({ ownerReadAt: now })
    .where(and(eq(bazaarThreads.id, threadId), eq(bazaarThreads.ownerId, userId)));
  await db
    .update(bazaarThreads)
    .set({ counterpartyReadAt: now })
    .where(and(eq(bazaarThreads.id, threadId), eq(bazaarThreads.counterpartyId, userId)));
}

/** Open the thread between this listing's owner and this trader, creating it on first contact. */
async function ensureThread(tx: Tx, listingId: string, ownerId: string, userId: string): Promise<string> {
  const [existing] = await tx
    .select({ id: bazaarThreads.id })
    .from(bazaarThreads)
    .where(and(eq(bazaarThreads.listingId, listingId), eq(bazaarThreads.counterpartyId, userId)));
  if (existing) return existing.id;

  const [created] = await tx
    .insert(bazaarThreads)
    .values({ listingId, ownerId, counterpartyId: userId })
    .onConflictDoNothing({ target: [bazaarThreads.listingId, bazaarThreads.counterpartyId] })
    .returning({ id: bazaarThreads.id });
  if (created) return created.id;

  // Lost a race with the same person double-clicking; theirs is as good as ours.
  const [raced] = await tx
    .select({ id: bazaarThreads.id })
    .from(bazaarThreads)
    .where(and(eq(bazaarThreads.listingId, listingId), eq(bazaarThreads.counterpartyId, userId)));
  return raced!.id;
}

/**
 * Say something, optionally with a price attached.
 *
 * `threadId` continues an existing conversation; `listingId` starts one. Both routes end up
 * in the same place, which matters because the listing owner replying and the interested
 * trader opening are the same act from opposite ends.
 */
export async function postBazaarMessage(
  db: Db,
  opts: {
    threadId?: string;
    listingId?: string;
    senderId: string;
    body?: string | null;
    offerUnitPrice?: number | null;
    offerQuantity?: number | null;
  },
): Promise<ThreadResult> {
  return db.transaction(async (tx) => {
    let threadId = opts.threadId ?? null;
    let listingId = opts.listingId ?? null;
    let ownerId: string | null = null;

    if (threadId) {
      const [t] = await tx.select().from(bazaarThreads).where(eq(bazaarThreads.id, threadId)).for("update");
      if (!t) return { ok: false as const, error: "Conversation not found" };
      if (t.ownerId !== opts.senderId && t.counterpartyId !== opts.senderId) {
        return { ok: false as const, error: "You're not part of this conversation" };
      }
      if (t.status === "closed") return { ok: false as const, error: "This conversation is closed" };
      listingId = t.listingId;
      ownerId = t.ownerId;
    } else {
      if (!listingId) return { ok: false as const, error: "Nothing to reply to" };
      const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, listingId));
      if (!l) return { ok: false as const, error: "Listing not found" };
      if (l.sellerId === opts.senderId) {
        return { ok: false as const, error: "This is your own listing — reply from the conversation instead" };
      }
      if (!["active", "paused"].includes(l.status)) {
        return { ok: false as const, error: `This listing is ${l.status.replace(/_/g, " ")}` };
      }
      ownerId = l.sellerId;
      threadId = await ensureThread(tx, listingId, l.sellerId, opts.senderId);
    }

    const body = opts.body?.trim().slice(0, MESSAGE_MAX) || null;
    const price = opts.offerUnitPrice ?? null;
    if (!body && price == null) return { ok: false as const, error: "Say something first" };

    const now = new Date();

    if (price != null) {
      if (price <= 0) return { ok: false as const, error: "An offer has to be a positive number" };
      // Only one live offer per thread. Superseding rather than stacking means "the offer"
      // is always unambiguous — with two open, accepting one silently rejects the other and
      // the two sides can disagree about which was on the table.
      await tx
        .update(bazaarMessages)
        .set({ offerStatus: "superseded" })
        .where(and(eq(bazaarMessages.threadId, threadId), eq(bazaarMessages.offerStatus, "open")));
    }

    await tx.insert(bazaarMessages).values({
      threadId,
      senderId: opts.senderId,
      kind: price != null ? "offer" : "message",
      body,
      offerUnitPrice: price,
      offerQuantity: price != null ? (opts.offerQuantity ?? 1) : null,
      offerStatus: price != null ? "open" : null,
    });

    // Sending is also reading: the sender has plainly seen everything before their own reply.
    await tx
      .update(bazaarThreads)
      .set({
        lastMessageAt: now,
        ...(ownerId === opts.senderId ? { ownerReadAt: now } : { counterpartyReadAt: now }),
      })
      .where(eq(bazaarThreads.id, threadId));

    return { ok: true as const, threadId };
  });
}

/**
 * Take an offer, which strikes the sale.
 *
 * The accepting party is never the one who made the offer. Which of them ends up as buyer
 * depends on the listing's intent, not on who owns it: on a wanted ad the poster is the
 * buyer, and getting that backwards would commit the wrong person's aUEC.
 */
export async function acceptBazaarOffer(
  db: Db,
  opts: { messageId: number; userId: string },
): Promise<ThreadResult> {
  return db.transaction(async (tx) => {
    const [msg] = await tx.select().from(bazaarMessages).where(eq(bazaarMessages.id, opts.messageId)).for("update");
    if (!msg || msg.offerStatus == null) return { ok: false as const, error: "Offer not found" };
    if (msg.offerStatus !== "open") return { ok: false as const, error: `That offer was already ${msg.offerStatus}` };

    const [t] = await tx.select().from(bazaarThreads).where(eq(bazaarThreads.id, msg.threadId)).for("update");
    if (!t) return { ok: false as const, error: "Conversation not found" };
    if (t.ownerId !== opts.userId && t.counterpartyId !== opts.userId) {
      return { ok: false as const, error: "You're not part of this conversation" };
    }
    if (msg.senderId === opts.userId) {
      return { ok: false as const, error: "You can't accept your own offer — wait for them to take it." };
    }

    const [l] = await tx.select().from(bazaarListings).where(eq(bazaarListings.id, t.listingId)).for("update");
    if (!l) return { ok: false as const, error: "Listing not found" };
    if (l.status !== "active" && l.status !== "paused") {
      return { ok: false as const, error: `This listing is ${l.status.replace(/_/g, " ")}` };
    }

    const qty = msg.offerQuantity ?? 1;
    if (qty > l.remainingQuantity) {
      return { ok: false as const, error: `Only ${l.remainingQuantity} left on this listing.` };
    }

    // Intent decides the roles. On a WTS the poster sells; on a WTB the poster buys.
    const sellerId = l.intent === "buy" ? t.counterpartyId : l.sellerId;
    const buyerId = l.intent === "buy" ? l.sellerId : t.counterpartyId;
    const unitPrice = msg.offerUnitPrice!;
    const total = unitPrice * qty;

    const capacity = await tx.execute<{ available: string }>(sql`
      SELECT (coalesce((SELECT auec_balance FROM users WHERE id = ${buyerId}), 0)
              - ${committedAuecSql(buyerId)})::text AS available
    `);
    const available = Number(capacity.rows[0]?.available ?? 0);
    if (total > available) {
      return {
        ok: false as const,
        error:
          buyerId === opts.userId
            ? `That costs ${total.toLocaleString()} aUEC but you have ${Math.max(0, available).toLocaleString()} free once your orders, contracts and bids are counted.`
            : `They don't have ${total.toLocaleString()} aUEC free right now — their orders, contracts and bids are already committed against their declared balance.`,
      };
    }

    const now = new Date();
    const [sale] = await tx
      .insert(bazaarSales)
      .values({
        listingId: l.id,
        sellerId,
        buyerId,
        seasonId: l.seasonId,
        origin: "buy_now",
        quantity: qty,
        unitPrice,
        totalPrice: total,
        settleBy: new Date(now.getTime() + BAZAAR_SETTLE_HOURS * 3_600_000),
      })
      .returning();

    await tx
      .update(bazaarMessages)
      .set({ offerStatus: "accepted", saleId: sale!.id })
      .where(eq(bazaarMessages.id, msg.id));

    const remaining = l.remainingQuantity - qty;
    await tx
      .update(bazaarListings)
      .set({ remainingQuantity: remaining, status: remaining === 0 ? "sold_out" : l.status, updatedAt: now })
      .where(eq(bazaarListings.id, l.id));

    await tx.insert(bazaarMessages).values({
      threadId: t.id,
      senderId: null,
      kind: "system",
      body: `Offer accepted at ${unitPrice.toLocaleString()} aUEC${qty > 1 ? ` × ${qty}` : ""}. Meet in-game — you both confirm from your desk.`,
    });
    await tx.update(bazaarThreads).set({ lastMessageAt: now }).where(eq(bazaarThreads.id, t.id));

    return { ok: true as const, threadId: t.id, saleId: sale!.id };
  });
}

/** Turn an offer down, or take your own off the table. Both leave the conversation open. */
export async function resolveBazaarOffer(
  db: Db,
  opts: { messageId: number; userId: string; action: "decline" | "withdraw" },
): Promise<ThreadResult> {
  return db.transaction(async (tx) => {
    const [msg] = await tx.select().from(bazaarMessages).where(eq(bazaarMessages.id, opts.messageId)).for("update");
    if (!msg || msg.offerStatus == null) return { ok: false as const, error: "Offer not found" };
    if (msg.offerStatus !== "open") return { ok: false as const, error: `That offer was already ${msg.offerStatus}` };

    const [t] = await tx.select().from(bazaarThreads).where(eq(bazaarThreads.id, msg.threadId));
    if (!t) return { ok: false as const, error: "Conversation not found" };
    if (t.ownerId !== opts.userId && t.counterpartyId !== opts.userId) {
      return { ok: false as const, error: "You're not part of this conversation" };
    }
    const isMine = msg.senderId === opts.userId;
    if (opts.action === "withdraw" && !isMine) return { ok: false as const, error: "That isn't your offer" };
    if (opts.action === "decline" && isMine) return { ok: false as const, error: "Withdraw it instead" };

    const now = new Date();
    await tx
      .update(bazaarMessages)
      .set({ offerStatus: opts.action === "decline" ? "declined" : "withdrawn" })
      .where(eq(bazaarMessages.id, msg.id));
    await tx.insert(bazaarMessages).values({
      threadId: t.id,
      senderId: null,
      kind: "system",
      body: opts.action === "decline" ? "Offer declined." : "Offer withdrawn.",
    });
    await tx.update(bazaarThreads).set({ lastMessageAt: now }).where(eq(bazaarThreads.id, t.id));
    return { ok: true as const, threadId: t.id };
  });
}

/** How many people are talking to this listing — shown to its owner. */
export async function threadCountForListing(db: Db, listingId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bazaarThreads)
    .where(eq(bazaarThreads.listingId, listingId));
  return row?.n ?? 0;
}

/** The viewer's own thread on a listing, if they have one — powers the "Ask / Offer" button. */
export async function myThreadForListing(
  db: Db,
  listingId: string,
  userId: string,
): Promise<{ id: string; unread: boolean } | null> {
  const [row] = await db
    .select({
      id: bazaarThreads.id,
      ownerId: bazaarThreads.ownerId,
      lastMessageAt: bazaarThreads.lastMessageAt,
      ownerReadAt: bazaarThreads.ownerReadAt,
      counterpartyReadAt: bazaarThreads.counterpartyReadAt,
    })
    .from(bazaarThreads)
    .where(
      and(
        eq(bazaarThreads.listingId, listingId),
        sql`(${bazaarThreads.ownerId} = ${userId} OR ${bazaarThreads.counterpartyId} = ${userId})`,
      ),
    )
    .orderBy(desc(bazaarThreads.lastMessageAt))
    .limit(1);
  if (!row) return null;
  const readAt = row.ownerId === userId ? row.ownerReadAt : row.counterpartyReadAt;
  return { id: row.id, unread: readAt == null || readAt < row.lastMessageAt };
}
