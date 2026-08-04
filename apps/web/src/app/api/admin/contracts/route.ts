import { getDb, listContractsBoard, voidContract } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMod } from "@/lib/require-mod";

export const dynamic = "force-dynamic";

const input = z.object({
  contractId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});

/** GET — every live contract, unredacted: moderators can see classified briefs. */
export async function GET() {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  try {
    const contracts = await listContractsBoard(getDb(), {
      viewerId: gate.user.id,
      viewerRole: gate.user.role,
      statuses: ["open", "bidding", "awarded", "in_progress"],
    });
    return NextResponse.json({ contracts });
  } catch (err) {
    console.error("[admin:contracts]", err instanceof Error ? err.message : err);
    return NextResponse.json({ contracts: [], error: "Unavailable" }, { status: 503 });
  }
}

/** POST — pull a contract off the board. A reason is required; it goes in the log. */
export async function POST(request: Request) {
  const gate = await requireMod();
  if (gate.response) return gate.response;

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const result = await voidContract(getDb(), {
      moderatorId: gate.user.id,
      contractId: parsed.data.contractId,
      reason: parsed.data.reason,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:void]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
