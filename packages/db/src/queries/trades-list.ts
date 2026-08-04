import { desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { commodities } from "../schema/market";
import { trades, users } from "../schema/orders";

export type ContractDto = {
  id: string;
  orderId: string;
  commodityName: string;
  commoditySlug: string;
  commodityCode: string;
  side: "buy" | "sell";
  quantityScu: number;
  pricePerScu: number;
  value: number;
  status: string;
  /** Viewer's role in this contract. */
  role: "owner" | "claimer";
  counterpartyHandle: string;
  counterpartyDisplayName: string;
  /** Has the viewer confirmed? Has the other side? */
  iConfirmed: boolean;
  theyConfirmed: boolean;
  /** What the viewer must do in-game to settle. */
  iDeliverCargo: boolean;
  expiresAt: string;
  createdAt: string;
};

/** Contracts the user is party to, newest first. Open escrows first by default. */
export async function listContracts(db: Db, userId: string, onlyOpen = false): Promise<ContractDto[]> {
  const rows = await db
    .select({
      id: trades.id,
      orderId: trades.orderId,
      ownerId: trades.ownerId,
      claimerId: trades.claimerId,
      side: trades.side,
      quantityScu: trades.quantityScu,
      pricePerScu: trades.pricePerScu,
      status: trades.status,
      ownerConfirmedAt: trades.ownerConfirmedAt,
      claimerConfirmedAt: trades.claimerConfirmedAt,
      expiresAt: trades.expiresAt,
      createdAt: trades.createdAt,
      commodityName: commodities.name,
      commoditySlug: commodities.slug,
      commodityCode: commodities.code,
    })
    .from(trades)
    .innerJoin(commodities, eq(trades.commodityId, commodities.id))
    .where(
      onlyOpen
        ? sql`(${trades.ownerId} = ${userId} OR ${trades.claimerId} = ${userId}) AND ${trades.status} = 'escrow'`
        : or(eq(trades.ownerId, userId), eq(trades.claimerId, userId)),
    )
    .orderBy(desc(trades.createdAt))
    .limit(100);

  const counterpartyIds = [...new Set(rows.map((r) => (r.ownerId === userId ? r.claimerId : r.ownerId)))];
  const people =
    counterpartyIds.length > 0
      ? await db
          .select({ id: users.id, handle: users.handle, displayName: users.displayName })
          .from(users)
          .where(sql`${users.id} = ANY(ARRAY[${sql.join(counterpartyIds.map((id) => sql`${id}::uuid`), sql`, `)}])`)
      : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  return rows.map((r) => {
    const role = r.ownerId === userId ? ("owner" as const) : ("claimer" as const);
    const counterpartyId = role === "owner" ? r.claimerId : r.ownerId;
    const cp = byId.get(counterpartyId);
    // On a sell order the owner ships cargo; on a buy order the claimer does.
    const ownerShips = r.side === "sell";
    return {
      id: r.id,
      orderId: r.orderId,
      commodityName: r.commodityName,
      commoditySlug: r.commoditySlug,
      commodityCode: r.commodityCode,
      side: r.side,
      quantityScu: r.quantityScu,
      pricePerScu: r.pricePerScu,
      value: r.quantityScu * r.pricePerScu,
      status: r.status,
      role,
      counterpartyHandle: cp?.handle ?? "unknown",
      counterpartyDisplayName: cp?.displayName ?? "Unknown trader",
      iConfirmed: role === "owner" ? r.ownerConfirmedAt != null : r.claimerConfirmedAt != null,
      theyConfirmed: role === "owner" ? r.claimerConfirmedAt != null : r.ownerConfirmedAt != null,
      iDeliverCargo: role === "owner" ? ownerShips : !ownerShips,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  });
}
