import {
  buyCapacity,
  gameVersions,
  getDb,
  listOrders,
  notifyMarketChange,
  orderEvents,
  orders,
  sellCapacity,
} from "@kcx/db";
import { FILL_BY_DEFAULT_HOURS, orderCreateInput, type OrderSide } from "@kcx/shared";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/orders?commodityId=&side=&mine=1 — board listing. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await currentUser();
  const commodityId = Number(url.searchParams.get("commodityId")) || undefined;
  const sideParam = url.searchParams.get("side");
  const side = sideParam === "buy" || sideParam === "sell" ? (sideParam as OrderSide) : undefined;
  const mine = url.searchParams.get("mine") === "1";

  if (mine && !user) return NextResponse.json({ orders: [] });

  try {
    const rows = await listOrders(getDb(), {
      commodityId,
      side,
      viewerId: user?.id ?? null,
      ...(mine ? { ownerId: user!.id, statuses: ["active", "paused", "completed", "cancelled"] } : {}),
    });
    return NextResponse.json({ orders: rows });
  } catch (err) {
    console.error("[orders:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ orders: [], error: "Order board unavailable" }, { status: 503 });
  }
}

/** POST /api/orders — place an order. Prices are never validated against the NPC baseline. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to place orders" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to place orders" }, { status: 403 });
  }

  const parsed = orderCreateInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid order", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;
  if ((input.minFillScu ?? 1) > input.quantityScu) {
    return NextResponse.json({ error: "Minimum fill cannot exceed the order quantity" }, { status: 400 });
  }

  const db = getDb();
  const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
  if (!season) {
    return NextResponse.json({ error: "No active season — try again shortly" }, { status: 503 });
  }

  // Collateral gate: KCX has no shorting and no margin. A sell must be backed by declared
  // cargo; a buy by declared aUEC. Quantities already committed to other open orders don't
  // count twice.
  if (input.side === "sell") {
    const capacity = await sellCapacity(db, user.id, input.commodityId);
    if (input.quantityScu > capacity.available) {
      return NextResponse.json(
        {
          error:
            capacity.held === 0
              ? "You don't hold any of this commodity. Add it to your portfolio before listing it for sale."
              : `You hold ${capacity.held.toLocaleString()} SCU with ${capacity.committed.toLocaleString()} already committed to open sell orders — ${capacity.available.toLocaleString()} SCU available.`,
          capacity,
        },
        { status: 409 },
      );
    }
  } else {
    const capacity = await buyCapacity(db, user.id);
    const cost = input.pricePerScu * input.quantityScu;
    if (cost > capacity.available) {
      return NextResponse.json(
        {
          error: `This order costs ${cost.toLocaleString()} aUEC but you have ${capacity.available.toLocaleString()} available${
            capacity.committed > 0 ? ` (${capacity.committed.toLocaleString()} is committed to other buy orders)` : ""
          }.`,
          capacity,
        },
        { status: 409 },
      );
    }
  }

  try {
    const order = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(orders)
        .values({
          ownerId: user.id,
          seasonId: season.id,
          commodityId: input.commodityId,
          side: input.side,
          pricePerScu: input.pricePerScu,
          quantityScu: input.quantityScu,
          remainingScu: input.quantityScu,
          minFillScu: input.minFillScu ?? 1,
          locationId: input.locationId ?? null,
          locationFlexible: input.locationId == null,
          notes: input.notes?.trim() || null,
          expiresAt: new Date(Date.now() + (input.fillByHours ?? FILL_BY_DEFAULT_HOURS) * 3_600_000),
        })
        .returning();
      await tx.insert(orderEvents).values({
        orderId: created!.id,
        actorId: user.id,
        type: "created",
        data: { side: input.side, pricePerScu: input.pricePerScu, quantityScu: input.quantityScu },
      });
      return created!;
    });

    await notifyMarketChange(db, {
      kind: "order",
      commodityId: order.commodityId,
      orderId: order.id,
      participants: [user.id],
    });

    const [dto] = await listOrders(db, { commodityId: order.commodityId, viewerId: user.id });
    return NextResponse.json({ order: dto ?? null }, { status: 201 });
  } catch (err) {
    console.error("[orders:create]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not place order" }, { status: 500 });
  }
}
