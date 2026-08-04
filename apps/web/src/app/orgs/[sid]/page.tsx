import {
  getDb,
  getOrgBySid,
  listBazaarListings,
  listContractsBoard,
  orgStanding,
  type BazaarListingDto,
  type ServiceContractDto,
} from "@kcx/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrgContactButton } from "@/components/org-contact";
import { fmtAuec, timeLeft } from "@/lib/countdown";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sid: string }> }): Promise<Metadata> {
  const { sid } = await params;
  try {
    const org = await getOrgBySid(getDb(), sid);
    if (!org) return { title: "Org" };
    return {
      title: `${org.name} (${org.sid})`,
      description: `${org.name} on KCX — settled trades, live listings and contracts for this Star Citizen org.`,
    };
  } catch {
    return { title: "Org" };
  }
}

/**
 * An org's public page.
 *
 * Carries what a counterparty needs before dealing with them and nothing else: whether the
 * org proved its leadership, what it has settled, and what it currently has on the board.
 * The treasury and the roster stay members-only — how much an org has and who may spend it
 * are its own business, and the point of this page is trust, not disclosure.
 */
export default async function OrgPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const user = await currentUser();

  const db = getDb();
  const org = await getOrgBySid(db, sid, user?.id ?? null).catch(() => null);
  if (!org) notFound();

  let listings: BazaarListingDto[] = [];
  let contracts: ServiceContractDto[] = [];
  let standing: Awaited<ReturnType<typeof orgStanding>> | null = null;
  try {
    [standing, listings, contracts] = await Promise.all([
      orgStanding(db, org.id),
      listBazaarListings(db, { viewerId: user?.id ?? null, limit: 24 }).then((all) =>
        all.filter((l) => l.orgId === org.id),
      ),
      listContractsBoard(db, { viewerId: user?.id ?? null }).then((all) =>
        all.filter((c) => c.orgId === org.id),
      ),
    ]);
  } catch (err) {
    console.error("[org page]", err instanceof Error ? err.message : err);
  }

  return (
    <div>
      <Link href="/orgs/directory" className="mb-3 inline-block text-xs text-ink-faint hover:text-accent">
        ← All orgs
      </Link>

      <header className="rounded border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          {org.logoFilename ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/uploads/orgs/${org.logoFilename}`}
              alt=""
              className="h-14 w-14 rounded border border-line object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded border border-line bg-panel-2 text-[10px] text-ink-faint">
              no logo
            </span>
          )}
          <div className="min-w-48 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-lg font-bold text-ink">{org.name}</h1>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-ink-dim">
                {org.sid}
              </span>
              {org.status === "verified" ? (
                <span
                  className="rounded bg-up/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-up"
                  title="Someone proved control of this org's RSI charter"
                >
                  verified
                </span>
              ) : (
                <span
                  className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint"
                  title="Nobody has proved they lead this org, so it can't trade in its own name"
                >
                  unverified
                </span>
              )}
            </div>
            <p className="text-xs text-ink-faint">
              {org.memberCount} member{org.memberCount === 1 ? "" : "s"} on KCX
              {org.charterHolderName && ` · led by ${org.charterHolderName}`}
            </p>
          </div>
          <OrgContactButton targetOrgId={org.id} targetSid={org.sid} verified={org.status === "verified"} />
        </div>

        {org.description && <p className="mt-3 text-xs text-ink-dim">{org.description}</p>}

        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-faint">Settled</dt>
            <dd className="num text-ink">
              {standing ? `${standing.completed}/${standing.undertaken}` : "—"}
              {standing?.completionPct != null && <span className="text-ink-faint"> · {standing.completionPct}%</span>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Volume</dt>
            <dd className="num text-ink">{fmtAuec(standing?.volume ?? 0)} aUEC</dd>
          </div>
          <div>
            <dt className="text-ink-faint">On the board</dt>
            <dd className="num text-ink">{listings.length}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Contracts</dt>
            <dd className="num text-ink">{contracts.length}</dd>
          </div>
        </dl>

        {org.status !== "verified" && (
          <p className="mt-3 rounded border border-dashed border-line px-3 py-2 text-[11px] text-ink-faint">
            Nobody has proved they lead {org.sid}, so it can&apos;t hold a treasury or trade in its
            own name. Anything below was posted by members personally. If you can edit this
            org&apos;s RSI charter, you can claim it from your own org page.
          </p>
        )}
      </header>

      {listings.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">On the bazaar</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {listings.map((l) => (
              <Link
                key={l.id}
                href={`/bazaar/${l.id}`}
                className="flex items-center gap-3 rounded border border-line bg-panel p-2.5 hover:border-ink-faint"
              >
                {l.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/bazaar/${l.images[0]}`}
                    alt=""
                    className="h-12 w-12 rounded border border-line object-cover"
                  />
                ) : (
                  <span className="h-12 w-12 rounded border border-line bg-panel-2" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{l.title}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {l.intent === "buy" ? "wanted" : "for sale"} ·{" "}
                    <span suppressHydrationWarning>{timeLeft(l.expiresAt)}</span>
                  </span>
                </span>
                <span className="num text-sm font-bold text-up">
                  {fmtAuec(l.currentBid ?? l.buyNowPrice ?? l.startPrice ?? 0)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {contracts.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">Contracts issued</h2>
          <div className="space-y-2">
            {contracts.map((c) => (
              <Link
                key={c.id}
                href="/contracts"
                className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel p-2.5 hover:border-ink-faint"
              >
                <span className="min-w-40 flex-1 text-sm font-bold text-ink">{c.title}</span>
                <span className="text-[11px] text-ink-faint">{c.category}</span>
                <span className="num text-sm font-bold text-up">{fmtAuec(c.payout)} aUEC</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {listings.length === 0 && contracts.length === 0 && (
        <p className="mt-4 rounded border border-dashed border-line p-8 text-center text-sm text-ink-faint">
          Nothing on the board from {org.sid} right now.
        </p>
      )}
    </div>
  );
}
