import { FEEDBACK_STATUSES, feedbackQueue, getDb, respondToFeatureRequest, setFeedbackStatus } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMod } from "@/lib/require-mod";

export const dynamic = "force-dynamic";

/** GET — the review queue. Live requests by default; `?all=1` includes shipped and declined. */
export async function GET(request: Request) {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  const includeClosed = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ requests: await feedbackQueue(getDb(), { includeClosed }) });
  } catch (err) {
    console.error("[admin:feedback]", err instanceof Error ? err.message : err);
    return NextResponse.json({ requests: [], error: "Unavailable" }, { status: 503 });
  }
}

const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("respond"),
    requestId: z.string().uuid(),
    body: z.string().trim().min(2).max(4000),
    /** Optional: a reply that also moves the request, in one transaction. */
    status: z.enum(FEEDBACK_STATUSES).optional(),
  }),
  z.object({
    action: z.literal("status"),
    requestId: z.string().uuid(),
    status: z.enum(FEEDBACK_STATUSES),
  }),
]);

/** POST — answer a request (delivering it to the author's inbox), or just re-file it. */
export async function POST(request: Request) {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const db = getDb();
    const result =
      parsed.data.action === "respond"
        ? await respondToFeatureRequest(db, {
            moderatorId: gate.user.id,
            requestId: parsed.data.requestId,
            body: parsed.data.body,
            status: parsed.data.status ?? null,
          })
        : await setFeedbackStatus(db, {
            moderatorId: gate.user.id,
            requestId: parsed.data.requestId,
            status: parsed.data.status,
          });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:feedback-act]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
