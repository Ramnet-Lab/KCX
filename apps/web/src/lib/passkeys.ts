import { getDb, passkeys, webauthnChallenges } from "@kcx/db";
import { and, eq, gt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { headers } from "next/headers";

/**
 * Passkeys (WebAuthn) are the returning-device credential. RSI bio verification proves who
 * you are once; the passkey lets you back in without repeating it — and if every passkey is
 * lost, re-verifying against RSI restores access, so there is no password and no reset email.
 */

const CHALLENGE_TTL_MS = 5 * 60_000;

export const RP_NAME = "Kestrel Commodities Exchange";

/**
 * Relying-party ID must be the site's registered domain (no scheme or port). Derived from the
 * request so local development and production both work without separate configuration.
 */
export async function rpConfig(): Promise<{ rpID: string; origin: string }> {
  const configured = process.env.WEBAUTHN_RP_ID;
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { rpID: configured ?? host.split(":")[0]!, origin: `${proto}://${host}` };
}

async function storeChallenge(challenge: string, purpose: "register" | "login", userId?: string | null) {
  await getDb().insert(webauthnChallenges).values({
    challenge,
    purpose,
    userId: userId ?? null,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/** Challenges are single-use: consumed here, so a replayed response fails. */
async function consumeChallenge(challenge: string, purpose: "register" | "login"): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        eq(webauthnChallenges.purpose, purpose),
        gt(webauthnChallenges.expiresAt, new Date()),
      ),
    )
    .returning({ id: webauthnChallenges.id });
  return deleted.length > 0;
}

export async function registrationOptions(opts: { userId: string; handle: string }) {
  const { rpID } = await rpConfig();
  const existing = await getDb()
    .select({ id: passkeys.id, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, opts.userId));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: opts.handle,
    userDisplayName: opts.handle,
    attestationType: "none",
    // Don't let the same authenticator enrol twice.
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: (c.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  await storeChallenge(options.challenge, "register", opts.userId);
  return options;
}

export async function verifyRegistration(opts: {
  userId: string;
  response: Parameters<typeof verifyRegistrationResponse>[0]["response"];
  deviceName?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { rpID, origin } = await rpConfig();
  const challenge = opts.response.response.clientDataJSON
    ? JSON.parse(Buffer.from(opts.response.response.clientDataJSON, "base64url").toString()).challenge
    : null;
  if (!challenge || !(await consumeChallenge(challenge, "register"))) {
    return { ok: false, message: "That registration attempt expired — try again." };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: opts.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Registration failed." };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, message: "Passkey could not be verified." };
  }

  const { credential } = verification.registrationInfo;
  await getDb()
    .insert(passkeys)
    .values({
      id: credential.id,
      userId: opts.userId,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? null,
      deviceName: opts.deviceName?.slice(0, 60) ?? null,
    })
    .onConflictDoNothing();
  return { ok: true };
}

export async function authenticationOptions() {
  const { rpID } = await rpConfig();
  // No allowCredentials: discoverable passkeys let a trader sign in without typing a handle.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await storeChallenge(options.challenge, "login");
  return options;
}

export async function verifyAuthentication(
  response: Parameters<typeof verifyAuthenticationResponse>[0]["response"],
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const { rpID, origin } = await rpConfig();
  const challenge = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString(),
  ).challenge as string | undefined;
  if (!challenge || !(await consumeChallenge(challenge, "login"))) {
    return { ok: false, message: "That sign-in attempt expired — try again." };
  }

  const db = getDb();
  const [credential] = await db.select().from(passkeys).where(eq(passkeys.id, response.id));
  if (!credential) return { ok: false, message: "Unknown passkey — verify your RSI handle to enrol this device." };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
        counter: credential.counter,
        transports: (credential.transports ?? undefined) as AuthenticatorTransport[] | undefined,
      },
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Sign-in failed." };
  }
  if (!verification.verified) return { ok: false, message: "Passkey rejected." };

  // A counter that fails to advance can indicate a cloned authenticator; record and continue,
  // since many platform authenticators legitimately report 0 forever.
  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, credential.id));

  return { ok: true, userId: credential.userId };
}
