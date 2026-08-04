import {
  getDb,
  listBazaarSales,
  canUseInstalments,
  listBazaarThreads,
  listInstalmentPlans,
  listPriceAlerts,
  listWatchlist,
  type InstalmentPlanDto,
  type BazaarThreadDto,
  type PriceAlertDto,
  type WatchEntryDto,
  listContracts,
  listContractsBoard,
  listOrders,
  myBazaarListings,
  pendingBazaarRatings,
  type BazaarListingDto,
  type BazaarSaleDto,
  type ContractDto,
  type ServiceContractDto,
} from "@kcx/db";
import type { OrderDto } from "@kcx/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManageDesk } from "@/components/manage-desk";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My desk" };

/**
 * One page for everything a trader has going: bazaar listings and sales, service contracts,
 * and resting orders with their escrows.
 *
 * Deliberately not three pages. These are all obligations against the same declared balance
 * — an order commits aUEC that a bid can't also commit — and a trader who has to visit
 * three places to see what they owe will keep discovering it at settlement instead.
 */
export default async function ManagePage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  let listings: BazaarListingDto[] = [];
  let sales: BazaarSaleDto[] = [];
  let serviceContracts: ServiceContractDto[] = [];
  let orders: OrderDto[] = [];
  let escrows: ContractDto[] = [];
  let threads: BazaarThreadDto[] = [];
  let watchlist: WatchEntryDto[] = [];
  let alerts: PriceAlertDto[] = [];
  let plans: InstalmentPlanDto[] = [];
  let eligibility: { allowed: boolean; reason: string | null } | null = null;
  let toRate: { saleId: string; counterpartyName: string; title: string }[] = [];

  try {
    const db = getDb();
    [listings, sales, serviceContracts, orders, escrows, threads, watchlist, alerts, plans, eligibility, toRate] =
      await Promise.all([
      myBazaarListings(db, user.id),
      listBazaarSales(db, user.id),
      listContractsBoard(db, {
        viewerId: user.id,
        viewerRole: user.role,
        mineOnly: true,
        statuses: ["open", "bidding", "awarded", "in_progress", "completed", "cancelled", "expired"],
      }),
      listOrders(db, {
        viewerId: user.id,
        ownerId: user.id,
        statuses: ["active", "paused", "filled", "completed", "cancelled", "expired_unfilled", "expired_season"],
        limit: 300,
      }),
      listContracts(db, user.id),
      listBazaarThreads(db, user.id),
      listWatchlist(db, user.id),
      listPriceAlerts(db, user.id),
      listInstalmentPlans(db, user.id),
      canUseInstalments(db, user.id),
      pendingBazaarRatings(db, user.id),
    ]);
  } catch (err) {
    console.error("[manage page]", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">My desk</h1>
        <p className="text-xs text-ink-dim">
          Everything you have going on KCX: what you&apos;re selling on the bazaar, sales waiting
          to be confirmed, contracts you issued or took, and your resting orders. All of it
          draws on the same declared balance, so it all lives in one place.
        </p>
      </div>

      <ManageDesk
        listings={listings}
        sales={sales}
        serviceContracts={serviceContracts}
        orders={orders}
        escrows={escrows}
        threads={threads}
        watchlist={watchlist}
        alerts={alerts}
        plans={plans}
        instalmentEligibility={eligibility}
        pendingRatings={toRate}
      />
    </>
  );
}
