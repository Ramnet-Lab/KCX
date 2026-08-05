import { getDb, listInventory, removeInventory, resolveOrCreateItem, setInventory } from "@kcx/db";
import { ITEM_NAME_MAX } from "@kcx/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A trader's own stock list.
 *
 * Entirely private: an inventory is a statement about what you own and where it is, which is
 * exactly the information that makes someone worth robbing in a game where that is a
 * mechanic. Nothing here is readable by anyone else, and the board never joins to it.
 */

const saveInput = z.object({
  /** Existing catalogue entry… */
  itemId: z.number().int().positive().optional(),
  /** …or a name to resolve, creating the catalogue row when it is genuinely new. */
  itemName: z.string().trim().min(2).max(ITEM_NAME_MAX).optional(),
  quantity: z.number().int().min(0).max(100_000),
  note: z.string().trim().max(300).nullable().optional(),
});

const deleteInput = z.object({ itemId: z.number().int().positive() });

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ inventory: [] }, { status: 401 });
  try {
    return NextResponse.json({ inventory: await listInventory(getDb(), user.id) });
  } catch (err) {
    console.error("[inventory:get]", err instanceof Error ? err.message : err);
    return NextResponse.json({ inventory: [], error: "Unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = saveInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (!parsed.data.itemId && !parsed.data.itemName) {
    return NextResponse.json({ error: "Name the item" }, { status: 400 });
  }

  try {
    const db = getDb();
    // Same resolver the sell form uses, so a name typed here lands on the same catalogue row
    // — and therefore the same price history — as one typed there. Two paths that each
    // invented their own entry would quietly split every item's market in half.
    let itemId = parsed.data.itemId ?? null;
    if (itemId == null) {
      const resolved = await resolveOrCreateItem(db, { name: parsed.data.itemName!, userId: user.id });
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
      itemId = resolved.item.id;
    }

    const result = await setInventory(db, user.id, {
      itemId,
      quantity: parsed.data.quantity,
      note: parsed.data.note ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, inventory: await listInventory(db, user.id) });
  } catch (err) {
    console.error("[inventory:post]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = deleteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const db = getDb();
    const result = await removeInventory(db, user.id, parsed.data.itemId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, inventory: await listInventory(db, user.id) });
  } catch (err) {
    console.error("[inventory:delete]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not remove" }, { status: 500 });
  }
}
