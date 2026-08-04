import { getBazaarListing, getDb, listWatchlist, myThreadForListing } from "@kcx/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BazaarDetail } from "@/components/bazaar-detail";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const listing = await getBazaarListing(getDb(), id);
    if (!listing) return { title: "Listing" };
    return {
      title: listing.title,
      description: listing.description?.slice(0, 200) ?? `On the KCX bazaar, sold by ${listing.sellerName}.`,
    };
  } catch {
    return { title: "Listing" };
  }
}

export default async function BazaarListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();

  let listing = null;
  let myThreadId: string | null = null;
  let watching: { id: number; threshold: number | null; direction: string } | null = null;
  try {
    const db = getDb();
    listing = await getBazaarListing(db, id, user?.id ?? null);
    if (user && listing) {
      myThreadId = (await myThreadForListing(db, id, user.id))?.id ?? null;
      if (listing.itemId != null) {
        watching = (await listWatchlist(db, user.id)).find((w) => w.itemId === listing!.itemId) ?? null;
      }
    }
  } catch (err) {
    console.error("[bazaar listing page]", err instanceof Error ? err.message : err);
  }
  if (!listing) notFound();

  return (
    <BazaarDetail
      listing={listing}
      signedIn={!!user}
      verified={!!user?.isVerified}
      myThreadId={myThreadId}
      watching={watching}
    />
  );
}
