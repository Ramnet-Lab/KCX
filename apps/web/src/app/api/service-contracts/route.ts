import {
  buyCapacity,
  canActForOrg,
  contractEvents,
  createOrgProposal,
  gameVersions,
  getDb,
  getOrgProposal,
  listContractsBoard,
  serviceContracts,
} from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const CATEGORIES = ["hauling", "escort", "mining", "salvage", "medical", "combat", "exploration", "other"] as const;

const createInput = z
  .object({
    title: z.string().trim().min(4).max(120),
    description: z.string().trim().max(2000).optional(),
    category: z.enum(CATEGORIES).default("other"),
    /** Fixed price, or the ceiling when the contract goes out to bid. */
    payout: z.number().int().positive().max(1_000_000_000),
    expiresInHours: z.number().int().positive().max(720).default(168),
    pricingMode: z.enum(["fixed", "bid"]).default("fixed"),
    visibility: z.enum(["public", "classified"]).default("public"),
    /** Bid mode only: how long sealed bidding stays open. */
    bidWindowHours: z.number().int().positive().max(336).optional(),
    /** Bid mode only: how long the winner has to accept before it cascades. */
    awardResponseHours: z.number().int().positive().max(168).default(24),
    /** Issue on an org's behalf: the treasury backs the payout, not your own balance. */
    orgId: z.uuid().optional(),
    /** Set only by the board-approval replay; the server re-reads the proposal. */
    approvedProposalId: z.uuid().optional(),
  })
  .refine((v) => v.pricingMode !== "bid" || v.bidWindowHours != null, {
    message: "A contract out for bid needs a bidding window",
    path: ["bidWindowHours"],
  })
  .refine(
    (v) => v.pricingMode !== "bid" || (v.bidWindowHours ?? 0) + v.awardResponseHours < v.expiresInHours,
    {
      // Otherwise the auction is still resolving when the job it describes has already died.
      message: "The bidding window plus the acceptance window must finish before the contract expires",
      path: ["bidWindowHours"],
    },
  );

export async function GET(request: Request) {
  const user = await currentUser();
  const url = new URL(request.url);
  try {
    const contracts = await listContractsBoard(getDb(), {
      viewerId: user?.id ?? null,
      viewerRole: user?.role ?? null,
      mineOnly: url.searchParams.get("mine") === "1",
      statuses:
        url.searchParams.get("all") === "1"
          ? ["open", "bidding", "awarded", "in_progress", "completed"]
          : undefined,
    });
    return NextResponse.json({ contracts });
  } catch (err) {
    console.error("[contracts:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ contracts: [], error: "Unavailable" }, { status: 503 });
  }
}

/** POST — post a contract. The payout is committed against the issuer's declared balance. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to post contracts" }, { status: 401 });
  if (!user.isVerified) {
    return NextResponse.json({ error: "Verify your RSI handle to post contracts" }, { status: 403 });
  }

  const parsed = createInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid contract" }, { status: 400 });
  }
  const input = parsed.data;

  const db = getDb();

  /*
   * A board-approved replay. Trusted only after the proposal is re-read and found approved,
   * of the right kind, and for this org — so the contract belongs to whoever PROPOSED it,
   * and the board gate below is skipped rather than firing again on the replay.
   */
  let actingUserId = user.id;
  if (input.approvedProposalId) {
    const proposal = await getOrgProposal(db, input.approvedProposalId);
    const valid =
      proposal &&
      proposal.status === "approved" &&
      proposal.kind === "service_contract" &&
      proposal.orgId === input.orgId;
    if (!valid) {
      return NextResponse.json({ error: "That proposal isn't approved for this action" }, { status: 409 });
    }
    actingUserId = proposal.proposedById;
  }

  /*
   * A contract nobody can pay for is worthless to whoever does the work, so the payout is
   * backed before it goes up — against the org's treasury when issued for an org, and
   * against the issuer's own balance otherwise. In bid mode the CEILING is what gets
   * committed, since any bid up to it could win.
   */
  if (input.orgId && !input.approvedProposalId) {
    const check = await canActForOrg(db, { orgId: input.orgId, userId: user.id, amount: input.payout });
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason ?? "You can't act for that org", check }, { status: 409 });
    }
    if (check.needsBoard) {
      const proposal = await createOrgProposal(db, {
        orgId: input.orgId,
        proposedById: user.id,
        kind: "service_contract",
        value: input.payout,
        summary: `Contract: ${input.title} — ${input.pricingMode === "bid" ? "up to " : ""}${input.payout.toLocaleString()} aUEC`,
        payload: input,
        requiredApprovals: check.requiredApprovals,
      });
      if (!proposal.ok) return NextResponse.json({ error: proposal.error }, { status: 500 });
      return NextResponse.json(
        { pendingBoardApproval: true, proposalId: proposal.proposalId, requiredApprovals: check.requiredApprovals },
        { status: 202 },
      );
    }
  } else if (!input.orgId) {
    const capacity = await buyCapacity(db, user.id);
    const available = capacity.available;
    if (input.payout > available) {
      return NextResponse.json(
        {
          error: `Payout of ${input.payout.toLocaleString()} aUEC exceeds the ${Math.max(0, available).toLocaleString()} you have available — orders and other contracts are already committed.`,
        },
        { status: 409 },
      );
    }
  }

  const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
  if (!season) return NextResponse.json({ error: "No active season" }, { status: 503 });

  try {
    const contract = await db.transaction(async (tx) => {
      const isBid = input.pricingMode === "bid";
      const [created] = await tx
        .insert(serviceContracts)
        .values({
          issuerId: actingUserId,
          orgId: input.orgId ?? null,
          seasonId: season.id,
          title: input.title,
          description: input.description?.trim() || null,
          category: input.category,
          payout: input.payout,
          expiresAt: new Date(Date.now() + input.expiresInHours * 3_600_000),
          pricingMode: input.pricingMode,
          visibility: input.visibility,
          status: isBid ? "bidding" : "open",
          bidsCloseAt: isBid ? new Date(Date.now() + input.bidWindowHours! * 3_600_000) : null,
          awardResponseHours: isBid ? input.awardResponseHours : null,
        })
        .returning();
      await tx.insert(contractEvents).values({
        contractId: created!.id,
        actorId: actingUserId,
        type: "created",
        data: { payout: input.payout, pricingMode: input.pricingMode, visibility: input.visibility },
      });
      return created!;
    });
    return NextResponse.json({ id: contract.id }, { status: 201 });
  } catch (err) {
    console.error("[contracts:create]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not post contract" }, { status: 500 });
  }
}
