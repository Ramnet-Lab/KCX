import { getDb, listMakerQuotes, setMakerQuoteStatus, upsertMakerQuote } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — live quotes, tightest spread first. `?commodityId=` narrows to one commodity. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await currentUser();
  const commodityId = Number(url.searchParams.get("commodityId")) || undefined;
  const mine = url.searchParams.get("mine") === "1";

  try {
    const quotes = await listMakerQuotes(getDb(), {
      commodityId,
      viewerId: user?.id ?? null,
      ...(mine && user ? { userId: user.id, includeInactive: true } : {}),
    });
    return NextResponse.json({ quotes });
  } catch (err) {
    console.error("[makers:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ quotes: [], error: "Unavailable" }, { status: 503 });
  }
}

const quoteInput = z.object({
  commodityId: z.number().int().positive(),
  bidPrice: z.number().int().positive().max(1_000_000_000),
  askPrice: z.number().int().positive().max(1_000_000_000),
  bidSizeScu: z.number().int().positive().max(1_000_000),
  askSizeScu: z.number().int().positive().max(1_000_000),
  orgId: z.uuid().optional(),
});

/**
 * POST — post or revise a two-sided quote.
 *
 * Both sides are collateral-checked: the bid against aUEC (or an org treasury), the ask
 * against declared cargo. A quote backed on one side only is an advertisement, not a market.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to make a market" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to make a market" }, { status: 403 });
  }

  const parsed = quoteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid quote" }, { status: 400 });
  }

  try {
    const result = await upsertMakerQuote(getDb(), { userId: user.id, ...parsed.data });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, quoteId: result.quoteId }, { status: 201 });
  } catch (err) {
    console.error("[makers:save]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save the quote" }, { status: 500 });
  }
}

const statusInput = z.object({
  quoteId: z.uuid(),
  status: z.enum(["active", "paused", "retired"]),
});

/** PATCH — stand a quote down, bring it back, or retire it. */
export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = statusInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const result = await setMakerQuoteStatus(getDb(), { userId: user.id, ...parsed.data });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[makers:status]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
