"use client";

import type { ServiceContractDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StarPicker } from "@/components/trader-standing";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const CATEGORIES = ["hauling", "escort", "mining", "salvage", "medical", "combat", "exploration", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const DEADLINES = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
];

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m left`;
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

/**
 * Player-written work contracts: "I need X done, here is what I'll pay."
 *
 * Distinct from the commodity board — nothing here is priced per SCU or matched against a
 * market. The issuer names the job, an executor takes it, and both must agree it was done
 * before the payout moves.
 */
export function ContractBoard({
  contracts: initial,
  signedIn,
  pendingRatings,
}: {
  contracts: ServiceContractDto[];
  signedIn: boolean;
  pendingRatings: { contractId: string; counterpartyName: string; title: string }[];
}) {
  const [contracts, setContracts] = useState(initial);
  const [category, setCategory] = useState<Category | "all">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const refresh = async () => {
    const res = await fetch("/api/service-contracts", { cache: "no-store" });
    if (res.ok) setContracts((await res.json()).contracts ?? []);
    router.refresh();
  };

  const act = async (id: string, action: "claim" | "confirm" | "cancel") => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/service-contracts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Failed");
      else await refresh();
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(
    () =>
      contracts.filter(
        (c) => (category === "all" || c.category === category) && (!mineOnly || c.isIssuer || c.isExecutor),
      ),
    [contracts, category, mineOnly],
  );

  return (
    <div>
      {pendingRatings.length > 0 && <RateContractsPanel pending={pendingRatings} onDone={refresh} />}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "all")}
          aria-label="Filter by category"
          className="rounded border border-line bg-panel px-2 py-1.5 text-ink focus:outline-none"
        >
          <option value="all">All work</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0]!.toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        {signedIn && (
          <label className="flex items-center gap-1 text-ink-dim">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="accent-[#e8b449]" />
            Mine only
          </label>
        )}
        <span className="text-ink-faint">
          {visible.length} of {contracts.length}
        </span>
        <button
          onClick={() => (signedIn ? setComposing((v) => !v) : router.push("/signin"))}
          className="tap ml-auto rounded border border-accent/60 px-3 py-1.5 font-bold text-accent hover:bg-accent/10"
        >
          {composing ? "Close" : "+ Post a contract"}
        </button>
      </div>

      {composing && signedIn && <ComposeContract onPosted={() => { setComposing(false); void refresh(); }} />}

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {visible.length === 0 ? (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">No contracts posted.</p>
          <p>Need something hauled, escorted, or salvaged? Post the first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <article key={c.id} className={`rounded border p-3 ${c.isIssuer || c.isExecutor ? "border-accent/40" : "border-line"} bg-panel`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                  {c.category}
                </span>
                <h3 className="text-sm font-bold text-ink">{c.title}</h3>
                <span className="num ml-auto text-sm font-bold text-up">{fmt(c.payout)} aUEC</span>
              </div>

              {c.description && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-dim">{c.description}</p>}

              {c.imageFilename && (
                <a
                  href={`/api/uploads/contracts/${c.imageFilename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block w-fit"
                  title="Open full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/contracts/${c.imageFilename}`}
                    alt={`Reference image for ${c.title}`}
                    loading="lazy"
                    className="max-h-48 rounded border border-line object-contain"
                  />
                </a>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                <span>
                  posted by <span className="text-ink-dim">{c.issuerName}</span>
                </span>
                {c.executorName && (
                  <span>
                    taken by <span className="text-ink-dim">{c.executorName}</span>
                  </span>
                )}
                <span suppressHydrationWarning>{timeLeft(c.expiresAt)}</span>
                {c.status === "in_progress" && (
                  <span className="text-accent">
                    {c.executorConfirmed && c.issuerConfirmed
                      ? "settling"
                      : c.executorConfirmed
                        ? "executor marked done — awaiting issuer"
                        : c.issuerConfirmed
                          ? "issuer confirmed — awaiting executor"
                          : "in progress"}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.status === "open" && !c.isIssuer && (
                  <button
                    onClick={() => (signedIn ? act(c.id, "claim") : router.push("/signin"))}
                    disabled={busy === c.id}
                    className="tap rounded bg-up/20 px-3 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:opacity-50"
                  >
                    Take this contract
                  </button>
                )}
                {c.status === "in_progress" && (c.isIssuer || c.isExecutor) && (
                  <>
                    <button
                      onClick={() => act(c.id, "confirm")}
                      disabled={busy === c.id || (c.isIssuer ? c.issuerConfirmed : c.executorConfirmed)}
                      className="tap rounded bg-up/20 px-3 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:cursor-default disabled:bg-panel-2 disabled:text-ink-faint"
                    >
                      {(c.isIssuer ? c.issuerConfirmed : c.executorConfirmed)
                        ? "✓ You confirmed"
                        : c.isExecutor
                          ? "Mark work complete"
                          : "Confirm work done"}
                    </button>
                    <button
                      onClick={() => act(c.id, "cancel")}
                      disabled={busy === c.id}
                      className="tap rounded px-3 py-1 text-xs text-ink-faint hover:text-danger disabled:opacity-50"
                    >
                      {c.isExecutor ? "Step away" : "Cancel contract"}
                    </button>
                  </>
                )}
                {c.status === "open" && c.isIssuer && (
                  <button
                    onClick={() => act(c.id, "cancel")}
                    disabled={busy === c.id}
                    className="tap rounded px-3 py-1 text-xs text-ink-faint hover:text-danger"
                  >
                    Withdraw
                  </button>
                )}
                {c.status === "in_progress" && (c.isIssuer || c.isExecutor) && (
                  <span className="text-[11px] text-ink-faint">
                    Both sides must confirm before the payout moves.
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeContract({ onPosted }: { onPosted: () => void }) {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("hauling");
  const [payout, setPayout] = useState("");
  const [hours, setHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/service-contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          payout: Math.round(Number(payout)),
          expiresInHours: hours,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not post");
        return;
      }
      // The contract exists either way; a failed image shouldn't discard the whole post.
      if (image && body.id) {
        const fd = new FormData();
        fd.append("image", image);
        const up = await fetch(`/api/service-contracts/${body.id}/image`, { method: "POST", body: fd });
        if (!up.ok) {
          const upBody = await up.json().catch(() => ({}));
          setError(`Contract posted, but the image failed: ${upBody.error ?? "upload error"}`);
        }
      }
      onPosted();
    } finally {
      setBusy(false);
    }
  };

  const valid = title.trim().length >= 4 && Number(payout) > 0;

  return (
    <div className="mb-4 rounded border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-bold text-ink">Post a contract</h2>
      <div className="space-y-3">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">What needs doing</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Haul 400 SCU of Titanium from Lorville to Area 18"
            className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Details (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Timing, meeting point, ship requirements, risks…"
            className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Payout (aUEC)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0"
              className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
            />
          </label>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Complete within</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {DEADLINES.map((d) => (
              <button
                key={d.hours}
                onClick={() => setHours(d.hours)}
                className={`tap flex-1 rounded border px-2 py-1 text-xs ${
                  hours === d.hours ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Screenshot (optional)
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f && f.size > 5 * 1024 * 1024) {
                setError("Image must be 5 MB or smaller");
                return;
              }
              setError(null);
              setImage(f);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
            className="mt-1 w-full text-xs text-ink-dim file:mr-3 file:rounded file:border file:border-line file:bg-panel-2 file:px-3 file:py-1.5 file:text-xs file:text-ink-dim hover:file:text-ink"
          />
          <span className="mt-1 block text-[11px] text-ink-faint">
            A target, a wreck, cargo on the pad — whatever makes the job clear. JPEG, PNG,
            WebP or GIF, up to 5 MB. Location data is stripped from photos on upload.
          </span>
          {preview && (
            <span className="mt-2 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="h-20 w-20 rounded border border-line object-cover" />
              <button
                onClick={() => {
                  setImage(null);
                  setPreview(null);
                }}
                className="tap text-xs text-ink-faint hover:text-danger"
              >
                remove
              </button>
            </span>
          )}
        </label>

        {error && <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="tap rounded bg-accent/20 px-4 py-1.5 text-sm font-bold text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Posting…" : "Post contract"}
          </button>
          <span className="text-[11px] text-ink-faint">
            The payout is committed against your declared balance until the contract closes.
          </span>
        </div>
      </div>
    </div>
  );
}

function RateContractsPanel({
  pending,
  onDone,
}: {
  pending: { contractId: string; counterpartyName: string; title: string }[];
  onDone: () => void;
}) {
  const [stars, setStars] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const outstanding = pending.filter((p) => !done.has(p.contractId));
  if (outstanding.length === 0) return null;

  const submit = async (contractId: string) => {
    const value = stars[contractId];
    if (!value) return;
    setBusy(contractId);
    try {
      const res = await fetch(`/api/service-contracts/${contractId}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stars: value }),
      });
      if (res.ok) {
        setDone((d) => new Set(d).add(contractId));
        onDone();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-sm font-bold text-ink">Rate completed contracts ({outstanding.length})</h2>
      <div className="space-y-2">
        {outstanding.map((p) => (
          <div key={p.contractId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-line bg-panel p-3 text-sm">
            <span className="text-ink">
              <span className="font-bold">{p.counterpartyName}</span>
              <span className="ml-2 text-xs text-ink-faint">{p.title}</span>
            </span>
            <span className="ml-auto flex items-center gap-2">
              <StarPicker
                value={stars[p.contractId] ?? 0}
                onChange={(v) => setStars((s) => ({ ...s, [p.contractId]: v }))}
                disabled={busy === p.contractId}
              />
              <button
                onClick={() => submit(p.contractId)}
                disabled={!stars[p.contractId] || busy === p.contractId}
                className="tap rounded border border-accent/60 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                Submit
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        Contract ratings are tracked separately from commodity trading.
      </p>
    </section>
  );
}
