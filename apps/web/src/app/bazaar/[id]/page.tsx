import { getBazaarListing, getDb } from "@kcx/db";
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
  try {
    listing = await getBazaarListing(getDb(), id, user?.id ?? null);
  } catch (err) {
    console.error("[bazaar listing page]", err instanceof Error ? err.message : err);
  }
  if (!listing) notFound();

  return <BazaarDetail listing={listing} signedIn={!!user} verified={!!user?.isVerified} />;
}
