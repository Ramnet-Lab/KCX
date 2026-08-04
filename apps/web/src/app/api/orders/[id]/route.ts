import { buyCapacity, getDb, notifyMarketChange, orderEvents, orders, sellCapacity } from "@kcx/db";
import { ORDER_TTL_DAYS, orderActionInput } from "@kcx/shared";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Minimum gap between bumps — stops the board being churned to the top repeatedly. */
const BUMP_COOLDOWN_MS = 8 * 3_600_000;

const EVENT_FOR_ACTION = {
  pause: "paused",
  resume: "resumed",
  cancel: "cancelled",
  bump: "bumped",
  refresh: "refreshed",
  edit: "edited",
} as const satisfies Record<Exclude<import("@kcx/shared").OrderAction, "fill">, string>;

/** PATCH /api/orders/:id — owner lifecycle actions (pause/resume/cancel/bump/refresh). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = orderActionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const { action } = parsed.data;

  const db = getDb();

  // Fills only happen through escrow contracts (claim → both parties confirm), never by
  // self-report: a one-sided fill is exactly the tape-painting vector the design excludes.
  if (action === "fill") {
    return NextResponse.json(
      { error: "Orders settle through escrow contracts — a counterparty must claim and both must confirm." },
      { status: 409 },
    );
  }
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.ownerId, user.id)));
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // expired_unfilled and filled are terminal: an order that already resolved must not be
  // resurrected by "refresh", which would let a settled/lapsed listing re-enter the board.
  const terminal = ["completed", "filled", "cancelled", "expired_unfilled", "expired_season", "removed"];
  if (terminal.includes(order.status)) {
    return NextResponse.json(
      { error: `Order is ${order.status.replace(/_/g, " ")} — post a new one instead.` },
      { status: 409 },
    );
  }

  // Cancelling would free the trader's collateral while their escrow obligation lives on.
  if (action === "cancel" && order.reservedScu > 0) {
    return NextResponse.json(
      {
        error: `${order.reservedScu} SCU is locked in an open contract — settle or release that contract first.`,
      },
      { status: 409 },
    );
  }

  const now = new Date();
  const patch: Partial<typeof orders.$inferInsert> = { updatedAt: now };

  /**
   * Revising a resting order re-runs the same collateral gate as posting one — otherwise
   * "edit the price up" would be a way to promise aUEC that placing the order would have
   * refused. The order's OWN current commitment is added back before comparing, because
   * capacity already counts it and we are replacing it, not stacking on top of it.
   */
  if (action === "edit") {
    const edit = parsed.data.edit;
    if (!edit) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    if (order.status !== "active" && order.status !== "paused") {
      return NextResponse.json({ error: `Order is ${order.status.replace(/_/g, " ")}` }, { status: 409 });
    }

    const price = edit.pricePerScu ?? order.pricePerScu;
    const quantity = edit.quantityScu ?? order.quantityScu;
    const remaining = quantity - order.filledScu;
    if (remaining < order.reservedScu) {
      return NextResponse.json(
        {
          error:
            order.reservedScu > 0
              ? `${order.reservedScu} SCU is locked in an open contract — you can't cut the order below that.`
              : "That quantity is below what has already been filled.",
        },
        { status: 409 },
      );
    }
    if (remaining <= 0) {
      return NextResponse.json({ error: "Nothing would be left on the board — cancel it instead." }, { status: 409 });
    }
    const minFill = edit.minFillScu ?? order.minFillScu;
    if (minFill > quantity) {
      return NextResponse.json({ error: "Minimum fill cannot exceed the order quantity" }, { status: 400 });
    }

    const unreserved = remaining - order.reservedScu;
    if (order.side === "buy") {
      const capacity = await buyCapacity(db, user.id);
      const freedByThisOrder = (order.remainingScu - order.reservedScu) * order.pricePerScu;
      const wanted = unreserved * price;
      if (wanted > capacity.available + freedByThisOrder) {
        return NextResponse.json(
          {
            error: `That revision commits ${wanted.toLocaleString()} aUEC but only ${(capacity.available + freedByThisOrder).toLocaleString()} is free once your other orders, contracts and bids are counted.`,
          },
          { status: 409 },
        );
      }
    } else {
      const capacity = await sellCapacity(db, user.id, order.commodityId);
      const freedByThisOrder = order.remainingScu - order.reservedScu;
      if (unreserved > capacity.available + freedByThisOrder) {
        return NextResponse.json(
          {
            error: `You'd be offering ${unreserved.toLocaleString()} SCU with only ${(capacity.available + freedByThisOrder).toLocaleString()} uncommitted in your declared holdings.`,
          },
          { status: 409 },
        );
      }
    }

    patch.pricePerScu = price;
    patch.quantityScu = quantity;
    patch.remainingScu = remaining;
    patch.minFillScu = minFill;
    if (edit.notes !== undefined) patch.notes = edit.notes?.trim() || null;
  }

  switch (action) {
    case "pause":
      patch.status = "paused";
      break;
    case "resume":
      patch.status = "active";
      patch.expiresAt = new Date(now.getTime() + ORDER_TTL_DAYS * 86_400_000);
      break;
    case "cancel":
      patch.status = "cancelled";
      break;
    case "refresh":
      patch.status = "active";
      patch.expiresAt = new Date(now.getTime() + ORDER_TTL_DAYS * 86_400_000);
      break;
    case "bump":
      if (now.getTime() - order.bumpedAt.getTime() < BUMP_COOLDOWN_MS) {
        const hours = Math.ceil((BUMP_COOLDOWN_MS - (now.getTime() - order.bumpedAt.getTime())) / 3_600_000);
        return NextResponse.json({ error: `You can bump again in ${hours}h` }, { status: 429 });
      }
      patch.bumpedAt = now;
      patch.expiresAt = new Date(now.getTime() + ORDER_TTL_DAYS * 86_400_000);
      break;
    case "edit":
      // The patch was built and gated above; nothing further to set here.
      break;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(orders).set(patch).where(eq(orders.id, id));
      await tx.insert(orderEvents).values({
        orderId: id,
        actorId: user.id,
        type: EVENT_FOR_ACTION[action],
        // What changed is part of the audit trail; an "edited" row with no detail says
        // nothing about which terms someone revised.
        data:
          action === "edit"
            ? {
                from: { pricePerScu: order.pricePerScu, quantityScu: order.quantityScu },
                to: { pricePerScu: patch.pricePerScu, quantityScu: patch.quantityScu },
              }
            : {},
      });
    });
    await notifyMarketChange(db, {
      kind: "order",
      commodityId: order.commodityId,
      orderId: order.id,
      participants: [user.id],
    });
    return NextResponse.json({ ok: true, status: patch.status ?? order.status });
  } catch (err) {
    console.error("[orders:action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
