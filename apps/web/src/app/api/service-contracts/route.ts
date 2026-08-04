import {
  buyCapacity,
  contractEvents,
  gameVersions,
  getDb,
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
  // A contract nobody can pay for is worthless to whoever does the work, so the payout is
  // backed the same way a buy order is: against the balance, minus everything already
  // promised to open orders, live escrows, and other contracts.
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

  const [season] = await db.select().from(gameVersions).where(eq(gameVersions.status, "active"));
  if (!season) return NextResponse.json({ error: "No active season" }, { status: 503 });

  try {
    const contract = await db.transaction(async (tx) => {
      const isBid = input.pricingMode === "bid";
      const [created] = await tx
        .insert(serviceContracts)
        .values({
          issuerId: user.id,
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
        actorId: user.id,
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
