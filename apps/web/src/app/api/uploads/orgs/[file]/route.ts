import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb, orgs } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { SAFE_FILENAME, UPLOAD_MIME, uploadRoot } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Serve a cached org logo.
 *
 * Cached rather than hotlinked from RSI: hotlinking would put their bandwidth behind every
 * board render and break the moment they set a referrer policy. The bytes went through the
 * ordinary upload pipeline on verification, so they were magic-byte sniffed and given a
 * generated filename like any other image here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!SAFE_FILENAME.test(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ext = file.split(".").pop()!.toLowerCase();
  const mime = UPLOAD_MIME[ext];
  if (!mime) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const [row] = await getDb().select({ id: orgs.id }).from(orgs).where(eq(orgs.logoFilename, file));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("[uploads:orgs]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  try {
    const bytes = await readFile(join(uploadRoot(), "orgs", file));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": mime,
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
