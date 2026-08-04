import { getDb, listWatchlist, removeWatch, upsertWatch } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — the signed-in trader's watchlist with each entry's current settled price. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ watchlist: [] }, { status: 401 });
  try {
    return NextResponse.json({ watchlist: await listWatchlist(getDb(), user.id) });
  } catch (err) {
    console.error("[watchlist:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ watchlist: [], error: "Unavailable" }, { status: 503 });
  }
}

const input = z
  .object({
    commodityId: z.number().int().positive().optional(),
    itemId: z.number().int().positive().optional(),
    /** Omit to watch without alerting — a watchlist of nothing but alarms stops being used. */
    threshold: z.number().int().positive().max(100_000_000_000).nullable().optional(),
    direction: z.enum(["below", "above", "any"]).default("below"),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => (v.commodityId != null) !== (v.itemId != null), {
    message: "Watch a commodity or an item, not both",
    path: ["commodityId"],
  });

/** POST — watch something, or change the alert already on it. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use a watchlist" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid watch" }, { status: 400 });
  }

  try {
    const result = await upsertWatch(getDb(), { userId: user.id, ...parsed.data });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (err) {
    console.error("[watchlist:save]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}

/** DELETE ?id= — stop watching. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const removed = await removeWatch(getDb(), id, user.id);
    if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[watchlist:remove]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not remove that" }, { status: 500 });
  }
}
