import { getDb, isBanned, passkeys, users } from "@kcx/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration } from "@/lib/passkeys";
import { createSession, currentUser, logAuthEvent } from "@/lib/session";

export const dynamic = "force-dynamic";

const body = z.object({
  action: z.enum(["register-options", "register-verify", "login-options", "login-verify"]),
  response: z.any().optional(),
  deviceName: z.string().max(60).optional(),
});

/** Passkey enrolment (requires a session) and passkey sign-in (creates one). */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, response, deviceName } = parsed.data;

  if (action === "login-options") {
    return NextResponse.json(await authenticationOptions());
  }

  if (action === "login-verify") {
    const result = await verifyAuthentication(response);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 401 });
    const [user] = await getDb().select().from(users).where(eq(users.id, result.userId));
    if (!user || isBanned(user)) return NextResponse.json({ error: "Account unavailable." }, { status: 403 });
    await createSession(user.id);
    await logAuthEvent("login", { userId: user.id, handle: user.handle, detail: "passkey" });
    return NextResponse.json({ ok: true, user: { id: user.id, handle: user.handle, displayName: user.displayName } });
  }

  // Enrolment requires an established session — you must already have proven the RSI handle.
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Verify your RSI handle first." }, { status: 401 });

  if (action === "register-options") {
    return NextResponse.json(await registrationOptions({ userId: user.id, handle: user.handle }));
  }

  const result = await verifyRegistration({ userId: user.id, response, deviceName });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  await logAuthEvent("passkey_registered", { userId: user.id, handle: user.handle });
  return NextResponse.json({ ok: true });
}

/** List / revoke the trader's enrolled devices. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ passkeys: [] });
  const rows = await getDb()
    .select({
      id: passkeys.id,
      deviceName: passkeys.deviceName,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id));
  return NextResponse.json({ passkeys: rows });
}
