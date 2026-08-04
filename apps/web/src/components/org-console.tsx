"use client";

import type { OrgDto, OrgMemberDto, OrgProposalDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtAuec, timeLeft } from "@/lib/countdown";

const ROLE_BLURB: Record<string, string> = {
  president: "Everything. Appoints treasurers, sets the board, sets the treasury.",
  treasurer: "Spends up to their delegated limit. Nothing else.",
  member: "Counted in the org's record. Spends nothing.",
};

/**
 * The org console.
 *
 * Membership is not editable here and there is no "create org" button, because neither is a
 * thing KCX decides — an org appears when a verified trader's RSI profile names it, and the
 * roster is whoever currently names it. What IS decided here is who speaks for the org, and
 * that starts with proving control of its RSI charter.
 */
export function OrgConsole({
  orgs,
  selectedId,
  members,
  proposals,
  standing,
}: {
  orgs: OrgDto[];
  selectedId: string | null;
  members: OrgMemberDto[];
  proposals: OrgProposalDto[];
  standing: { completed: number; undertaken: number; completionPct: number | null; volume: number } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const router = useRouter();

  const org = orgs.find((o) => o.id === selectedId) ?? orgs[0] ?? null;
  const isPresident = org?.myRole === "president";

  const patch = async (body: Record<string, unknown>) => {
    if (!org) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "That didn't work");
        return null;
      }
      router.refresh();
      return payload as { code?: string };
    } finally {
      setBusy(false);
    }
  };

  if (!org) {
    return (
      <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
        <p className="mb-1 text-ink">No org on your RSI profile.</p>
        <p className="mx-auto max-w-lg">
          Orgs aren&apos;t created on KCX. Set your main org on your RSI profile and verify your
          handle again — the org appears here automatically, along with everyone else who
          names it.
        </p>
      </div>
    );
  }

  return (
    <div>
      {orgs.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1 text-xs">
          {orgs.map((o) => (
            <button
              key={o.id}
              onClick={() => router.push(`/orgs?id=${o.id}`)}
              className={`tap rounded px-3 py-1.5 font-bold ${
                org.id === o.id ? "bg-accent/15 text-accent" : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {o.sid}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      <section className="mb-4 rounded border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          {org.logoFilename && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/uploads/orgs/${org.logoFilename}`}
              alt=""
              className="h-10 w-10 rounded border border-line object-cover"
            />
          )}
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-bold text-ink">{org.name}</h2>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-ink-dim">
                {org.sid}
              </span>
              <StatusBadge status={org.status} />
            </div>
            <div className="text-xs text-ink-faint">
              {org.memberCount} member{org.memberCount === 1 ? "" : "s"} on KCX · you are {org.myRole}
              {org.myRankStars != null && ` (${"★".repeat(org.myRankStars)}${"☆".repeat(5 - org.myRankStars)})`}
            </div>
          </div>
        </div>

        {org.status !== "verified" && (
          <ClaimPanel
            org={org}
            code={code}
            busy={busy}
            onStart={async () => {
              const r = await patch({ action: "claim_start" });
              if (r?.code) setCode(r.code);
            }}
            onCheck={() => patch({ action: "claim_check" })}
          />
        )}

        {org.canTrade && (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-ink-faint">Treasury</dt>
              <dd className="num text-ink">{fmtAuec(org.treasury)} aUEC</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Your limit</dt>
              <dd className="num text-ink">
                {org.mySpendLimit == null ? (org.myRole === "member" ? "—" : "no cap") : `${fmtAuec(org.mySpendLimit)} aUEC`}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Settled</dt>
              <dd className="num text-ink">
                {standing ? `${standing.completed}/${standing.undertaken}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Led by</dt>
              <dd className="text-ink">{org.charterHolderName ?? "—"}</dd>
            </div>
          </dl>
        )}

        {isPresident && <PresidentControls org={org} busy={busy} onPatch={patch} />}
      </section>

      {proposals.length > 0 && <ProposalList proposals={proposals} onChanged={() => router.refresh()} />}

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
          Roster <span className="text-ink-dim">from RSI</span>
        </h2>
        <div className="space-y-1">
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} canManage={isPresident} busy={busy} onPatch={patch} />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Nobody is added or removed here. Membership and rank come from each trader&apos;s RSI
          profile and refresh when they verify their handle.
        </p>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    verified: "bg-up/15 text-up",
    derived: "bg-panel-2 text-ink-faint",
    pending: "bg-accent/15 text-accent",
    suspended: "bg-danger/15 text-danger",
  };
  const label: Record<string, string> = {
    verified: "verified",
    derived: "unverified",
    pending: "claim open",
    suspended: "suspended",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}

/**
 * Proving leadership.
 *
 * The code goes in the org's own RSI Charter, which only an org admin can edit — so this
 * proves control of the ORG, not just membership of it. Until it's done the org is a roster
 * and cannot trade, which is what stops whoever signed up first pointing a treasury at the
 * board.
 */
function ClaimPanel({
  org,
  code,
  busy,
  onStart,
  onCheck,
}: {
  org: OrgDto;
  code: string | null;
  busy: boolean;
  onStart: () => void;
  onCheck: () => void;
}) {
  return (
    <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-3">
      <p className="text-xs text-ink-dim">
        <span className="font-bold text-accent">This org can&apos;t trade yet.</span> Somebody who
        can edit its RSI page has to prove it. Until then this is a roster — no treasury, no
        listings, no contracts in the org&apos;s name.
      </p>

      {!org.amPresumedLeader ? (
        <p className="mt-2 text-[11px] text-ink-faint">
          The highest-ranked member of {org.sid} on KCX makes the claim. If your RSI rank is
          higher than theirs, verify your handle again to refresh it.
        </p>
      ) : code ? (
        <div className="mt-2">
          <p className="text-[11px] text-ink-dim">
            Paste this into your org&apos;s <span className="text-ink">Charter</span>,{" "}
            <span className="text-ink">History</span> or <span className="text-ink">Manifesto</span> on
            RSI, save it, then check.
          </p>
          <code className="mt-1 block rounded border border-line bg-bg px-2 py-1.5 text-sm font-bold text-accent">
            {code}
          </code>
          <button
            onClick={onCheck}
            disabled={busy}
            className="tap mt-2 rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            {busy ? "Checking…" : "I've pasted it — check now"}
          </button>
          <a
            href={`https://robertsspaceindustries.com/orgs/${org.sid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-[11px] text-ink-faint hover:text-accent"
          >
            open the org page ↗
          </a>
        </div>
      ) : (
        <button
          onClick={onStart}
          disabled={busy}
          className="tap mt-2 rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          Claim leadership of {org.sid}
        </button>
      )}
    </div>
  );
}

function PresidentControls({
  org,
  busy,
  onPatch,
}: {
  org: OrgDto;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [treasury, setTreasury] = useState(String(org.treasury));
  const [threshold, setThreshold] = useState(String(org.boardThreshold));
  const [minValue, setMinValue] = useState(String(org.boardMinValue));

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Declared treasury (aUEC)
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={treasury}
            onChange={(e) => setTreasury(e.target.value)}
            className="num mt-1 w-40 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
        <button
          onClick={() => onPatch({ action: "set_treasury", treasury: Math.max(0, Math.round(Number(treasury))) })}
          disabled={busy}
          className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Board approvals needed
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={10}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="num mt-1 w-24 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            …on transactions at or above
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={minValue}
            onChange={(e) => setMinValue(e.target.value)}
            className="num mt-1 w-40 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
          />
        </label>
        <button
          onClick={() =>
            onPatch({
              action: "set_board",
              threshold: Math.max(0, Math.round(Number(threshold))),
              minValue: Math.max(0, Math.round(Number(minValue))),
            })
          }
          disabled={busy}
          className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <p className="text-[11px] text-ink-faint">
        {org.boardThreshold === 0
          ? "No board approval required — treasurers spend within their limits alone."
          : `${org.boardThreshold} other board member${org.boardThreshold === 1 ? "" : "s"} must agree before anything at or over ${fmtAuec(org.boardMinValue)} aUEC goes ahead. You set the rule, but you can't carry a vote on your own — a board the president can bypass constrains nothing.`}{" "}
        {org.boardSize} on the board.
      </p>
    </div>
  );
}

function MemberRow({
  member: m,
  canManage,
  busy,
  onPatch,
}: {
  member: OrgMemberDto;
  canManage: boolean;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(m.spendLimit == null ? "" : String(m.spendLimit));

  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line bg-panel p-2.5 text-xs">
      <span className="min-w-32 flex-1">
        <span className="font-bold text-ink">{m.displayName}</span>
        <span className="ml-2 text-ink-faint">@{m.handle}</span>
        {m.rsiRank && (
          <span className="ml-2 text-[10px] text-ink-faint">
            {m.rsiRank}
            {m.rsiRankStars != null && ` ${"★".repeat(m.rsiRankStars)}`}
          </span>
        )}
      </span>

      <span
        className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim"
        title={ROLE_BLURB[m.role]}
      >
        {m.role}
      </span>
      {m.isBoardMember && (
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
          board
        </span>
      )}
      {!m.authorityFresh && m.role !== "member" && (
        <span
          className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger"
          title="Their RSI membership hasn't been confirmed recently, so they can't spend until they re-verify"
        >
          stale
        </span>
      )}
      {m.role !== "member" && (
        <span className="num text-ink-dim">
          {m.spendLimit == null ? "no cap" : `${fmtAuec(m.committed)} / ${fmtAuec(m.spendLimit)}`}
        </span>
      )}

      {canManage && m.role !== "president" && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="tap rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink"
        >
          {open ? "cancel" : "manage"}
        </button>
      )}

      {open && (
        <div className="flex w-full flex-wrap items-end gap-2 border-t border-line pt-2">
          <button
            onClick={() => onPatch({ action: "set_member", userId: m.userId, role: m.role === "treasurer" ? "member" : "treasurer" })}
            disabled={busy}
            className="tap rounded border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40"
          >
            {m.role === "treasurer" ? "demote to member" : "make treasurer"}
          </button>
          <button
            onClick={() => onPatch({ action: "set_member", userId: m.userId, isBoardMember: !m.isBoardMember })}
            disabled={busy}
            className="tap rounded border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40"
          >
            {m.isBoardMember ? "remove from board" : "add to board"}
          </button>
          <label>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Spend limit (blank = no cap)
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="num mt-1 w-36 rounded border border-line bg-bg px-2 py-1 text-right text-xs text-ink focus:outline-none"
            />
          </label>
          <button
            onClick={() =>
              onPatch({
                action: "set_member",
                userId: m.userId,
                spendLimit: limit.trim() === "" ? null : Math.max(0, Math.round(Number(limit))),
              })
            }
            disabled={busy}
            className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            Save limit
          </button>
          <button
            onClick={() => onPatch({ action: "transfer", userId: m.userId })}
            disabled={busy}
            className="tap rounded border border-line px-2 py-1 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
            title="Hand the presidency to them"
          >
            make president
          </button>
        </div>
      )}
    </article>
  );
}

/** Board proposals: what the org wants to do, and who has agreed to it. */
function ProposalList({ proposals, onChanged }: { proposals: OrgProposalDto[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const open = proposals.filter((p) => p.status === "open");
  const rest = proposals.filter((p) => p.status !== "open").slice(0, 10);

  const vote = async (id: string, action: "approve" | "object" | "withdraw") => {
    setBusy(id);
    try {
      await fetch(`/api/orgs/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
        Board <span className="num text-ink-dim">{open.length} open</span>
      </h2>
      <div className="space-y-1">
        {[...open, ...rest].map((p) => (
          <article
            key={p.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border p-2.5 text-xs ${
              p.status === "open" ? "border-accent/40" : "border-line"
            } bg-panel`}
          >
            <span className="min-w-40 flex-1">
              <span className="text-ink">{p.summary}</span>
              <span className="block text-[11px] text-ink-faint">
                by {p.proposedByName} · {p.approvals}/{p.requiredApprovals} approved
                {p.objections > 0 && ` · ${p.objections} objected`}
                {p.status === "open" ? (
                  <> · <span suppressHydrationWarning>{timeLeft(p.expiresAt)}</span></>
                ) : (
                  ` · ${p.status}`
                )}
                {p.failureReason && ` — ${p.failureReason}`}
              </span>
            </span>
            {p.value > 0 && <span className="num font-bold text-up">{fmtAuec(p.value)} aUEC</span>}

            {p.status === "open" && p.canVote && (
              <span className="flex gap-1.5">
                <button
                  onClick={() => vote(p.id, "approve")}
                  disabled={busy === p.id}
                  className="tap rounded bg-up/20 px-2 py-0.5 text-[11px] font-bold text-up hover:bg-up/30 disabled:opacity-40"
                >
                  approve
                </button>
                <button
                  onClick={() => vote(p.id, "object")}
                  disabled={busy === p.id}
                  className="tap rounded border border-line px-2 py-0.5 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
                >
                  object
                </button>
              </span>
            )}
            {p.status === "open" && p.isMine && (
              <button
                onClick={() => vote(p.id, "withdraw")}
                disabled={busy === p.id}
                className="tap rounded border border-line px-2 py-0.5 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
              >
                withdraw
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
