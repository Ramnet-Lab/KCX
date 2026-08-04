import { getBazaarThread, getDb, markThreadRead, postBazaarMessage, MESSAGE_MAX } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET — one conversation with its messages.
 *
 * Reading it marks it read, which is why this isn't cacheable. Anyone who isn't a party (or
 * a moderator) gets a 404 rather than a 403: whether a negotiation exists between two other
 * people is itself private, and the id is all that stands between them and everyone else.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  try {
    const db = getDb();
    const thread = await getBazaarThread(db, id, user.id, user.role);
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await markThreadRead(db, id, user.id);
    return NextResponse.json({ thread });
  } catch (err) {
    console.error("[bazaar:thread]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}

const replyInput = z
  .object({
    body: z.string().trim().max(MESSAGE_MAX).optional(),
    offerUnitPrice: z.number().int().positive().max(100_000_000_000).optional(),
    offerQuantity: z.number().int().positive().max(10_000).optional(),
  })
  .refine((v) => (v.body?.length ?? 0) > 0 || v.offerUnitPrice != null, {
    message: "Say something or make an offer",
    path: ["body"],
  });

/** POST — reply, optionally with a price attached. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to message traders" }, { status: 403 });
  }

  const parsed = replyInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid message" }, { status: 400 });
  }

  try {
    const result = await postBazaarMessage(getDb(), {
      threadId: id,
      senderId: user.id,
      body: parsed.data.body ?? null,
      offerUnitPrice: parsed.data.offerUnitPrice ?? null,
      offerQuantity: parsed.data.offerQuantity ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[bazaar:reply]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not send that" }, { status: 500 });
  }
}
