import { getDb, getOrg, listOrgChannels, openOrgChannel } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET ?orgId= — channels this org is part of. Presidents only; the org sees its own post. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ channels: [] }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ error: "Which org?" }, { status: 400 });

  try {
    const db = getDb();
    const org = await getOrg(db, orgId, user.id);
    // Not a 403: whether an org has correspondence at all is itself private.
    if (!org || org.charterHolderId !== user.id) {
      return NextResponse.json({ channels: [] }, { status: 404 });
    }
    return NextResponse.json({ channels: await listOrgChannels(db, orgId) });
  } catch (err) {
    console.error("[orgs:channels]", err instanceof Error ? err.message : err);
    return NextResponse.json({ channels: [], error: "Unavailable" }, { status: 503 });
  }
}

const input = z.object({ fromOrgId: z.uuid(), toOrgId: z.uuid() });

/**
 * POST — open a channel to another org, or return the existing one.
 *
 * Both orgs must be verified: an unverified org has no proven leader, so a message sent
 * there would be addressed to whoever happened to sign up first rather than to anyone who
 * can speak for it.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Which orgs?" }, { status: 400 });

  try {
    const result = await openOrgChannel(getDb(), {
      fromOrgId: parsed.data.fromOrgId,
      toOrgId: parsed.data.toOrgId,
      userId: user.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, channelId: result.channelId }, { status: 201 });
  } catch (err) {
    console.error("[orgs:open-channel]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not open the channel" }, { status: 500 });
  }
}
