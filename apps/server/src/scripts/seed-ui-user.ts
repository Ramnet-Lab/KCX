import { loadRootEnv } from "../env";
loadRootEnv();

import { getDb, users } from "@kcx/db";
import { eq } from "drizzle-orm";
import { scrypt as scryptCb, randomBytes } from "node:crypto";

// EXACTLY as apps/web/src/lib/password.ts does it: salt is a Buffer (not a string), the
// encoding is base64 (not base64url), and the password is NFKC-normalised first.
function hash(pw: string): Promise<string> {
  return new Promise((res, rej) => {
    const salt = randomBytes(16);
    scryptCb(pw.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }, (e, dk) =>
      e ? rej(e) : res(`scrypt$16384$8$1$${salt.toString("base64")}$${dk.toString("base64")}`));
  });
}

const db = getDb();
const handle = "uitest_admin";
const h = await hash("correct-horse-battery-staple-42");
const [existing] = await db.select().from(users).where(eq(users.handle, handle));
if (existing) {
  await db.update(users).set({ passwordHash: h, role: "admin", rsiVerifiedAt: new Date(), isVerified: true }).where(eq(users.id, existing.id));
} else {
  await db.insert(users).values({ handle, displayName: "UI Test Admin", passwordHash: h, role: "admin", rsiVerifiedAt: new Date(), isVerified: true, auecBalance: 500_000_000 });
}
const [u] = await db.select().from(users).where(eq(users.handle, handle));
console.log(JSON.stringify({ handle: u!.handle, role: u!.role, hashPrefix: u!.passwordHash!.slice(0, 20) }));
process.exit(0);
