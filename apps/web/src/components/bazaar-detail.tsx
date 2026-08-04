"use client";

import type { BazaarListingDto } from "@kcx/db";
import {
  BAZAAR_CATEGORIES,
  BAZAAR_CATEGORY_LABELS,
  BAZAAR_DURATIONS,
  type BazaarCategory,
} from "@kcx/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPriceHistory } from "@/components/bazaar-item-picker";
import { LoadoutEditor, LoadoutList } from "@/components/bazaar-loadout";
import { StartBazaarThread } from "@/components/bazaar-thread";
import { WatchButton } from "@/components/watchlist";
import { BazaarStandingBadge } from "@/components/trader-standing";
import { countdown, fmtAuec, isClosingSoon, timeLeft } from "@/lib/countdown";

const MAX_IMAGES = 6;

/**
 * One listing, in full.
 *
 * Everything that commits money lives here rather than on the board card: a bid is binding
 * and a purchase starts a settlement clock, and neither should be one tap away from a grid
 * you were scrolling past.
 */
export function BazaarDetail({
  listing: initial,
  signedIn,
  verified,
  myThreadId = null,
  watching = null,
}: {
  listing: BazaarListingDto;
  signedIn: boolean;
  verified: boolean;
  myThreadId?: string | null;
  watching?: { id: number; threshold: number | null; direction: string } | null;
}) {
  const [l, setListing] = useState(initial);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  const isAuction = l.listingType !== "buy_now";
  const live = l.status === "active";

  const refresh = async () => {
    const res = await fetch(`/api/bazaar/${l.id}`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      if (body.listing) setListing(body.listing);
    }
    router.refresh();
  };

  const call = async (url: string, init: RequestInit): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That didn't work");
        return false;
      }
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const act = (action: string, extra: Record<string, unknown> = {}) =>
    call(`/api/bazaar/${l.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });

  return (
    <div>
      <Link href="/bazaar" className="mb-3 inline-block text-xs text-ink-faint hover:text-accent">
        ← Back to the bazaar
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---------- Left: pictures and description ---------- */}
        <div>
          <div className="overflow-hidden rounded border border-line bg-panel-2">
            <div className="relative aspect-4/3">
              {l.images[active] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/uploads/bazaar/${l.images[active]}`}
                  alt={l.title}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm text-ink-faint">
                  No photos on this listing
                </span>
              )}
              {l.status !== "active" && (
                <span className="absolute inset-0 flex items-center justify-center bg-bg/70 text-lg font-bold uppercase tracking-widest text-ink-dim">
                  {l.status === "sold_out" ? "Sold" : l.status.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>

          {l.images.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {l.images.map((f, i) => (
                <button
                  key={f}
                  onClick={() => setActive(i)}
                  aria-label={`Photo ${i + 1}`}
                  className={`tap overflow-hidden rounded border ${i === active ? "border-accent" : "border-line"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/uploads/bazaar/${f}`} alt="" className="h-16 w-16 object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                {BAZAAR_CATEGORY_LABELS[l.category as BazaarCategory] ?? l.category}
              </span>
              <h1 className="text-lg font-bold text-ink">{l.title}</h1>
            </div>
            {l.itemName && (
              <p className="mt-1 text-xs text-ink-faint">
                Listed as <span className="text-ink-dim">{l.itemName}</span>
              </p>
            )}
            {l.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-dim">{l.description}</p>
            )}
            <LoadoutList components={l.components} />

            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-ink-faint">{l.orgSid ? "Acting for" : "Seller"}</dt>
                <dd className="text-ink">
                  {l.orgSid ? (
                    <span className="flex items-center gap-1.5">
                      {l.orgLogoFilename && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/uploads/orgs/${l.orgLogoFilename}`}
                          alt=""
                          className="h-4 w-4 rounded-sm border border-line"
                        />
                      )}
                      <a href={`/orgs/${l.orgSid}`} className="hover:text-accent">
                        {l.orgName}
                      </a>
                      <span className="text-[10px] text-ink-faint">via {l.sellerName}</span>
                    </span>
                  ) : (
                    l.sellerName
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Standing</dt>
                <dd>
                  <BazaarStandingBadge {...l.sellerStanding} />
                </dd>
              </div>
              {l.locationName && (
                <div>
                  <dt className="text-ink-faint">Handover</dt>
                  <dd className="text-ink">{l.locationName}</dd>
                </div>
              )}
              <div>
                <dt className="text-ink-faint">{isAuction ? "Bidding ends" : "Listed until"}</dt>
                <dd className="text-ink" suppressHydrationWarning>
                  {timeLeft(isAuction ? l.auctionEndsAt : l.expiresAt)}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* ---------- Right: the money ---------- */}
        <div className="space-y-3">
          <div className="rounded border border-line bg-panel p-4">
            {isAuction ? (
              <>
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  {l.currentBid == null ? "Starting bid" : "Current bid"}
                </div>
                <div className="num text-2xl font-bold text-up">
                  {fmtAuec(l.currentBid ?? l.startPrice ?? 0)}
                  <span className="ml-1 text-sm font-normal text-ink-dim">aUEC</span>
                </div>
                <div className="mt-1 text-[11px] text-ink-faint">
                  {l.bidCount} bid{l.bidCount === 1 ? "" : "s"} from {l.bidderCount} bidder
                  {l.bidderCount === 1 ? "" : "s"}
                  {l.currentBidderName && ` · high bidder ${l.currentBidderName}`}
                </div>
                {live && (
                  <div
                    className={`mt-1 text-xs ${isClosingSoon(l.auctionEndsAt) ? "font-bold text-accent" : "text-ink-dim"}`}
                    suppressHydrationWarning
                  >
                    Closes in {countdown(l.auctionEndsAt)}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  {l.intent === "buy" ? "Offered" : "Price"}
                </div>
                <div className="num text-2xl font-bold text-up">
                  {fmtAuec(l.buyNowPrice ?? 0)}
                  <span className="ml-1 text-sm font-normal text-ink-dim">aUEC{l.quantity > 1 ? " each" : ""}</span>
                </div>
                {l.intent === "buy" ? (
                  <div className="mt-1 text-[11px] text-ink-faint">
                    Wants {l.remainingQuantity}. This aUEC is committed against the buyer&apos;s
                    declared balance while the ad stands — it is an offer, not a wish.
                  </div>
                ) : (
                  l.quantity > 1 && (
                    <div className="mt-1 text-[11px] text-ink-faint">
                      {l.remainingQuantity} of {l.quantity} still available
                    </div>
                  )
                )}
              </>
            )}

            {l.isHighBidder && live && (
              <p className="mt-3 rounded border border-up/40 bg-up/10 px-2 py-1.5 text-[11px] text-up">
                You&apos;re the high bidder. This much of your declared balance is committed until
                someone beats you.
              </p>
            )}
            {!l.isHighBidder && l.myBid != null && live && (
              <p className="mt-3 rounded border border-line bg-panel-2 px-2 py-1.5 text-[11px] text-ink-dim">
                You were outbid at{" "}
                <span className="num text-ink">{fmtAuec(l.myBid)} aUEC</span> — your aUEC is free again.
              </p>
            )}

            {!l.isSeller && live && (
              <div className="mt-3 space-y-3">
                {!signedIn ? (
                  <button
                    onClick={() => router.push("/signin")}
                    className="tap w-full rounded bg-accent/20 px-3 py-2 text-sm font-bold text-accent hover:bg-accent/30"
                  >
                    {l.intent === "buy" ? "Sign in to fill this" : "Sign in to buy or bid"}
                  </button>
                ) : !verified ? (
                  <p className="rounded border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px] text-accent">
                    Verify your RSI handle before buying or bidding.
                  </p>
                ) : (
                  <>
                    {isAuction && (
                      <BidForm
                        listing={l}
                        busy={busy}
                        onBid={async (amount) => {
                          const ok = await call(`/api/bazaar/${l.id}/bid`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ amount }),
                          });
                          if (ok) setNotice("Bid placed. You'll hold it until someone outbids you.");
                        }}
                      />
                    )}
                    {l.canBuyNow && (
                      <BuyForm
                        listing={l}
                        busy={busy}
                        onBuy={async (quantity) => {
                          const ok = await call(`/api/bazaar/${l.id}/buy`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ quantity }),
                          });
                          if (ok) {
                            setNotice(
                              "Agreed. Meet the seller in-game — the sale is on your desk, and you both confirm there once it's done.",
                            );
                          }
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="mt-3 rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
                {error}
              </div>
            )}
            {notice && (
              <div className="mt-3 rounded border border-up/40 bg-up/10 px-2 py-1.5 text-[11px] text-up">
                {notice}{" "}
                <Link href="/manage" className="underline">
                  Go to my desk
                </Link>
              </div>
            )}

            <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-faint">
              KCX holds nothing. You meet in-game, hand it over, and you both confirm here —
              only then does the aUEC move between your declared balances.
            </p>
          </div>

          {/* The negotiation, in the product rather than on Discord. Everything below the
              price panel because the asking price is what someone came to see first. */}
          <StartBazaarThread
            listingId={l.id}
            existingThreadId={myThreadId}
            signedIn={signedIn}
            verified={verified}
            isOwner={l.isSeller}
            intent={l.intent}
          />

          {/* What one of these has actually gone for, next to what this one is asking. A
              buyer deciding whether the price is fair needs both numbers in one place. */}
          {l.itemId != null && (
            <div className="rounded border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  What these go for
                </h2>
                {signedIn && (
                  <WatchButton itemId={l.itemId} label={l.itemName ?? l.title} existing={watching} />
                )}
              </div>
              <ItemPriceHistory itemId={l.itemId} />
            </div>
          )}

          {l.isSeller && (
            <SellerPanel
              listing={l}
              busy={busy}
              onAct={act}
              onChanged={refresh}
              onError={setError}
              onRefetch={refresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BidForm({
  listing: l,
  busy,
  onBid,
}: {
  listing: BazaarListingDto;
  busy: boolean;
  onBid: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const value = Math.round(Number(amount));

  return (
    <div>
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          Your bid — at least {fmtAuec(l.minimumBid)} aUEC
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={l.minimumBid}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={String(l.minimumBid)}
          className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
        />
      </label>
      <button
        onClick={() => onBid(value)}
        disabled={busy || !(value >= l.minimumBid)}
        className="tap mt-2 w-full rounded bg-accent/20 px-3 py-2 text-sm font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        {busy ? "…" : l.isHighBidder ? "Raise my bid" : "Place bid"}
      </button>
      <p className="mt-1 text-[11px] leading-snug text-ink-faint">
        Bids are binding and can&apos;t be taken back. Yours is committed against your declared
        balance while it leads, and released the moment someone beats it. A bid in the last
        few minutes pushes the close out, so there is nothing to gain by waiting.
      </p>
    </div>
  );
}

function BuyForm({
  listing: l,
  busy,
  onBuy,
}: {
  listing: BazaarListingDto;
  busy: boolean;
  onBuy: (quantity: number) => void;
}) {
  const [qty, setQty] = useState("1");
  const n = Math.min(Math.max(1, Math.round(Number(qty) || 1)), l.remainingQuantity);
  const total = (l.buyNowPrice ?? 0) * n;

  return (
    <div className={l.listingType === "auction_buy_now" ? "border-t border-line pt-3" : ""}>
      {l.remainingQuantity > 1 && (
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">How many</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={l.remainingQuantity}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
          />
        </label>
      )}
      <button
        onClick={() => onBuy(n)}
        disabled={busy}
        className="tap mt-2 w-full rounded bg-up/20 px-3 py-2 text-sm font-bold text-up hover:bg-up/30 disabled:opacity-40"
      >
        {busy
          ? "…"
          : l.intent === "buy"
            ? `Sell it to them — ${fmtAuec(total)} aUEC`
            : `Buy it now — ${fmtAuec(total)} aUEC`}
      </button>
    </div>
  );
}

/** The seller's own controls: edit the listing, manage photos, run its lifecycle. */
function SellerPanel({
  listing: l,
  busy,
  onAct,
  onChanged,
  onError,
  onRefetch,
}: {
  listing: BazaarListingDto;
  busy: boolean;
  onAct: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
  onRefetch: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(l.title);
  const [description, setDescription] = useState(l.description ?? "");
  const [category, setCategory] = useState(l.category as BazaarCategory);
  const [price, setPrice] = useState(String(l.buyNowPrice ?? ""));
  const [quantity, setQuantity] = useState(String(l.quantity));
  const [relistHours, setRelistHours] = useState(168);
  const [uploading, setUploading] = useState(false);

  const live = l.status === "active" || l.status === "paused";
  const ended = ["expired", "cancelled", "sold_out"].includes(l.status);
  const priceLocked = l.listingType === "auction" || (l.listingType === "auction_buy_now" && l.bidCount > 0);

  const saveEdit = async () => {
    const edit: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      category,
    };
    if (!priceLocked && Number(price) > 0) edit.buyNowPrice = Math.round(Number(price));
    if (l.listingType === "buy_now" && Number(quantity) > 0) edit.quantity = Math.round(Number(quantity));
    const ok = await onAct("edit", { edit });
    if (ok) setEditing(false);
  };

  const addPhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`/api/bazaar/${l.id}/images`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError(body.error ?? "Could not add the photo");
      } else {
        await onChanged();
      }
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (filename: string) => {
    const res = await fetch(`/api/bazaar/${l.id}/images?filename=${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? "Could not remove the photo");
    } else {
      await onChanged();
    }
  };

  return (
    <div className="rounded border border-accent/40 bg-panel p-4">
      <h2 className="mb-2 text-sm font-bold text-accent">Your listing</h2>

      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            aria-label="Title"
            className="w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={4000}
            aria-label="Description"
            className="w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink focus:outline-none"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as BazaarCategory)}
            aria-label="Category"
            className="w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink focus:outline-none"
          >
            {BAZAAR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BAZAAR_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          {!priceLocked && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Price (aUEC)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
              />
            </label>
          )}
          {l.listingType === "buy_now" && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">How many in total</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
              />
            </label>
          )}
          {priceLocked && (
            <p className="text-[11px] text-ink-faint">
              {l.listingType === "auction"
                ? "An auction's price is whatever the bidding settles on."
                : "Bidding has started, so the buy-it-now price is fixed now."}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              disabled={busy || title.trim().length < 4}
              className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
            >
              Save
            </button>
            <button onClick={() => setEditing(false)} className="tap px-2 py-1 text-xs text-ink-faint hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 text-xs">
          {live && (
            <button
              onClick={() => setEditing(true)}
              className="tap rounded border border-line px-2 py-1 text-ink-dim hover:text-ink"
            >
              Edit
            </button>
          )}
          {l.status === "active" && l.listingType === "buy_now" && (
            <button
              onClick={() => onAct("pause")}
              disabled={busy}
              className="tap rounded border border-line px-2 py-1 text-ink-dim hover:text-ink disabled:opacity-40"
            >
              Pause
            </button>
          )}
          {l.status === "paused" && (
            <button
              onClick={() => onAct("resume")}
              disabled={busy}
              className="tap rounded border border-line px-2 py-1 text-ink-dim hover:text-ink disabled:opacity-40"
            >
              Resume
            </button>
          )}
          {l.status === "active" && (
            <button
              onClick={() => onAct("bump")}
              disabled={busy}
              title="Move it back to the top of the board"
              className="tap rounded border border-line px-2 py-1 text-ink-dim hover:text-ink disabled:opacity-40"
            >
              Bump
            </button>
          )}
          {live && (
            <button
              onClick={() => onAct("cancel")}
              disabled={busy}
              className="tap rounded border border-line px-2 py-1 text-ink-faint hover:text-danger disabled:opacity-40"
            >
              Take it down
            </button>
          )}
          {ended && (
            <span className="flex flex-wrap items-center gap-2">
              <select
                value={relistHours}
                onChange={(e) => setRelistHours(Number(e.target.value))}
                aria-label="Relist for"
                className="rounded border border-line bg-bg px-2 py-1 text-xs text-ink focus:outline-none"
              >
                {BAZAAR_DURATIONS.map((d) => (
                  <option key={d.hours} value={d.hours}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onAct("relist", { runForHours: relistHours })}
                disabled={busy}
                className="tap rounded bg-accent/20 px-3 py-1 font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
              >
                Relist
              </button>
            </span>
          )}
        </div>
      )}

      {live && (
        <div className="mt-3 border-t border-line pt-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Photos ({l.images.length}/{MAX_IMAGES})
          </span>
          {l.images.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {l.images.map((f) => (
                <span key={f} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/bazaar/${f}`}
                    alt=""
                    className="h-14 w-14 rounded border border-line object-cover"
                  />
                  <button
                    onClick={() => removePhoto(f)}
                    aria-label="Remove photo"
                    className="tap absolute right-0 top-0 rounded-bl bg-bg/80 px-1 text-[11px] text-ink-faint hover:text-danger"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          {l.images.length < MAX_IMAGES && (
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading}
              onChange={(e) => {
                void addPhoto(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
              className="mt-2 w-full text-[11px] text-ink-dim file:mr-2 file:rounded file:border file:border-line file:bg-panel-2 file:px-2 file:py-1 file:text-[11px] file:text-ink-dim hover:file:text-ink"
            />
          )}
        </div>
      )}

      {live && (
        <LoadoutEditor
          listingId={l.id}
          initial={l.components}
          onSaved={() => {
            void onRefetch();
          }}
        />
      )}

      <p className="mt-3 text-[11px] text-ink-faint">
        Sales waiting to be confirmed are on{" "}
        <Link href="/manage" className="text-accent hover:underline">
          your desk
        </Link>
        .
      </p>
    </div>
  );
}
