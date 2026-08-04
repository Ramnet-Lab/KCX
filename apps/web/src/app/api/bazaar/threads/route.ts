import { getDb, listBazaarThreads, postBazaarMessage, MESSAGE_MAX } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — every conversation this trader is part of. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ threads: [] }, { status: 401 });
  try {
    const threads = await listBazaarThreads(getDb(), user.id);
    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[bazaar:threads]", err instanceof Error ? err.message : err);
    return NextResponse.json({ threads: [], error: "Unavailable" }, { status: 503 });
  }
}

const openInput = z
  .object({
    listingId: z.uuid(),
    body: z.string().trim().max(MESSAGE_MAX).optional(),
    offerUnitPrice: z.number().int().positive().max(100_000_000_000).optional(),
    offerQuantity: z.number().int().positive().max(10_000).optional(),
  })
  .refine((v) => (v.body?.length ?? 0) > 0 || v.offerUnitPrice != null, {
    message: "Say something or make an offer",
    path: ["body"],
  });

/**
 * POST — get in touch about a listing, opening the conversation on first contact.
 *
 * Verification is required to talk, not just to trade. An unverified account is free to
 * create, so without the gate the cheapest way to spam every seller on the board would be
 * to make one.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to get in touch" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to message traders" }, { status: 403 });
  }

  const parsed = openInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid message" }, { status: 400 });
  }

  try {
    const result = await postBazaarMessage(getDb(), {
      listingId: parsed.data.listingId,
      senderId: user.id,
      body: parsed.data.body ?? null,
      offerUnitPrice: parsed.data.offerUnitPrice ?? null,
      offerQuantity: parsed.data.offerQuantity ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, threadId: result.threadId }, { status: 201 });
  } catch (err) {
    console.error("[bazaar:thread-open]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not send that" }, { status: 500 });
  }
}
