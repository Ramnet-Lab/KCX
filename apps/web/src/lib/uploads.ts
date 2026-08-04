import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Contract image handling.
 *
 * Users upload screenshots — an assassination target, a wreck to salvage, cargo waiting on
 * a pad. That makes this an untrusted-content surface, so the rules here are deliberate:
 *
 *  • Format is decided by MAGIC BYTES, never the filename or the browser's Content-Type,
 *    both of which the client controls.
 *  • SVG is refused outright. It is a document format that can carry script, and serving
 *    one from our own origin would be stored XSS.
 *  • Filenames are generated, so nothing user-supplied ever reaches the filesystem path.
 *  • JPEG metadata is stripped: a screenshot is usually clean, but a phone photo of a
 *    monitor carries GPS, and nobody expects posting a contract to publish their address.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    mime: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  { ext: "gif", mime: "image/gif", test: (b) => b.subarray(0, 6).toString("ascii").startsWith("GIF8") },
];

export type SniffResult = { ext: string; mime: string } | null;

export function sniffImage(buf: Buffer): SniffResult {
  if (buf.length < 16) return null;
  const hit = SIGNATURES.find((s) => s.test(buf));
  return hit ? { ext: hit.ext, mime: hit.mime } : null;
}

/**
 * Drop APPn metadata segments from a JPEG (EXIF, GPS, XMP, thumbnails), keeping JFIF.
 *
 * Done by hand rather than pulling in a native image library: this needs no rebuild per
 * platform, and re-encoding would degrade a screenshot for no benefit.
 *
 * Returns null when the segment structure can't be walked safely. That case is REFUSED
 * upstream rather than stored as-is. Returning the original would mean the one file we
 * failed to understand is the one whose GPS tags we publish — and browsers render plenty
 * of JPEGs that a strict walk rejects, so "unparseable" is not the same as "harmless".
 */
export function stripJpegMetadata(buf: Buffer): Buffer | null {
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;

  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) return null; // not where a marker should be
    // A marker may be preceded by any number of 0xFF fill bytes (JPEG spec B.1.1.2).
    let m = i + 1;
    while (m < buf.length && buf[m] === 0xff) m += 1;
    if (m >= buf.length) return null;
    const marker = buf[m]!;
    const segStart = m - 1; // the 0xFF immediately before the marker byte

    // Start of scan: the entropy-coded image data runs to the end.
    if (marker === 0xda) {
      out.push(buf.subarray(segStart));
      break;
    }
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      out.push(buf.subarray(segStart, segStart + 2));
      i = segStart + 2;
      continue;
    }

    if (segStart + 4 > buf.length) return null;
    const length = buf.readUInt16BE(segStart + 2);
    if (length < 2 || segStart + 2 + length > buf.length) return null;

    // APP1..APPF is metadata; APP0 is JFIF and worth keeping.
    const isMetadata = marker >= 0xe1 && marker <= 0xef;
    if (!isMetadata) out.push(buf.subarray(segStart, segStart + 2 + length));
    i = segStart + 2 + length;
  }

  return Buffer.concat(out);
}

/**
 * Where uploads live. A container mounts a volume here so images survive redeploys.
 *
 * The turbopackIgnore is deliberate: this path is dynamic by design (UPLOAD_DIR points at a
 * mounted volume), and without it the build traces the entire project into the standalone
 * output — every source file and the public folder shipped inside the server bundle.
 */
export function uploadRoot(): string {
  return resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads"));
}

export type StoredImage = { filename: string; mime: string; bytes: number };

export async function storeContractImage(buf: Buffer): Promise<{ ok: true; image: StoredImage } | { ok: false; error: string }> {
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `Image is ${(buf.length / 1048576).toFixed(1)} MB; the limit is 5 MB.` };
  }
  const sniffed = sniffImage(buf);
  if (!sniffed) {
    return { ok: false, error: "That file isn't a JPEG, PNG, WebP or GIF image." };
  }

  let cleaned = buf;
  if (sniffed.ext === "jpg") {
    const stripped = stripJpegMetadata(buf);
    // Refuse rather than publish a file whose metadata we couldn't remove.
    if (!stripped) return { ok: false, error: "That JPEG is malformed and can't be processed. Re-save it and try again." };
    cleaned = stripped;
  }

  const filename = `${randomUUID()}.${sniffed.ext}`;
  const dir = join(uploadRoot(), "contracts");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), cleaned);

  return { ok: true, image: { filename, mime: sniffed.mime, bytes: cleaned.length } };
}

/** Guard against traversal: only ever a bare generated filename. */
export const SAFE_FILENAME = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i;
