import { disputeContractBreach, getDb, reportContractBreach, resolveContractBreach } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const reportInput = z.object({ action: z.literal("report"), reason: z.string().trim().min(10).max(1000) });
const disputeInput = z.object({ action: z.literal("dispute"), response: z.string().trim().min(10).max(1000) });
const resolveInput = z.object({ action: z.enum(["uphold", "dismiss"]) });
const input = z.discriminatedUnion("action", [reportInput, disputeInput, resolveInput]);

/**
 * Breaches of a classified contract's conditions of access.
 *
 * Filing one is a serious act — it puts a permanent mark against someone's contract standing
 * — so it is restricted to the issuer, on a classified contract, against the executor who
 * acknowledged the conditions. The accused always gets a right of reply, and a moderator can
 * dismiss a claim, which removes it from the count entirely.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const db = getDb();
    let result: Awaited<ReturnType<typeof reportContractBreach>>;

    if (parsed.data.action === "report") {
      result = await reportContractBreach(db, { contractId: id, reporterId: user.id, reason: parsed.data.reason });
    } else if (parsed.data.action === "dispute") {
      result = await disputeContractBreach(db, { contractId: id, userId: user.id, response: parsed.data.response });
    } else {
      if (user.role !== "mod" && user.role !== "admin") {
        return NextResponse.json({ error: "Moderators only" }, { status: 403 });
      }
      result = await resolveContractBreach(db, {
        contractId: id,
        moderatorId: user.id,
        action: parsed.data.action,
      });
    }

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contracts:breach]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
