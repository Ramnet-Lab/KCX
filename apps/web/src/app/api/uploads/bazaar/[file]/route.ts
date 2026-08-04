import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bazaarListingImages, getDb } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { SAFE_FILENAME, UPLOAD_MIME, uploadRoot } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Serve a bazaar listing photo.
 *
 * Bazaar listings are public by design — a marketplace nobody can browse sells nothing — so
 * unlike the contract equivalent there is no per-viewer authorisation here. The rest of the
 * hardening is identical and not optional:
 *
 *  • The filename must match the generated-UUID pattern exactly; anything else is refused
 *    before it can reach the filesystem, so `..` and absolute paths are impossible.
 *  • Content-Type comes from our own extension map, never from the request.
 *  • nosniff plus a restrictive CSP: even if something slipped past the upload sniffing,
 *    the browser will not execute it.
 *  • A file with no listing row behind it is a 404, so a deleted photo stops being served
 *    even though the bytes may still be on disk.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!SAFE_FILENAME.test(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ext = file.split(".").pop()!.toLowerCase();
  const mime = UPLOAD_MIME[ext];
  if (!mime) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const [row] = await getDb()
      .select({ id: bazaarListingImages.id })
      .from(bazaarListingImages)
      .where(eq(bazaarListingImages.filename, file));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("[uploads:bazaar]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  try {
    const bytes = await readFile(join(uploadRoot(), "bazaar", file));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": mime,
        // Filenames are generated per upload, so a stored photo never changes under its URL.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
        "content-disposition": `inline; filename="${file}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
