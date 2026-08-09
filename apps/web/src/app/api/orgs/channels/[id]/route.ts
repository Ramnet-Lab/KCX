import { ORG_MESSAGE_MAX, getDb, getOrgChannel, postOrgChannelMessage } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET — one channel with its messages, and mark it read for this side.
 *
 * Anyone who isn't president of one of the two orgs gets a 404 rather than a 403. Private
 * means private: the id is all that stands between this correspondence and everyone else,
 * and whether two orgs are even talking is itself something they may not want known.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  try {
    // ?orgId= names which side a site admin is reading from; ignored for everyone else.
    const from = new URL(_request.url).searchParams.get("orgId");
    const channel = await getOrgChannel(
      getDb(),
      id,
      user.id,
      user.role === "admin" ? from : null,
    );
    if (!channel) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ channel });
  } catch (err) {
    console.error("[orgs:channel]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}

const input = z.object({ body: z.string().trim().min(1).max(ORG_MESSAGE_MAX) });

/** POST — say something, on the org's behalf. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say something first" }, { status: 400 });

  try {
    const result = await postOrgChannelMessage(getDb(), {
      channelId: id,
      userId: user.id,
      body: parsed.data.body,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[orgs:channel-post]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not send that" }, { status: 500 });
  }
}
