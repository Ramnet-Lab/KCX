"use client";

import {
  BAZAAR_CATEGORIES,
  BAZAAR_CATEGORY_LABELS,
  BAZAAR_DEFAULT_HOURS,
  BAZAAR_DURATIONS,
  type BazaarCategory,
  type BazaarIntent,
  type BazaarListingType,
} from "@kcx/shared";
import { useEffect, useState } from "react";
import { BazaarItemPicker, ItemPriceHistory, type PickedItem } from "@/components/bazaar-item-picker";
import { fmtAuec } from "@/lib/countdown";

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MODES: { value: BazaarListingType; label: string; blurb: string }[] = [
  { value: "buy_now", label: "Fixed price", blurb: "First buyer takes it at your price." },
  { value: "auction", label: "Auction", blurb: "Highest bid when the clock runs out wins." },
  {
    value: "auction_buy_now",
    label: "Auction + buy it now",
    blurb: "Bidding, with a price that ends it early — until someone bids.",
  },
];

/**
 * The sell form.
 *
 * The listing is created first and photos are uploaded against it afterwards, so a failed
 * image doesn't discard a filled-in form — the item is listed either way and the seller is
 * told which photo didn't make it.
 */
export function BazaarCompose({
  onPosted,
  seed,
}: {
  onPosted: (id: string) => void;
  /** Prefill handed over from the inventory tab — item and how many are free to sell. */
  seed?: { itemId: number; name: string; quantity: number } | null;
}) {
  const [intent, setIntent] = useState<BazaarIntent>("sell");
  const [orgId, setOrgId] = useState<string>("");
  const [orgs, setOrgs] = useState<{ id: string; sid: string; name: string; myRole: string | null }[]>([]);
  const [item, setItem] = useState<PickedItem | null>(seed ? { id: seed.itemId, name: seed.name } : null);
  const [title, setTitle] = useState(seed?.name ?? "");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<BazaarCategory>("ships");
  const [listingType, setListingType] = useState<BazaarListingType>("buy_now");
  const [buyNowPrice, setBuyNowPrice] = useState("");
  const [startPrice, setStartPrice] = useState("");
  const [quantity, setQuantity] = useState(seed ? String(seed.quantity) : "1");
  const [hours, setHours] = useState<number>(BAZAAR_DEFAULT_HOURS);
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuction = listingType !== "buy_now";
  const hasBuyNow = listingType !== "auction";

  // Only orgs the trader can actually commit for are offered — showing one they'd be
  // refused on is a form that fails at submit for a reason the form already knew.
  useEffect(() => {
    void fetch("/api/orgs")
      .then((r) => (r.ok ? r.json() : { orgs: [] }))
      .then((b) => setOrgs((b.orgs ?? []).filter((o: { myRole: string | null }) => o.myRole !== "member")))
      .catch(() => {});
  }, []);

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(`Up to ${MAX_IMAGES} photos.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    const tooBig = picked.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" is over 5 MB.`);
      return;
    }
    setError(null);
    setImages((prev) => [...prev, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index]!.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const buyNow = Math.round(Number(buyNowPrice));
  const start = Math.round(Number(startPrice));
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const valid =
    title.trim().length >= 4 &&
    (!hasBuyNow || buyNow > 0) &&
    (!isAuction || start > 0) &&
    (listingType !== "auction_buy_now" || buyNow > start) &&
    // "I want to buy something" is not an offer anyone can fill, so a wanted ad has to name
    // the item. The server enforces this too — this only spares the round trip.
    (intent === "sell" || item != null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bazaar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent,
          ...(orgId ? { orgId } : {}),
          title: title.trim(),
          description: description.trim() || undefined,
          // An id when they picked from the list, a name when they typed one the catalogue
          // doesn't have yet — the server decides which, and creates only on a genuinely
          // new normalised key.
          ...(item?.id != null ? { itemId: item.id } : item ? { itemName: item.name } : {}),
          category,
          listingType,
          ...(hasBuyNow ? { buyNowPrice: buyNow } : {}),
          ...(isAuction ? { startPrice: start } : {}),
          quantity: isAuction ? 1 : qty,
          runForHours: hours,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not post the listing");
        return;
      }

      // Uploaded one at a time so the order the seller arranged is the order stored — the
      // first photo is the thumbnail the board draws.
      const failed: string[] = [];
      for (const { file } of images) {
        const fd = new FormData();
        fd.append("image", file);
        const up = await fetch(`/api/bazaar/${body.id}/images`, { method: "POST", body: fd });
        if (!up.ok) failed.push(file.name);
      }
      if (failed.length > 0) {
        setError(`Listed, but ${failed.length} photo(s) failed to upload: ${failed.join(", ")}`);
      }
      onPosted(body.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-bold text-ink">
        {intent === "buy" ? "Post a wanted ad" : "List an item"}
      </h2>
      <div className="space-y-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Which way round
          </span>
          <div className="mt-1 flex gap-1">
            <button
              onClick={() => setIntent("sell")}
              className={`tap flex-1 rounded border px-2 py-1.5 text-xs ${
                intent === "sell" ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
              }`}
            >
              <span className="block font-bold">I&apos;m selling</span>
              <span className="mt-0.5 block text-[10px] text-ink-faint">I have it, here&apos;s my price</span>
            </button>
            <button
              onClick={() => {
                setIntent("buy");
                // A wanted ad is a fixed offer — see the reverse-auction note in the schema.
                setListingType("buy_now");
              }}
              className={`tap flex-1 rounded border px-2 py-1.5 text-xs ${
                intent === "buy" ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
              }`}
            >
              <span className="block font-bold">I&apos;m buying</span>
              <span className="mt-0.5 block text-[10px] text-ink-faint">I want it, here&apos;s what I&apos;ll pay</span>
            </button>
          </div>
        </div>

        {orgs.length > 0 && (
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Posting as</span>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink focus:outline-none"
            >
              <option value="">Yourself</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.sid})
                </option>
              ))}
            </select>
            {orgId && (
              <span className="mt-1 block text-[11px] text-ink-faint">
                {intent === "buy"
                  ? "The org's treasury backs this ad, capped by your delegated limit."
                  : "Proceeds go to the org's treasury, not your balance."}
              </span>
            )}
          </label>
        )}

        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            {intent === "buy"
              ? "What you're after — pick it, or type its in-game name"
              : "Which item — pick it, or type its in-game name"}
          </span>
          <BazaarItemPicker
            value={item}
            onChange={(picked) => {
              setItem(picked);
              // The item is the obvious starting point for the headline; the seller edits it
              // from there rather than typing the name twice.
              if (picked && !title.trim()) setTitle(picked.name);
            }}
          />
          {/* Priced against what these have actually gone for, before the price box rather
              than after it — a reference shown afterwards is a reference nobody used. */}
          <ItemPriceHistory itemId={item?.id ?? null} />
        </div>

        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Headline buyers see
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Drake Cutlass Black — fully kitted, S4 shields"
            className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Details (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Loadout, condition, where you'll hand it over, what the buyer needs to bring…"
            className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="min-w-40 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as BazaarCategory)}
              className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink focus:outline-none"
            >
              {BAZAAR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {BAZAAR_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          {!isAuction && (
            <label className="w-32">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">How many</span>
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
        </div>

        <div className={intent === "buy" ? "hidden" : ""}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">How it sells</span>
          <div className="mt-1 grid gap-1 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setListingType(m.value)}
                className={`tap rounded border px-2 py-1.5 text-left text-xs ${
                  listingType === m.value ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
                }`}
              >
                <span className="block font-bold">{m.label}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-ink-faint">{m.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {isAuction && (
            <label className="min-w-40 flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                Starting bid (aUEC)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={startPrice}
                onChange={(e) => setStartPrice(e.target.value)}
                placeholder="0"
                className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
              />
            </label>
          )}
          {hasBuyNow && (
            <label className="min-w-40 flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                {intent === "buy" ? "You'll pay each (aUEC)" : isAuction ? "Buy it now (aUEC)" : "Price each (aUEC)"}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={buyNowPrice}
                onChange={(e) => setBuyNowPrice(e.target.value)}
                placeholder="0"
                className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
              />
              {!isAuction && qty > 1 && buyNow > 0 && (
                <span className="num mt-1 block text-right text-[11px] text-ink-faint">
                  {fmtAuec(buyNow * qty)} aUEC for all {qty}
                </span>
              )}
            </label>
          )}
        </div>

        {listingType === "auction_buy_now" && (
          <p className="rounded border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] text-ink-faint">
            The buy-it-now price retires the moment somebody bids. Taking an item out from
            under a live bidder is the one move that would make bidding early irrational —
            and bidding early is what a rising price needs.
          </p>
        )}

        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            {isAuction ? "Bidding runs for" : "Stays listed for"}
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {BAZAAR_DURATIONS.map((d) => (
              <button
                key={d.hours}
                onClick={() => setHours(d.hours)}
                className={`tap flex-1 rounded border px-2 py-1 text-xs ${
                  hours === d.hours ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Photos ({images.length}/{MAX_IMAGES})
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => {
              addImages(e.target.files);
              e.target.value = "";
            }}
            className="mt-1 w-full text-xs text-ink-dim file:mr-3 file:rounded file:border file:border-line file:bg-panel-2 file:px-3 file:py-1.5 file:text-xs file:text-ink-dim hover:file:text-ink"
          />
          <span className="mt-1 block text-[11px] text-ink-faint">
            The first one is the thumbnail buyers see on the board. JPEG, PNG, WebP or GIF,
            up to 5 MB each. Location data is stripped from photos on upload.
          </span>
          {images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {images.map((img, i) => (
                <span key={img.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    className={`h-20 w-20 rounded border object-cover ${i === 0 ? "border-accent" : "border-line"}`}
                  />
                  {i === 0 && (
                    <span className="absolute left-0 top-0 rounded-br bg-accent px-1 text-[9px] font-bold text-bg">
                      COVER
                    </span>
                  )}
                  <button
                    onClick={() => removeImage(i)}
                    aria-label="Remove photo"
                    className="tap absolute right-0 top-0 rounded-bl bg-bg/80 px-1 text-[11px] text-ink-faint hover:text-danger"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="tap rounded bg-accent/20 px-4 py-1.5 text-sm font-bold text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Posting…" : intent === "buy" ? "Post wanted ad" : "List it"}
          </button>
          <span className="text-[11px] text-ink-faint">
            {intent === "buy"
              ? `${fmtAuec(buyNow * qty || 0)} aUEC stays committed against your declared balance while this ad is up — that's what makes it an offer rather than a wish.`
              : "Nothing is held in escrow. You hand the item over in-game and you both confirm — your settled-sales record is what backs the listing."}
          </span>
        </div>
      </div>
    </div>
  );
}
