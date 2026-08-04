"use client";

import type { OrgDto, OrgMemberDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtAuec } from "@/lib/countdown";

const ROLE_BLURB: Record<string, string> = {
  owner: "Everything, including appointing other owners.",
  officer: "Spend the treasury and manage members, but can't touch an owner.",
  trader: "Spend up to their delegated limit. Nothing else.",
  member: "Counted in the org's record, spends nothing.",
};

/**
 * An org's console: treasury, roster, and delegated limits.
 *
 * The treasury is self-declared aUEC on exactly the same footing as a personal balance —
 * KCX never holds it. What the exchange enforces is that the org's promises don't exceed
 * it, and that no one member exceeds the slice they were given.
 */
export function OrgConsole({
  orgs: initial,
  selectedId,
  members,
  standing,
}: {
  orgs: OrgDto[];
  selectedId: string | null;
  members: OrgMemberDto[];
  standing: { completed: number; undertaken: number; completionPct: number | null; volume: number } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState(false);
  const router = useRouter();

  const org = initial.find((o) => o.id === selectedId) ?? initial[0] ?? null;
  const canManage = org?.myRole === "owner" || org?.myRole === "officer";

  const patch = async (body: unknown) => {
    if (!org) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) setError(payload.error ?? "That didn't work");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {initial.map((o) => (
          <button
            key={o.id}
            onClick={() => router.push(`/orgs?id=${o.id}`)}
            className={`tap rounded px-3 py-1.5 font-bold ${
              org?.id === o.id ? "bg-accent/15 text-accent" : "text-ink-faint hover:text-ink-dim"
            }`}
          >
            {o.sid}
          </button>
        ))}
        <button
          onClick={() => setFounding((v) => !v)}
          className="tap ml-auto rounded border border-accent/60 px-3 py-1.5 font-bold text-accent hover:bg-accent/10"
        >
          {founding ? "Close" : "+ Found an org"}
        </button>
      </div>

      {founding && <FoundOrg onDone={() => { setFounding(false); router.refresh(); }} />}

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {!org ? (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">You&apos;re not in an org on KCX yet.</p>
          <p>
            Found the one your RSI profile already lists as your main org, or ask an officer of
            an existing one to add you.
          </p>
        </div>
      ) : (
        <>
          <section className="mb-4 rounded border border-line bg-panel p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-base font-bold text-ink">{org.name}</h2>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-ink-dim">
                {org.sid}
              </span>
              <span className="text-xs text-ink-faint">
                {org.memberCount} member{org.memberCount === 1 ? "" : "s"} · you are {org.myRole}
              </span>
            </div>
            {org.description && <p className="mt-1 text-xs text-ink-dim">{org.description}</p>}

            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-ink-faint">Treasury</dt>
                <dd className="num text-ink">{fmtAuec(org.treasury)} aUEC</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Your limit</dt>
                <dd className="num text-ink">
                  {org.mySpendLimit == null ? "no cap" : `${fmtAuec(org.mySpendLimit)} aUEC`}
                </dd>
              </div>
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
            </dl>

            {canManage && <TreasuryForm current={org.treasury} busy={busy} onSave={(t) => patch({ action: "set_treasury", treasury: t })} />}

            <p className="mt-3 text-[11px] text-ink-faint">
              The treasury is a number your org declares, exactly like a personal balance. KCX
              never holds aUEC — what it enforces is that the org can&apos;t promise more than it
              says it has, and that nobody exceeds their delegated slice.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">Members</h2>
            <div className="space-y-1">
              {members.map((m) => (
                <MemberRow key={m.userId} member={m} canManage={canManage} busy={busy} onPatch={patch} />
              ))}
            </div>
            {canManage && <AddMember busy={busy} onAdd={(body) => patch(body)} />}
            <button
              onClick={() => patch({ action: "leave" })}
              disabled={busy}
              className="tap mt-3 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
            >
              Leave {org.sid}
            </button>
          </section>
        </>
      )}
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
  onPatch: (body: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(m.role);
  const [limit, setLimit] = useState(m.spendLimit == null ? "" : String(m.spendLimit));

  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line bg-panel p-2.5 text-xs">
      <span className="min-w-32 flex-1">
        <span className="font-bold text-ink">{m.displayName}</span>
        <span className="ml-2 text-ink-faint">@{m.handle}</span>
      </span>
      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim" title={ROLE_BLURB[m.role]}>
        {m.role}
      </span>
      <span className="num text-ink-dim">
        {m.spendLimit == null ? "no cap" : `${fmtAuec(m.committed)} / ${fmtAuec(m.spendLimit)}`}
      </span>

      {canManage && (
        <>
          <button onClick={() => setEditing((v) => !v)} className="tap rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink">
            {editing ? "cancel" : "edit"}
          </button>
          <button
            onClick={() => onPatch({ action: "remove_member", userId: m.userId })}
            disabled={busy}
            className="tap rounded border border-line px-2 py-0.5 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
          >
            remove
          </button>
        </>
      )}

      {editing && (
        <div className="flex w-full flex-wrap items-end gap-2 border-t border-line pt-2">
          <label>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 rounded border border-line bg-bg px-2 py-1 text-xs text-ink focus:outline-none"
            >
              {["owner", "officer", "trader", "member"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
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
            onClick={() => {
              onPatch({
                action: "set_member",
                handle: m.handle,
                role,
                spendLimit: limit.trim() === "" ? null : Math.max(0, Math.round(Number(limit))),
              });
              setEditing(false);
            }}
            disabled={busy}
            className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            Save
          </button>
          <span className="text-[11px] text-ink-faint">{ROLE_BLURB[role]}</span>
        </div>
      )}
    </article>
  );
}

function AddMember({ busy, onAdd }: { busy: boolean; onAdd: (body: unknown) => void }) {
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState("member");
  const [limit, setLimit] = useState("");

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded border border-line bg-panel-2 p-2">
      <label>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">RSI handle</span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="theirhandle"
          className="mt-1 w-40 rounded border border-line bg-bg px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </label>
      <label>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mt-1 rounded border border-line bg-bg px-2 py-1 text-xs text-ink focus:outline-none"
        >
          {["member", "trader", "officer", "owner"].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Limit</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="no cap"
          className="num mt-1 w-32 rounded border border-line bg-bg px-2 py-1 text-right text-xs text-ink focus:outline-none"
        />
      </label>
      <button
        onClick={() =>
          onAdd({
            action: "set_member",
            handle: handle.trim(),
            role,
            spendLimit: limit.trim() === "" ? null : Math.max(0, Math.round(Number(limit))),
          })
        }
        disabled={busy || handle.trim().length < 2}
        className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        Add
      </button>
    </div>
  );
}

function FoundOrg({ onDone }: { onDone: () => void }) {
  const [sid, setSid] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sid: sid.trim(), name: name.trim(), description: description.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not create the org");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded border border-line bg-panel p-4">
      <h2 className="mb-1 text-sm font-bold text-ink">Found an org</h2>
      <p className="mb-3 text-[11px] text-ink-faint">
        You can only register the org your verified RSI profile already lists as your main org.
        That is what stops anyone claiming somebody else&apos;s fleet — and it is what makes an
        org&apos;s trading record here worth anything.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">SID</span>
          <input
            value={sid}
            onChange={(e) => setSid(e.target.value.toUpperCase())}
            placeholder="KCXORG"
            maxLength={20}
            className="mt-1 w-32 rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        <label className="min-w-48 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kestrel Freight Collective"
            maxLength={120}
            className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">What you do (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={1000}
          className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink focus:outline-none"
        />
      </label>
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || sid.trim().length < 3 || name.trim().length < 2}
        className="tap mt-3 rounded bg-accent/20 px-4 py-1.5 text-sm font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        {busy ? "…" : "Found it"}
      </button>
    </div>
  );
}

function TreasuryForm({
  current,
  busy,
  onSave,
}: {
  current: number;
  busy: boolean;
  onSave: (treasury: number) => void;
}) {
  const [value, setValue] = useState(String(current));
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <label>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          Declared treasury (aUEC)
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="num mt-1 w-44 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
        />
      </label>
      <button
        onClick={() => onSave(Math.max(0, Math.round(Number(value))))}
        disabled={busy}
        className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        Save
      </button>
      <span className="text-[11px] text-ink-faint">
        Can&apos;t go below what the org has already committed.
      </span>
    </div>
  );
}
