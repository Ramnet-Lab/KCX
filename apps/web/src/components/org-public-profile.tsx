"use client";

import type { BazaarListingDto, OrgDto, ServiceContractDto } from "@kcx/db";
import { RSI_ORG_BASE } from "@kcx/shared";
import Link from "next/link";
import { fmtAuec, timeLeft } from "@/lib/countdown";

export type OrgPublicData = {
  org: OrgDto;
  standing: { completed: number; undertaken: number; completionPct: number | null; volume: number } | null;
  listings: BazaarListingDto[];
  contracts: ServiceContractDto[];
};

/**
 * An org exactly as an outsider sees it.
 *
 * One implementation, two places: the public `/orgs/[sid]` route and the "Public view" tab
 * inside the org's own console. A president checking what counterparties see must be looking
 * at the same component those counterparties get — two renderings of "the public page" would
 * drift, and the whole value of the preview is that it doesn't.
 *
 * Which means the redaction lives in the QUERY, not here: this is handed an OrgDto whose
 * treasury the API already zeroed for non-members, and it simply never draws one.
 */
export function OrgPublicProfile({
  data,
  contactSlot,
  showBackLink = true,
}: {
  data: OrgPublicData;
  /** The "contact as ⟨SID⟩" control, which only makes sense on the public route. */
  contactSlot?: React.ReactNode;
  showBackLink?: boolean;
}) {
  const { org, standing, listings, contracts } = data;

  return (
    <div>
      {showBackLink && (
        <Link href="/orgs/directory" className="mb-3 inline-block text-xs text-ink-faint hover:text-accent">
          ← All orgs
        </Link>
      )}

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
            {/*
              Straight through to RSI.

              Our roster only ever shows the members who also use KCX, and our record only
              covers trades settled here — so for anyone sizing up a counterparty, the org's
              own page is the fuller and more authoritative source. Recruitment, real member
              count and official contact channels all live there, and none of it is ours to
              restate.
            */}
            <a
              href={`${RSI_ORG_BASE}/${encodeURIComponent(org.sid)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-block text-xs text-ink-faint hover:text-accent"
            >
              Official RSI org page ↗
            </a>
          </div>
          {contactSlot}
        </div>

        {org.description && <p className="mt-3 text-xs text-ink-dim">{org.description}</p>}

        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-faint">Settled</dt>
            <dd className="num text-ink">
              {standing ? `${standing.completed}/${standing.undertaken}` : "—"}
              {standing?.completionPct != null && (
                <span className="text-ink-faint"> · {standing.completionPct}%</span>
              )}
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
            own name. Anything below was posted by members personally.
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
