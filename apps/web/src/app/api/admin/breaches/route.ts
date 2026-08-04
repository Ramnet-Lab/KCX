import { breachQueue, getDb, resolveContractBreach } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMod } from "@/lib/require-mod";

export const dynamic = "force-dynamic";

const ruling = z.object({
  contractId: z.string().uuid(),
  action: z.enum(["uphold", "dismiss"]),
  reason: z.string().trim().max(1000).optional(),
});

/** GET — the breach queue. Unresolved by default; `?all=1` includes past rulings. */
export async function GET(request: Request) {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  const includeResolved = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ breaches: await breachQueue(getDb(), { includeResolved }) });
  } catch (err) {
    console.error("[admin:breaches]", err instanceof Error ? err.message : err);
    return NextResponse.json({ breaches: [], error: "Unavailable" }, { status: 503 });
  }
}

/** POST — rule on a breach. Dismissing removes it from the accused's public count. */
export async function POST(request: Request) {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  const parsed = ruling.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const result = await resolveContractBreach(getDb(), {
      contractId: parsed.data.contractId,
      moderatorId: gate.user.id,
      action: parsed.data.action,
      reason: parsed.data.reason ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:breach-rule]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
