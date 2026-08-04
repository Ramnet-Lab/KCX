import { createOrg, getDb, listMyOrgs } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — the orgs this trader belongs to, with their role and delegated limit. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ orgs: [] }, { status: 401 });
  try {
    return NextResponse.json({ orgs: await listMyOrgs(getDb(), user.id) });
  } catch (err) {
    console.error("[orgs:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ orgs: [], error: "Unavailable" }, { status: 503 });
  }
}

const input = z.object({
  sid: z.string().trim().min(3).max(20),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
});

/**
 * POST — found an org.
 *
 * Gated on the founder's verified RSI profile listing that SID as their main org. Without
 * that, an org here would be a club anyone could invent and name after somebody else's
 * fleet — and org standing would mean nothing, because nothing would tie it to the org
 * people actually know.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid org" }, { status: 400 });
  }

  try {
    const result = await createOrg(getDb(), { ...parsed.data, founderId: user.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, orgId: result.orgId }, { status: 201 });
  } catch (err) {
    console.error("[orgs:create]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not create the org" }, { status: 500 });
  }
}
