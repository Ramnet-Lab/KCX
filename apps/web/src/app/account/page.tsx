import { getDb, listInbox, passkeys, type InboxMessageDto } from "@kcx/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountActions } from "@/components/account-actions";
import { AccountPasskeys } from "@/components/account-passkeys";
import { AccountPassword } from "@/components/account-password";
import { InboxPanel } from "@/components/inbox-panel";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account" };

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const db = getDb();
  const devices = await db
    .select({
      id: passkeys.id,
      deviceName: passkeys.deviceName,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id));

  // An empty inbox is not a reason to fail the whole account page.
  let messages: InboxMessageDto[] = [];
  try {
    messages = await listInbox(db, user.id);
  } catch (err) {
    console.error("[account:inbox]", err instanceof Error ? err.message : err);
  }

  // Account age is the cheapest honest anti-alt signal we have.
  const enlistedYears = user.enlistedAt
    ? Math.floor((Date.now() - user.enlistedAt.getTime()) / (365.25 * 86_400_000))
    : null;

  /** Verified means we actually read the code off the RSI profile — not that a flag is set. */
  const proven = user.rsiVerifiedAt != null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-lg font-bold text-ink">Account</h1>
        <AccountActions className="ml-auto" />
      </div>

      {/* First on the page: it is what the badge on your name in the header points at. */}
      <InboxPanel initial={messages} />

      {!proven && (
        <div className="mb-4 rounded border border-accent/50 bg-accent/10 p-4 text-sm">
          <p className="mb-1 font-bold text-accent">This account isn&apos;t linked to a real RSI handle.</p>
          <p className="mb-3 text-ink-dim">
            It was created for local testing, so it has no enlisted date, citizen record, or org —
            and it can&apos;t be used to trade for real. To use your own Star Citizen identity, sign
            out and claim your handle.
          </p>
          <AccountActions variant="cta" />
        </div>
      )}

      <section className="mb-6 rounded border border-line bg-panel p-4">
        <div className="flex items-start gap-3">
          {user.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="h-12 w-12 rounded border border-line" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-ink">{user.displayName}</span>
              {/* The badge must reflect PROOF, not a flag. A dev-stub account has
                  isVerified set with no profile check behind it — showing it as
                  verified would be a lie to the trader looking at the page. */}
              {proven ? (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                  RSI VERIFIED
                </span>
              ) : (
                <span className="rounded bg-ink-faint/15 px-1.5 py-0.5 text-[10px] font-bold text-ink-faint">
                  UNVERIFIED
                </span>
              )}
            </div>
            <div className="text-xs text-ink-faint">@{user.handle}</div>
          </div>
          <Link
            href={`https://robertsspaceindustries.com/citizens/${user.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-ink-faint hover:text-accent"
          >
            RSI profile ↗
          </Link>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-faint">Enlisted</dt>
            <dd className="text-ink">
              {fmtDate(user.enlistedAt)}
              {enlistedYears != null && <span className="text-ink-faint"> · {enlistedYears}y</span>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Citizen record</dt>
            <dd className="num text-ink">{user.citizenRecord ? `#${user.citizenRecord}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Main org</dt>
            <dd className="text-ink">{user.mainOrgSid ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Verified</dt>
            <dd className="text-ink">{fmtDate(user.rsiVerifiedAt)}</dd>
          </div>
        </dl>
      </section>

      <AccountPasskeys initial={devices} />

      <AccountPassword hasPassword={!!user.passwordHash} minLength={MIN_PASSWORD_LENGTH} />

      <section className="mt-6 rounded border border-line bg-panel p-4 text-xs text-ink-dim">
        <h2 className="mb-2 text-sm font-bold text-ink">How your account works</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>Your RSI handle is your identity — one KCX account per handle.</li>
          <li>
            Passkeys and passwords are just keys to the door. Losing them all is recoverable:
            verify your handle again.
          </li>
          <li>A passkey never leaves the device that made it — a password is what gets you in elsewhere.</li>
          <li>We never ask for your RSI password, and we only read your public profile page.</li>
          <li>We store no email address, and any password you set is stored only as a scrypt hash.</li>
        </ul>
      </section>
    </div>
  );
}
