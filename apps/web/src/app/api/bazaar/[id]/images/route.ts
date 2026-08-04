import { MAX_LISTING_IMAGES, bazaarEvents, bazaarListingImages, bazaarListings, getDb } from "@kcx/db";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { MAX_UPLOAD_BYTES, SAFE_FILENAME, removeUploadedImage, storeUploadedImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/bazaar/:id/images — add a photo.
 *
 * Only the seller, and only while the listing is still live: photos are the substance of
 * what a buyer is agreeing to, and swapping them after someone has bid would change the
 * deal without changing the price.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const db = getDb();
  const [listing] = await db.select().from(bazaarListings).where(eq(bazaarListings.id, id));
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (listing.sellerId !== user.id) {
    return NextResponse.json({ error: "Only the seller can add photos" }, { status: 403 });
  }
  if (!["active", "paused"].includes(listing.status)) {
    return NextResponse.json({ error: "This listing is closed" }, { status: 409 });
  }

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bazaarListingImages)
    .where(eq(bazaarListingImages.listingId, id));
  if (count >= MAX_LISTING_IMAGES) {
    return NextResponse.json({ error: `Up to ${MAX_LISTING_IMAGES} photos per listing` }, { status: 409 });
  }

  let buf: Buffer;
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return NextResponse.json({ error: "No image supplied" }, { status: 400 });
    // Check the declared size before reading, so an oversized body isn't buffered in full.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Image must be 5 MB or smaller" }, { status: 413 });
    }
    buf = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read the upload" }, { status: 400 });
  }

  const stored = await storeUploadedImage(buf, "bazaar");
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 415 });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(bazaarListingImages).values({
        listingId: id,
        filename: stored.image.filename,
        sortIndex: count,
      });
      await tx.insert(bazaarEvents).values({
        listingId: id,
        actorId: user.id,
        type: "image_added",
        data: { filename: stored.image.filename, bytes: stored.image.bytes },
      });
    });
    return NextResponse.json({ filename: stored.image.filename }, { status: 201 });
  } catch (err) {
    // Don't leave a file on disk that no listing points at.
    await removeUploadedImage("bazaar", stored.image.filename);
    console.error("[bazaar:image]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not attach the photo" }, { status: 500 });
  }
}

/** DELETE — seller (or a moderator) removes one photo, named in the query string. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const filename = new URL(request.url).searchParams.get("filename") ?? "";
  if (!SAFE_FILENAME.test(filename)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getDb();
  const [listing] = await db.select().from(bazaarListings).where(eq(bazaarListings.id, id));
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const isMod = user.role === "mod" || user.role === "admin";
  if (listing.sellerId !== user.id && !isMod) {
    return NextResponse.json({ error: "Not yours to remove" }, { status: 403 });
  }

  const removed = await db
    .delete(bazaarListingImages)
    .where(and(eq(bazaarListingImages.listingId, id), eq(bazaarListingImages.filename, filename)))
    .returning({ id: bazaarListingImages.id });
  if (removed.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.insert(bazaarEvents).values({
    listingId: id,
    actorId: user.id,
    type: "image_removed",
    data: { filename },
  });
  await removeUploadedImage("bazaar", filename);
  return NextResponse.json({ ok: true });
}
