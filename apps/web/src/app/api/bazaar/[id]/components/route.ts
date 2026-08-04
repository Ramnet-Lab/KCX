import { MAX_LISTING_COMPONENTS, getDb, listingComponents, setListingComponents } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({
  components: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        slotLabel: z.string().trim().max(60).nullable().optional(),
        quantity: z.number().int().positive().max(100).optional(),
      }),
    )
    .max(MAX_LISTING_COMPONENTS),
});

/** GET — the fitted loadout. Public, like the listing it belongs to. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ components: await listingComponents(getDb(), id) });
  } catch (err) {
    console.error("[bazaar:components]", err instanceof Error ? err.message : err);
    return NextResponse.json({ components: [], error: "Unavailable" }, { status: 503 });
  }
}

/**
 * PUT — replace the loadout.
 *
 * A whole-list replace rather than add/remove endpoints: the seller edits a list in front of
 * them and saves it, and turning that into a diff on the client is how the two copies drift
 * apart. Ordering comes from the array.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid loadout" }, { status: 400 });
  }

  try {
    const result = await setListingComponents(getDb(), {
      listingId: id,
      sellerId: user.id,
      components: parsed.data.components,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bazaar:set-components]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save the loadout" }, { status: 500 });
  }
}
