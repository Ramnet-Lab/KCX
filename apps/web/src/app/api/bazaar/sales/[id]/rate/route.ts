import { getDb, rateBazaarSale } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

/** POST — rate the other party to a settled sale. One rating each, enforced by the index. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick 1 to 5 stars" }, { status: 400 });

  try {
    const result = await rateBazaarSale(getDb(), {
      saleId: id,
      raterId: user.id,
      stars: parsed.data.stars,
      comment: parsed.data.comment ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[bazaar:rate]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save the rating" }, { status: 500 });
  }
}
