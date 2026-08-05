import {
  canUseInstalments,
  confirmInstalment,
  getDb,
  listInstalmentPlans,
  proposeInstalmentPlan,
  respondToInstalmentPlan,
} from "@kcx/db";
import {
  INSTALMENT_MAX_RATE_BPS,
  INSTALMENT_MAX_WINDOWS,
  INSTALMENT_MIN_WINDOWS,
} from "@kcx/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — plans this trader is party to, plus whether they're eligible to start one. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ plans: [] }, { status: 401 });
  try {
    const db = getDb();
    const [plans, eligibility] = await Promise.all([
      listInstalmentPlans(db, user.id),
      canUseInstalments(db, user.id),
    ]);
    return NextResponse.json({ plans, eligibility });
  } catch (err) {
    console.error("[instalments:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ plans: [], error: "Unavailable" }, { status: 503 });
  }
}

const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    saleId: z.uuid(),
    instalmentCount: z.number().int().min(INSTALMENT_MIN_WINDOWS).max(INSTALMENT_MAX_WINDOWS),
    intervalDays: z.number().int().min(1).max(30),
    /** Basis points. Honoured only when the proposer is the seller — see the query. */
    rateBps: z.number().int().min(0).max(INSTALMENT_MAX_RATE_BPS).optional(),
  }),
  z.object({ action: z.literal("accept"), planId: z.uuid() }),
  z.object({ action: z.literal("decline"), planId: z.uuid() }),
  z.object({ action: z.literal("confirm"), instalmentId: z.number().int().positive() }),
]);

/**
 * POST — propose a schedule, answer one, or confirm a payment.
 *
 * KCX lends nothing and is not a party. The PRINCIPAL comes from the sale — a plan cannot
 * change what the goods cost — and the seller's advertised rate is what they charge for
 * waiting. The goods do not change hands until the schedule completes.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle first" }, { status: 403 });
  }

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Unknown action" }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const db = getDb();
    const result =
      body.action === "propose"
        ? await proposeInstalmentPlan(db, {
            saleId: body.saleId,
            userId: user.id,
            instalmentCount: body.instalmentCount,
            intervalDays: body.intervalDays,
            rateBps: body.rateBps,
          })
        : body.action === "confirm"
          ? await confirmInstalment(db, { instalmentId: body.instalmentId, userId: user.id })
          : await respondToInstalmentPlan(db, {
              planId: body.planId,
              userId: user.id,
              action: body.action,
            });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, planId: result.planId });
  } catch (err) {
    console.error("[instalments:action]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
