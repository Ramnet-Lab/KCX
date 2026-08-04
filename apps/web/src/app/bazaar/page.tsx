import { getDb, listBazaarListings, type BazaarListingDto } from "@kcx/db";
import type { Metadata } from "next";
import { BazaarBoard } from "@/components/bazaar-board";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bazaar",
  description:
    "Player marketplace for Star Citizen ships, components, weapons and crafted goods — buy it now or bid, settled in-game between players.",
};

export default async function BazaarPage() {
  const user = await currentUser();
  let listings: BazaarListingDto[] = [];

  try {
    listings = await listBazaarListings(getDb(), { viewerId: user?.id ?? null, sort: "newest" });
  } catch (err) {
    console.error("[bazaar page]", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Bazaar</h1>
        <p className="text-xs text-ink-dim">
          Ships, components, weapons, crafted goods — anything that isn&apos;t bulk cargo. Take a
          listing at its asking price or bid on it; either way you meet the other trader
          in-game and you both confirm the handover before aUEC moves. Nothing sold here
          touches the commodity market price.
        </p>
      </div>

      <BazaarBoard listings={listings} signedIn={!!user} verified={!!user?.isVerified} />
    </>
  );
}
