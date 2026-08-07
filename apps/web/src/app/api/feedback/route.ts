import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_TITLE_MAX,
  getDb,
  listMyFeatureRequests,
  submitFeatureRequest,
} from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const submission = z.object({
  kind: z.enum(FEEDBACK_KINDS).default("idea"),
  title: z.string().trim().min(3).max(FEEDBACK_TITLE_MAX),
  body: z.string().trim().min(5).max(FEEDBACK_BODY_MAX),
});

/** GET — what this trader has already asked for, and what became of it. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ requests: [] }, { status: 401 });
  try {
    return NextResponse.json({ requests: await listMyFeatureRequests(getDb(), user.id) });
  } catch (err) {
    console.error("[feedback:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ requests: [], error: "Unavailable" }, { status: 503 });
  }
}

/**
 * POST — file an idea.
 *
 * Signed-in only, because the whole point is that an answer comes back. An anonymous box
 * would have nowhere to deliver the reply and no cost to flooding.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to send an idea" }, { status: 401 });

  const parsed = submission.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Give it a short title and a few words of detail" }, { status: 400 });
  }

  try {
    const result = await submitFeatureRequest(getDb(), { authorId: user.id, ...parsed.data });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.reason === "rate_limit" ? 429 : 400 });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    console.error("[feedback:submit]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't file that — try again" }, { status: 500 });
  }
}
