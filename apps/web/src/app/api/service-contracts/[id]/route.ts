import { CLASSIFIED_ACK_REQUIRED, claimContract, getDb, resolveServiceContract } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.object({
  action: z.enum(["claim", "confirm", "cancel"]),
  /** Set by the client only after the conditions-of-access dialog has been accepted. */
  acknowledgedClassified: z.boolean().optional(),
});

/** PATCH — claim a contract, confirm completion, or step away from it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!user.isVerified) return NextResponse.json({ error: "Verify your RSI handle first" }, { status: 403 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const db = getDb();
    const result =
      parsed.data.action === "claim"
        ? await claimContract(db, id, user.id, {
            acknowledgedClassified: parsed.data.acknowledgedClassified,
          })
        : await resolveServiceContract(db, { contractId: id, userId: user.id, action: parsed.data.action });
    if (!result.ok) {
      // A distinct signal, not just prose: the client shows the briefing and retries.
      if (result.error === CLASSIFIED_ACK_REQUIRED) {
        return NextResponse.json({ error: "Conditions of access must be accepted first", needsClassifiedAck: true }, { status: 428 });
      }
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contracts:action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
