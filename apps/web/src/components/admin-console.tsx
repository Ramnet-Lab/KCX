"use client";

import { useCallback, useEffect, useState } from "react";

type Tab = "queue" | "users" | "contracts" | "log";

type Overview = {
  openBreaches: number;
  disputedBreaches: number;
  liveContracts: number;
  classifiedLive: number;
  bannedUsers: number;
  totalUsers: number;
};

type Breach = {
  contractId: string;
  contractTitle: string;
  status: string;
  reason: string;
  response: string | null;
  accusedId: string;
  accusedName: string;
  accusedBreaches: number;
  reporterName: string;
  createdAt: string;
  acknowledgedAt: string | null;
};

type ModUser = {
  id: string;
  handle: string;
  displayName: string;
  role: string;
  isVerified: boolean;
  bannedAt: string | null;
  bannedUntil: string | null;
  banLabel: string | null;
  breaches: number;
  contractsDone: number;
};

const BAN_OPTIONS = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "permanent", label: "Permanent" },
] as const;

type LogRow = {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  moderatorName: string;
  targetUserName: string | null;
  reason: string | null;
  createdAt: string;
};

type AdminContract = {
  id: string;
  title: string;
  status: string;
  payout: number;
  visibility: string;
  issuerName: string | null;
  executorName: string | null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

/** Moderator console. Every panel reads from an API that re-checks the role server-side. */
export function AdminConsole({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("queue");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [users, setUsers] = useState<ModUser[]>([]);
  const [contracts, setContracts] = useState<AdminContract[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ov, br] = await Promise.all([
      fetch("/api/admin/overview", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/breaches", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]);
    if (ov.overview) setOverview(ov.overview);
    if (ov.log) setLog(ov.log);
    if (br.breaches) setBreaches(br.breaches);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadUsers = useCallback(async (q: string) => {
    const res = await fetch(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setUsers(body.users ?? []);
  }, []);

  const loadContracts = useCallback(async () => {
    const res = await fetch("/api/admin/contracts", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setContracts(body.contracts ?? []);
  }, []);

  useEffect(() => {
    if (tab === "users") void loadUsers(search);
    if (tab === "contracts") void loadContracts();
  }, [tab, loadUsers, loadContracts, search]);

  const send = async (url: string, body: unknown, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return false;
      }
      await load();
      if (tab === "users") await loadUsers(search);
      if (tab === "contracts") await loadContracts();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "queue", label: "Breach queue", badge: (overview?.openBreaches ?? 0) + (overview?.disputedBreaches ?? 0) },
    { key: "users", label: "Users" },
    { key: "contracts", label: "Contracts" },
    { key: "log", label: "Audit log" },
  ];

  return (
    <div>
      {overview && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Open breaches" value={overview.openBreaches} alert={overview.openBreaches > 0} />
          <Stat label="Contested" value={overview.disputedBreaches} alert={overview.disputedBreaches > 0} />
          <Stat label="Live contracts" value={overview.liveContracts} />
          <Stat label="Classified" value={overview.classifiedLive} />
          <Stat label="Banned" value={overview.bannedUsers} />
          <Stat label="Users" value={overview.totalUsers} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tap -mb-px border-b-2 px-3 py-2 text-xs font-bold ${
              tab === t.key ? "border-accent text-accent" : "border-transparent text-ink-faint hover:text-ink-dim"
            }`}
          >
            {t.label}
            {!!t.badge && <span className="num ml-1.5 rounded bg-danger/20 px-1 text-danger">{t.badge}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {tab === "queue" && (
        <BreachQueue breaches={breaches} busy={busy} onRule={(id, action, reason) =>
          send("/api/admin/breaches", { contractId: id, action, reason }, id)
        } />
      )}

      {tab === "users" && (
        <UserPanel
          users={users}
          isAdmin={isAdmin}
          busy={busy}
          search={search}
          onSearch={setSearch}
          onAction={(payload, key) => send("/api/admin/users", payload, key)}
        />
      )}

      {tab === "contracts" && (
        <ContractPanel
          contracts={contracts}
          busy={busy}
          onVoid={(id, reason) => send("/api/admin/contracts", { contractId: id, reason }, id)}
        />
      )}

      {tab === "log" && <AuditLog rows={log} />}
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`rounded border p-2 ${alert ? "border-danger/50 bg-danger/5" : "border-line bg-panel"}`}>
      <div className={`num text-lg font-bold ${alert ? "text-danger" : "text-ink"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}

function BreachQueue({
  breaches,
  busy,
  onRule,
}: {
  breaches: Breach[];
  busy: string | null;
  onRule: (contractId: string, action: "uphold" | "dismiss", reason: string) => Promise<boolean>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});

  if (breaches.length === 0) {
    return (
      <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
        Nothing waiting. Reported breaches land here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {breaches.map((b) => (
        <article key={b.contractId} className="rounded border border-danger/40 bg-panel p-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger">
              {b.status}
            </span>
            <h3 className="text-sm font-bold text-ink">{b.contractTitle}</h3>
            <span className="ml-auto text-[11px] text-ink-faint">{fmtDate(b.createdAt)}</span>
          </div>

          <p className="mt-2 text-xs text-ink-dim">
            <span className="text-ink-faint">Accused:</span> <span className="text-ink">{b.accusedName}</span>
            {b.accusedBreaches > 1 && (
              <span className="ml-1 font-bold text-danger">({b.accusedBreaches} breaches on record)</span>
            )}
            <span className="ml-3 text-ink-faint">Reported by:</span> {b.reporterName}
          </p>

          <p className="mt-1 text-[11px] text-ink-faint">
            {b.acknowledgedAt
              ? `Conditions acknowledged ${fmtDate(b.acknowledgedAt)}`
              : "⚠ No acknowledgement on record for this contract"}
          </p>

          <div className="mt-2 rounded border border-line bg-panel-2 p-2 text-xs">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Claim</p>
            <p className="whitespace-pre-wrap text-ink-dim">{b.reason}</p>
            {b.response && (
              <>
                <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Reply</p>
                <p className="whitespace-pre-wrap text-ink-dim">{b.response}</p>
              </>
            )}
          </div>

          <input
            value={reasons[b.contractId] ?? ""}
            onChange={(e) => setReasons((r) => ({ ...r, [b.contractId]: e.target.value }))}
            placeholder="Ruling note (optional, goes in the audit log)"
            className="mt-2 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => onRule(b.contractId, "uphold", reasons[b.contractId] ?? "")}
              disabled={busy === b.contractId}
              className="tap rounded bg-danger/20 px-3 py-1 text-xs font-bold text-danger hover:bg-danger/30 disabled:opacity-50"
            >
              Uphold
            </button>
            <button
              onClick={() => onRule(b.contractId, "dismiss", reasons[b.contractId] ?? "")}
              disabled={busy === b.contractId}
              className="tap rounded bg-up/20 px-3 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:opacity-50"
            >
              Dismiss
            </button>
            <span className="self-center text-[11px] text-ink-faint">
              Dismissing removes it from their public count.
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function UserPanel({
  users,
  isAdmin,
  busy,
  search,
  onSearch,
  onAction,
}: {
  users: ModUser[];
  isAdmin: boolean;
  busy: string | null;
  search: string;
  onSearch: (v: string) => void;
  onAction: (payload: Record<string, unknown>, key: string) => Promise<boolean>;
}) {
  const [banHandle, setBanHandle] = useState("");
  const [banDuration, setBanDuration] = useState<string>("24h");
  const [banReason, setBanReason] = useState("");
  const [rowDuration, setRowDuration] = useState<Record<string, string>>({});

  return (
    <div>
      {/* Ban by handle: a moderator usually has the name from a report, not a row. */}
      <div className="mb-4 rounded border border-danger/40 bg-danger/5 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-danger">Ban by handle</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[10rem]">
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">RSI handle</span>
            <input
              value={banHandle}
              onChange={(e) => setBanHandle(e.target.value)}
              placeholder="e.g. ramnet"
              className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
          <label>
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">Duration</span>
            <select
              value={banDuration}
              onChange={(e) => setBanDuration(e.target.value)}
              className="mt-1 rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink focus:outline-none"
            >
              {BAN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-[12rem]">
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">Reason</span>
            <input
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Logged against your name"
              className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
          <button
            onClick={async () => {
              const ok = await onAction(
                { action: "ban", handle: banHandle.trim(), duration: banDuration, reason: banReason },
                `handle:${banHandle}`,
              );
              if (ok) {
                setBanHandle("");
                setBanReason("");
              }
            }}
            disabled={busy === `handle:${banHandle}` || banHandle.trim().length < 3}
            className="tap rounded bg-danger/20 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/30 disabled:opacity-40"
          >
            Ban
          </button>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search handle or display name"
        className="mb-3 w-full max-w-sm rounded border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
            <tr className="border-b border-line">
              <th className="py-2">Handle</th>
              <th>Role</th>
              <th className="num text-right">Done</th>
              <th className="num text-right">Breaches</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line/50">
                <td className="py-2">
                  <span className="text-ink">{u.displayName}</span>
                  <span className="ml-1 text-ink-faint">@{u.handle}</span>
                  {u.isVerified && <span className="ml-1 text-accent">✓</span>}
                </td>
                <td className={u.role === "user" ? "text-ink-faint" : "font-bold text-accent"}>{u.role}</td>
                <td className="num text-right text-ink-dim">{u.contractsDone}</td>
                <td className={`num text-right ${u.breaches > 0 ? "font-bold text-danger" : "text-ink-faint"}`}>
                  {u.breaches}
                </td>
                <td className={u.banLabel ? "font-bold text-danger" : "text-up"}>
                  {u.banLabel ? `banned · ${u.banLabel}` : "active"}
                </td>
                <td className="py-2 text-right">
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {u.banLabel ? (
                      <button
                        onClick={() => onAction({ action: "unban", userId: u.id }, u.id)}
                        disabled={busy === u.id}
                        className="tap text-up hover:underline disabled:opacity-30"
                      >
                        reinstate
                      </button>
                    ) : (
                      <>
                        <select
                          value={rowDuration[u.id] ?? "24h"}
                          onChange={(e) => setRowDuration((d) => ({ ...d, [u.id]: e.target.value }))}
                          disabled={u.role === "admin"}
                          aria-label={`Ban duration for ${u.handle}`}
                          className="rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink focus:outline-none disabled:opacity-30"
                        >
                          {BAN_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            onAction({ action: "ban", userId: u.id, duration: rowDuration[u.id] ?? "24h" }, u.id)
                          }
                          disabled={busy === u.id || u.role === "admin"}
                          className="tap text-ink-faint hover:text-danger disabled:opacity-30"
                        >
                          ban
                        </button>
                      </>
                    )}
                    {isAdmin && (
                      <select
                        value={u.role}
                        onChange={(e) => onAction({ action: "set_role", userId: u.id, role: e.target.value }, u.id)}
                        disabled={busy === u.id}
                        aria-label={`Role for ${u.handle}`}
                        className="rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-accent focus:outline-none disabled:opacity-30"
                      >
                        <option value="user">user</option>
                        <option value="mod">mod</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        {isAdmin
          ? "Changing a role takes effect immediately. You can't change your own, and the last admin can't be demoted."
          : "Only an admin can change roles — a mod who can appoint mods can grow their own faction. Bans are yours to make."}
      </p>
    </div>
  );
}

function ContractPanel({
  contracts,
  busy,
  onVoid,
}: {
  contracts: AdminContract[];
  busy: string | null;
  onVoid: (id: string, reason: string) => Promise<boolean>;
}) {
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-2">
      {contracts.length === 0 && (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          No live contracts.
        </div>
      )}
      {contracts.map((c) => (
        <div key={c.id} className="rounded border border-line bg-panel p-3 text-xs">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {c.visibility === "classified" && (
              <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger">
                ▩ classified
              </span>
            )}
            <span className="font-bold text-ink">{c.title}</span>
            <span className="text-ink-faint">{c.status}</span>
            <span className="num ml-auto text-up">{c.payout.toLocaleString()} aUEC</span>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            {c.issuerName ?? "—"}
            {c.executorName && ` → ${c.executorName}`}
          </p>

          {voiding === c.id ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why (required, logged)"
                className="flex-1 rounded border border-line bg-bg px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <button
                onClick={async () => {
                  if ((await onVoid(c.id, reason)) !== false) {
                    setVoiding(null);
                    setReason("");
                  }
                }}
                disabled={busy === c.id || reason.trim().length < 5}
                className="tap rounded bg-danger/20 px-3 py-1 font-bold text-danger hover:bg-danger/30 disabled:opacity-40"
              >
                Void
              </button>
              <button onClick={() => setVoiding(null)} className="tap text-ink-faint hover:text-ink">
                cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setVoiding(c.id);
                setReason("");
              }}
              className="tap mt-1 text-[11px] text-ink-faint hover:text-danger"
            >
              Void this contract
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditLog({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
        No moderator actions recorded yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
          <tr className="border-b border-line">
            <th className="py-2">When</th>
            <th>Moderator</th>
            <th>Action</th>
            <th>Target</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/50">
              <td className="py-2 whitespace-nowrap text-ink-faint">{fmtDate(r.createdAt)}</td>
              <td className="text-ink-dim">{r.moderatorName}</td>
              <td className="font-bold text-accent">{r.action.replace(/_/g, " ")}</td>
              <td className="text-ink-dim">{r.targetUserName ?? `${r.targetType} ${r.targetId.slice(0, 8)}`}</td>
              <td className="text-ink-faint">{r.reason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
