import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canSeeContractDetails, getDb, serviceContracts } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { SAFE_FILENAME, UPLOAD_MIME, uploadRoot } from "@/lib/uploads";

export const dynamic = "force-dynamic";

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
 *  • A classified contract's image is authorised per request. The UUID filename is NOT
 *    treated as the secret — URLs leak through history, referrers and screenshots, and
 *    "unguessable" is not an access control.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!SAFE_FILENAME.test(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = file.split(".").pop()!.toLowerCase();
  const mime = UPLOAD_MIME[ext];
  if (!mime) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let classified = false;
  try {
    const [contract] = await getDb()
      .select({
        visibility: serviceContracts.visibility,
        issuerId: serviceContracts.issuerId,
        executorId: serviceContracts.executorId,
      })
      .from(serviceContracts)
      .where(eq(serviceContracts.imageFilename, file));
    // An image with no contract behind it is an orphan from a deleted attachment.
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 });

    classified = contract.visibility === "classified";
    if (classified) {
      const user = await currentUser();
      if (!canSeeContractDetails(contract, user?.id ?? null, user?.role ?? null)) {
        // 404 rather than 403: whether a classified image exists is itself a detail.
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
  } catch (err) {
    console.error("[uploads:authz]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  try {
    const bytes = await readFile(join(uploadRoot(), "contracts", file));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": mime,
        // Filenames are content-addressed by UUID, so a stored image never changes. A
        // classified image must never land in a shared cache, though — it is authorised
        // per viewer, and `private` keeps proxies and CDNs out of that decision.
        "cache-control": classified
          ? "private, no-store"
          : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
        "content-disposition": `inline; filename="${file}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
