import { cancelOrgProposal, getDb, getOrgProposal, settleOrgProposal, voteOnOrgProposal } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("object"), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("withdraw") }),
]);

/**
 * POST — vote on a board proposal, or withdraw one.
 *
 * When a vote carries, the proposal's stored payload is replayed against the ordinary
 * endpoint that would have handled it. Replaying rather than reimplementing is deliberate:
 * a board path that had its own copy of "create a listing" would drift from the non-board
 * path, and the drift would show up as org purchases behaving subtly differently from
 * everyone else's.
 *
 * Execution is recorded whether it succeeds or fails. A proposal that carried but couldn't
 * execute — the treasury moved underneath it, the listing sold out — must not look like one
 * that quietly went through.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const db = getDb();

  try {
    if (parsed.data.action === "withdraw") {
      const result = await cancelOrgProposal(db, { proposalId: id, userId: user.id });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    const vote = await voteOnOrgProposal(db, {
      proposalId: id,
      userId: user.id,
      approve: parsed.data.action === "approve",
      note: parsed.data.note ?? null,
    });
    if (!vote.ok) return NextResponse.json({ error: vote.error }, { status: 409 });
    if (!vote.readyToExecute) {
      return NextResponse.json({ ok: true, rejected: vote.rejected, executed: false });
    }

    const proposal = await getOrgProposal(db, id);
    if (!proposal) return NextResponse.json({ error: "Proposal vanished" }, { status: 404 });

    const outcome = await executeProposal(request, id, proposal.kind, proposal.payload);
    await settleOrgProposal(db, {
      proposalId: id,
      resultRef: outcome.ok ? outcome.ref : null,
      failureReason: outcome.ok ? null : outcome.error,
    });
    return NextResponse.json({ ok: true, executed: outcome.ok, error: outcome.ok ? undefined : outcome.error });
  } catch (err) {
    console.error("[orgs:proposal-vote]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

/**
 * Replay an approved proposal against the endpoint that would ordinarily have handled it.
 *
 * The call carries `approvedProposalId`, and the target route re-reads that proposal from
 * the database before honouring it. Two things fall out of that, both necessary:
 *
 *  • The listing is created under the ORIGINAL PROPOSER, not whoever cast the deciding
 *    vote. Without it, approving somebody's proposal would silently make it yours.
 *  • The board gate is skipped for this one call. Without it the replay would open a second
 *    proposal for the same purchase, and every approval would spawn another one.
 *
 * Forging it is not possible: the id is only trusted after the server has confirmed the
 * proposal exists, is approved, names that org, and hasn't already executed.
 */
async function executeProposal(
  request: Request,
  proposalId: string,
  kind: string,
  payload: unknown,
): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
  const routes: Record<string, string> = {
    bazaar_listing: "/api/bazaar",
    service_contract: "/api/service-contracts",
  };
  const path = routes[kind];
  if (!path) return { ok: false, error: `Nothing knows how to execute a ${kind} proposal` };

  try {
    const res = await fetch(new URL(path, request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The session still has to be a real one — a board approval is permission to
        // proceed, not an unauthenticated back door.
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ ...(payload as object), approvedProposalId: proposalId }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `Execution failed (${res.status})` };
    return { ok: true, ref: body.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Execution failed" };
  }
}
