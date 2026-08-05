import {
  getDb,
  listBazaarSales,
  canUseInstalments,
  listBazaarThreads,
  listInstalmentPlans,
  listPriceAlerts,
  listInventory,
  type InventoryRow,
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
  let inventory: InventoryRow[] = [];

  /*
   * allSettled, not all.
   *
   * These are eleven independent reads, and Promise.all made them one failure domain: a
   * stale column in the instalments query blanked the ENTIRE desk — listings, sales,
   * contracts, orders, everything — behind a single catch. A trader saw an empty page and
   * no error, which is indistinguishable from having nothing on. Each section now fails on
   * its own and the rest still render.
   */
  try {
    const db = getDb();
    const settled = await Promise.allSettled([
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
      listInventory(db, user.id),
    ]);
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[manage page] section ${i} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
      }
    });
    const val = <T,>(i: number, fallback: T): T =>
      settled[i]?.status === "fulfilled" ? ((settled[i] as PromiseFulfilledResult<T>).value ?? fallback) : fallback;
    listings = val(0, listings);
    sales = val(1, sales);
    serviceContracts = val(2, serviceContracts);
    orders = val(3, orders);
    escrows = val(4, escrows);
    threads = val(5, threads);
    watchlist = val(6, watchlist);
    alerts = val(7, alerts);
    plans = val(8, plans);
    eligibility = val(9, eligibility);
    toRate = val(10, toRate);
    inventory = val(11, inventory);
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
        inventory={inventory}
      />
    </>
  );
}
