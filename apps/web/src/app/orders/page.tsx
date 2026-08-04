import { getDb, listContracts, listOrders, type ContractDto } from "@kcx/db";
import type { OrderDto } from "@kcx/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { ContractsPanel } from "@/components/contracts-panel";
import { OrderBoard } from "@/components/order-board";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order board",
  description: "Player buy and sell orders for Star Citizen commodities — settled in-game, player to player.",
};

export default async function OrdersPage() {
  const user = await currentUser();
  let orders: OrderDto[] = [];
  let contracts: ContractDto[] = [];
  try {
    const db = getDb();
    [orders, contracts] = await Promise.all([
      listOrders(db, { viewerId: user?.id ?? null, statuses: ["active"], limit: 500 }),
      user ? listContracts(db, user.id, true) : Promise.resolve([]),
    ]);
  } catch (err) {
    console.error("[orders page]", err instanceof Error ? err.message : err);
  }
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Order board</h1>
        <p className="text-xs text-ink-dim">
          Player buy and sell orders at whatever price traders choose. Claiming an order locks it
          into an escrow contract so nobody else chases the same cargo; both parties then settle
          in-game and confirm. KCX never holds aUEC or cargo.
        </p>
      </div>

      <ContractsPanel contracts={contracts} wsUrl={wsUrl} userId={user?.id ?? null} />

      {orders.length === 0 ? (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">The book is empty.</p>
          <p>
            Post the first order from the{" "}
            <Link href="/" className="text-accent hover:underline">
              market wall
            </Link>{" "}
            — any tile, row, or your portfolio.
          </p>
        </div>
      ) : (
        <OrderBoard orders={orders} signedIn={!!user} wsUrl={wsUrl} userId={user?.id ?? null} />
      )}
    </>
  );
}
