"use client";

import type { BazaarListingDto } from "@kcx/db";
import { BAZAAR_CATEGORIES, BAZAAR_CATEGORY_LABELS, type BazaarCategory } from "@kcx/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BazaarCompose } from "@/components/bazaar-compose";
import { BazaarStandingBadge } from "@/components/trader-standing";
import { countdown, fmtAuec, isClosingSoon, timeLeft } from "@/lib/countdown";

type Sort = "newest" | "ending" | "price_asc" | "price_desc";

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "ending", label: "Ending soonest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

/**
 * The bazaar board — a grid of what's for sale.
 *
 * Cards carry a picture, a price and a clock, and every one of them leads to the listing
 * itself. Bidding is deliberately NOT on the card: a bid is binding and commits the money,
 * so it belongs on the page where the terms are actually in front of you.
 */
export function BazaarBoard({
  listings: initial,
  signedIn,
  verified,
}: {
  listings: BazaarListingDto[];
  signedIn: boolean;
  verified: boolean;
}) {
  const [listings, setListings] = useState(initial);
  const [category, setCategory] = useState<BazaarCategory | "all">("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [includeEnded, setIncludeEnded] = useState(false);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // The server rendered the default view; every filter change re-asks it rather than
  // narrowing a client-side copy, so paging and sorting stay one implementation in SQL.
  useEffect(() => {
    const params = new URLSearchParams({ sort });
    if (category !== "all") params.set("category", category);
    if (search.trim()) params.set("q", search.trim());
    if (mineOnly) params.set("mine", "1");
    if (includeEnded) params.set("all", "1");

    const isDefault = sort === "newest" && category === "all" && !search.trim() && !mineOnly && !includeEnded;
    if (isDefault) {
      setListings(initial);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/bazaar?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok) setListings(body.listings ?? []);
          else setError(body.error ?? "Could not load listings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250); // debounce so typing in the search box isn't one request per keystroke

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [category, sort, search, mineOnly, includeEnded, initial]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search listings…"
          aria-label="Search listings"
          className="w-44 rounded border border-line bg-panel px-2 py-1.5 text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as BazaarCategory | "all")}
          aria-label="Filter by category"
          className="rounded border border-line bg-panel px-2 py-1.5 text-ink focus:outline-none"
        >
          <option value="all">All categories</option>
          {BAZAAR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BAZAAR_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort listings"
          className="rounded border border-line bg-panel px-2 py-1.5 text-ink focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {signedIn && (
          <label className="flex items-center gap-1 text-ink-dim">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="accent-[#e8b449]"
            />
            Mine
          </label>
        )}
        <label className="flex items-center gap-1 text-ink-dim" title="Include sold and expired listings">
          <input
            type="checkbox"
            checked={includeEnded}
            onChange={(e) => setIncludeEnded(e.target.checked)}
            className="accent-[#e8b449]"
          />
          Show ended
        </label>
        <span className="text-ink-faint">{loading ? "…" : `${listings.length} listed`}</span>
        <button
          onClick={() => (signedIn ? setComposing((v) => !v) : router.push("/signin"))}
          className="tap ml-auto rounded border border-accent/60 px-3 py-1.5 font-bold text-accent hover:bg-accent/10"
        >
          {composing ? "Close" : "+ List an item"}
        </button>
      </div>

      {composing && signedIn && !verified && (
        <div className="mb-3 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          Verify your RSI handle before selling — an unverified account is free to make, which
          makes it the cheapest way to take someone&apos;s money and vanish.
        </div>
      )}
      {composing && signedIn && (
        <BazaarCompose
          onPosted={(id) => {
            setComposing(false);
            router.push(`/bazaar/${id}`);
          }}
        />
      )}

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {listings.length === 0 ? (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">Nothing on the shelves.</p>
          <p>Got a ship, a crate of components, or something you crafted? List the first one.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingCard({ listing: l }: { listing: BazaarListingDto }) {
  const thumb = l.images[0];
  const isAuction = l.listingType !== "buy_now";
  const ended = l.status !== "active";
  const closing = isClosingSoon(l.auctionEndsAt);

  return (
    <Link
      href={`/bazaar/${l.id}`}
      className={`group flex flex-col overflow-hidden rounded border bg-panel transition-colors ${
        l.isSeller ? "border-accent/40" : "border-line hover:border-ink-faint"
      }`}
    >
      <div className="relative aspect-4/3 bg-panel-2">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/uploads/bazaar/${thumb}`}
            alt={l.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] text-ink-faint">
            no photo
          </span>
        )}
        {l.images.length > 1 && (
          <span className="absolute bottom-1 right-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-ink-dim">
            {l.images.length} photos
          </span>
        )}
        {ended && (
          <span className="absolute inset-0 flex items-center justify-center bg-bg/70 text-sm font-bold uppercase tracking-widest text-ink-dim">
            {l.status === "sold_out" ? "Sold" : l.status.replace(/_/g, " ")}
          </span>
        )}
        {isAuction && !ended && (
          <span className="absolute left-1 top-1 rounded bg-accent/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-bg">
            {l.listingType === "auction_buy_now" && l.canBuyNow ? "Bid or buy" : "Auction"}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start gap-2">
          <h3 className="line-clamp-2 flex-1 text-sm font-bold leading-snug text-ink group-hover:text-accent">
            {l.title}
          </h3>
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            {BAZAAR_CATEGORY_LABELS[l.category as BazaarCategory] ?? l.category}
          </span>
        </div>

        <div className="mt-auto">
          {isAuction ? (
            <div className="flex items-baseline gap-2">
              <span className="num text-base font-bold text-up">
                {fmtAuec(l.currentBid ?? l.startPrice ?? 0)} aUEC
              </span>
              <span className="text-[10px] text-ink-faint">
                {l.currentBid == null
                  ? "starting bid"
                  : `${l.bidCount} bid${l.bidCount === 1 ? "" : "s"} · ${l.bidderCount} bidder${l.bidderCount === 1 ? "" : "s"}`}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="num text-base font-bold text-up">{fmtAuec(l.buyNowPrice ?? 0)} aUEC</span>
              {l.quantity > 1 && (
                <span className="text-[10px] text-ink-faint">
                  each · {l.remainingQuantity} of {l.quantity} left
                </span>
              )}
            </div>
          )}
          {isAuction && l.canBuyNow && l.buyNowPrice != null && (
            <div className="num text-[11px] text-ink-dim">or buy it now at {fmtAuec(l.buyNowPrice)}</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
          <span className="text-ink-dim">{l.sellerName}</span>
          <BazaarStandingBadge {...l.sellerStanding} compact />
          {!ended && (
            <span className={`ml-auto ${closing ? "font-bold text-accent" : ""}`} suppressHydrationWarning>
              {isAuction ? `closes in ${countdown(l.auctionEndsAt)}` : timeLeft(l.expiresAt)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
