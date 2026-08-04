import { contractEvents, getDb, serviceContracts } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { MAX_UPLOAD_BYTES, removeUploadedImage, storeUploadedImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const removeFile = (filename: string | null) => removeUploadedImage("contracts", filename);

/**
 * POST /api/service-contracts/:id/image — attach a screenshot.
 *
 * Only the issuer, and only while the contract is still live: letting anyone attach images
 * to someone else's contract would be an obvious abuse vector, and rewriting the brief
 * after a job is under way changes the deal the executor agreed to.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const db = getDb();
  const [contract] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, id));
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (contract.issuerId !== user.id) {
    return NextResponse.json({ error: "Only the issuer can attach an image" }, { status: 403 });
  }
  if (!["open", "bidding", "awarded", "in_progress"].includes(contract.status)) {
    return NextResponse.json({ error: "This contract is closed" }, { status: 409 });
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

  const stored = await storeUploadedImage(buf, "contracts");
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 415 });

  try {
    const previous = contract.imageFilename;
    await db
      .update(serviceContracts)
      .set({ imageFilename: stored.image.filename, updatedAt: new Date() })
      .where(eq(serviceContracts.id, id));
    await db.insert(contractEvents).values({
      contractId: id,
      actorId: user.id,
      type: "created",
      data: { image: stored.image.filename, bytes: stored.image.bytes },
    });
    // Replacing an image shouldn't leave the old one orphaned on disk forever.
    await removeFile(previous);
    return NextResponse.json({ filename: stored.image.filename }, { status: 201 });
  } catch (err) {
    await removeFile(stored.image.filename);
    console.error("[contracts:image]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not attach the image" }, { status: 500 });
  }
}

/** DELETE — issuer (or a moderator) removes the attached image. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const db = getDb();
  const [contract] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, id));
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const isMod = user.role === "mod" || user.role === "admin";
  if (contract.issuerId !== user.id && !isMod) {
    return NextResponse.json({ error: "Not yours to remove" }, { status: 403 });
  }

  await db
    .update(serviceContracts)
    .set({ imageFilename: null, updatedAt: new Date() })
    .where(eq(serviceContracts.id, id));
  await removeFile(contract.imageFilename);
  return NextResponse.json({ ok: true });
}
