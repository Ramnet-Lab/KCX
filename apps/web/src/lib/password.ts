import { type ScryptOptions, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/** promisify() drops the options overload, so wrap it by hand to keep the cost parameters. */
function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

/**
 * Password hashing.
 *
 * scrypt from node:crypto rather than argon2 or bcrypt: both of those are native modules that
 * need compiling per platform, and this project builds in Alpine containers where a native
 * rebuild is exactly the kind of thing that breaks a deploy at 2am. scrypt is memory-hard,
 * ships with Node, and at these parameters is a perfectly respectable choice.
 *
 * Stored as `scrypt$N$r$p$salt$hash`, so the cost parameters travel with the hash and can be
 * raised later without invalidating everyone's password.
 */

const N = 16384; // 2^14 — ~16 MB per hash, under Node's 32 MB default maxmem
const R = 8;
const P = 1;
const KEYLEN = 64;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Constant-time verify. Returns false on any malformed stored value rather than throwing. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64");
    expected = Buffer.from(parts[5]!, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  try {
    const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      // A stored hash with inflated parameters must not become a memory-exhaustion lever.
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/**
 * Length over composition rules — mandatory symbols push people toward `Passw0rd!`. The only
 * content rule is that the password can't be the handle, which is public on the site.
 */
export function checkPasswordStrength(password: string, handle: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: `Keep it under ${MAX_PASSWORD_LENGTH} characters.` };
  }
  const lower = password.toLowerCase();
  if (handle && lower.includes(handle.toLowerCase())) {
    return { ok: false, message: "Don't put your handle in your password — it's public here." };
  }
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, message: "That's one character repeated. Try something else." };
  }
  return { ok: true };
}
