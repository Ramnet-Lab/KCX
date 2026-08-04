import { getDb, listContractsBoard, pendingContractRatings, type ServiceContractDto } from "@kcx/db";
import type { Metadata } from "next";
import { ContractBoard } from "@/components/contract-board";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contracts",
  description:
    "Player-written work contracts for Star Citizen — hauling, escort, salvage and more. Posted, taken, and settled between players.",
};

export default async function ContractsPage() {
  const user = await currentUser();
  let contracts: ServiceContractDto[] = [];
  let toRate: { contractId: string; counterpartyName: string; title: string }[] = [];

  try {
    const db = getDb();
    contracts = await listContractsBoard(db, { viewerId: user?.id ?? null, viewerRole: user?.role ?? null });
    if (user) toRate = await pendingContractRatings(db, user.id);
  } catch (err) {
    console.error("[contracts page]", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Contracts</h1>
        <p className="text-xs text-ink-dim">
          Work posted by players: hauling, escort, salvage, medical, whatever you need doing.
          The issuer names the job and the payout; whoever takes it does the work in-game, and
          both sides confirm before aUEC changes hands. KCX never holds the money — it records
          what was agreed and what happened.
        </p>
      </div>

      <ContractBoard contracts={contracts} signedIn={!!user} pendingRatings={toRate} />
    </>
  );
}
