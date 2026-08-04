import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { SAFE_FILENAME, uploadRoot } from "@/lib/uploads";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Serve an uploaded contract image.
 *
 * Served through a route handler rather than a static mount so the same code path works in
 * dev, in the container, and behind any proxy — and so the headers below are guaranteed
 * rather than dependent on web-server config:
 *
 *  • The filename must match the generated-UUID pattern exactly; anything else is refused
 *    before it can reach the filesystem, so `..` and absolute paths are impossible.
 *  • Content-Type comes from our own extension map, never from the request.
 *  • nosniff plus a restrictive CSP: even if something slipped past the upload sniffing,
 *    the browser will not execute it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!SAFE_FILENAME.test(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = file.split(".").pop()!.toLowerCase();
  const mime = MIME[ext];
  if (!mime) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await readFile(join(uploadRoot(), "contracts", file));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": mime,
        // Filenames are content-addressed by UUID, so a stored image never changes.
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
