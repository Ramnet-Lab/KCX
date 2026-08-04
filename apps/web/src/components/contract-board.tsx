"use client";

import type { ServiceContractDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ClassifiedBriefing } from "@/components/classified-briefing";
import { ContractStandingBadge, StarPicker } from "@/components/trader-standing";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const CATEGORIES = ["hauling", "escort", "mining", "salvage", "medical", "combat", "exploration", "other"] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Glyphs stand in for the mobiGlas category icons. Deliberately plain unicode rather than an
 * icon font: everything else on this site is monospace terminal furniture, and a pictorial
 * icon set would read as a different application bolted on.
 */
const CATEGORY_ICON: Record<Category, string> = {
  hauling: "▤",
  escort: "◈",
  mining: "⛏",
  salvage: "♺",
  medical: "✚",
  combat: "⚔",
  exploration: "◎",
  other: "◇",
};

/**
 * What still has to happen, as a checklist.
 *
 * The mobiGlas lists literal in-game objectives ("Deliver 0/1 Lab Sample to Seraphim
 * Station"). We can't know the in-fiction task — it's free text the issuer wrote — so the
 * equivalent here is the state of the AGREEMENT: the steps the exchange actually tracks and
 * can tick off. That keeps the panel honest rather than inventing objectives we can't verify.
 */
function objectivesFor(c: ServiceContractDto): { text: string; done: boolean }[] {
  const out: { text: string; done: boolean }[] = [];

  if (c.status === "bidding") {
    out.push({ text: `Sealed bidding open — ${c.bidCount} ${c.bidCount === 1 ? "bid" : "bids"} received`, done: false });
    out.push({ text: "Lowest bid wins when the window closes; ties go to whoever bid first", done: false });
    return out;
  }
  if (c.status === "awarded") {
    out.push({ text: "Bidding closed and a winner picked", done: true });
    out.push({ text: `${c.awardedToName ?? "The winner"} must accept before the window lapses`, done: false });
    return out;
  }
  if (c.status === "open") {
    out.push({
      text: c.visibility === "classified" ? "Take the contract to unseal the brief" : "Take the contract to begin",
      done: false,
    });
    if (c.locationName) out.push({ text: `Work at ${c.locationName}`, done: false });
    return out;
  }
  if (c.status === "in_progress") {
    out.push({ text: "Contract taken", done: true });
    out.push({ text: "Executor marks the work complete", done: c.executorConfirmed });
    out.push({ text: "Issuer confirms the work was done", done: c.issuerConfirmed });
    out.push({ text: "Payout moves in-game between the two of you", done: false });
    return out;
  }
  if (c.status === "completed") {
    out.push({ text: "Both sides confirmed — contract settled", done: true });
    return out;
  }
  out.push({ text: `Contract ${c.status}`, done: true });
  return out;
}

/** Compact payout for the rail, where the column is ~4 characters wide. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * The countdown the mobiGlas shows against each job. Whichever clock is actually running:
 * a contract out for bid is counting down to the close, everything else to its deadline.
 */
function railClock(c: ServiceContractDto): string | null {
  if (c.status === "bidding" && c.bidsCloseAt) return countdown(c.bidsCloseAt);
  if (c.status === "awarded" && c.awardExpiresAt) return countdown(c.awardExpiresAt);
  if (c.expiresAt) return countdown(c.expiresAt);
  return null;
}

const DEADLINES = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
];

const BID_WINDOWS = [
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
];

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m left`;
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
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
  const [briefing, setBriefing] = useState<{ contract: ServiceContractDto; kind: "claim" | "award" } | null>(null);
  const router = useRouter();

  const refresh = async () => {
    const res = await fetch("/api/service-contracts", { cache: "no-store" });
    if (res.ok) setContracts((await res.json()).contracts ?? []);
    router.refresh();
  };

  const act = async (id: string, action: "claim" | "confirm" | "cancel", acknowledgedClassified?: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/service-contracts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(acknowledgedClassified ? { acknowledgedClassified } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 428 || body.needsClassifiedAck) {
        // Server insists on the briefing — open it rather than surfacing a raw error.
        setBriefing({ contract: contracts.find((c) => c.id === id)!, kind: "claim" });
        return;
      }
      if (!res.ok) setError(body.error ?? "Failed");
      else await refresh();
    } finally {
      setBusy(null);
    }
  };

  /** Take a contract, showing the conditions-of-access briefing first when classified. */
  const take = (c: ServiceContractDto) => {
    if (!signedIn) return router.push("/signin");
    if (c.visibility === "classified") return setBriefing({ contract: c, kind: "claim" });
    void act(c.id, "claim");
  };

  const respondToAward = async (id: string, action: "accept" | "decline", acknowledgedClassified?: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/service-contracts/${id}/award`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(acknowledgedClassified ? { acknowledgedClassified } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 428 || body.needsClassifiedAck) {
        setBriefing({ contract: contracts.find((c) => c.id === id)!, kind: "award" });
        return;
      }
      if (!res.ok) setError(body.error ?? "Failed");
      else await refresh();
    } finally {
      setBusy(null);
    }
  };

  /** Accept an auction win — briefing first if the contract is classified. */
  const acceptAward = (c: ServiceContractDto) => {
    if (c.visibility === "classified") return setBriefing({ contract: c, kind: "award" });
    void respondToAward(c.id, "accept");
  };

  const withdrawBid = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/service-contracts/${id}/bids`, { method: "DELETE" });
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
        (c) =>
          (category === "all" || c.category === category) &&
          (!mineOnly || c.isIssuer || c.isExecutor || c.isAwardee),
      ),
    [contracts, category, mineOnly],
  );

  // Grouped for the rail. Only categories with work appear — the mobiGlas doesn't list an
  // empty board either, and eight always-visible zero rows would be mostly noise.
  const grouped = useMemo(() => {
    const by = new Map<Category, ServiceContractDto[]>();
    for (const c of visible) {
      const key = (CATEGORIES as readonly string[]).includes(c.category ?? "")
        ? (c.category as Category)
        : "other";
      const list = by.get(key);
      if (list) list.push(c);
      else by.set(key, [c]);
    }
    return CATEGORIES.filter((k) => by.has(k)).map((k) => ({ key: k, items: by.get(k)! }));
  }, [visible]);

  // Categories start expanded. Collapsing is available, but a board that hides its contents
  // by default makes a new visitor click before seeing anything at all.
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set());
  const toggleCat = (k: Category) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Selection survives a refresh by id, but must fall back when filtering removes it —
  // otherwise the detail pane keeps showing a contract the rail no longer lists.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0] ?? null;
  const dossierRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      {briefing && (
        <ClassifiedBriefing
          title={briefing.contract.title}
          payout={briefing.contract.payout}
          busy={busy === briefing.contract.id}
          onCancel={() => setBriefing(null)}
          onAccept={async () => {
            const { contract, kind } = briefing;
            setBriefing(null);
            if (kind === "claim") await act(contract.id, "claim", true);
            else await respondToAward(contract.id, "accept", true);
          }}
        />
      )}

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
        /*
         * Contract Manager layout, after the in-game mobiGlas: a category rail on the left,
         * the selected job's dossier on the right. Familiarity is the point — a Star Citizen
         * player already knows how to read this, so the shape carries the meaning before any
         * of our own labels do.
         *
         * Below lg the two panes stack: the rail full width, the dossier beneath it. A 320px
         * sidebar next to a 40-character detail column is worse than either alone.
         */
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,340px)_1fr] lg:items-start">
          {/* ---------------------------------------------------------------- rail */}
          {/*
            The rail scrolls inside itself and sticks, as the in-game panel does. Without the
            cap a busy board runs thousands of pixels past the dossier, and on a phone you
            would scroll the entire category list before reaching the contract you just picked.
          */}
          <nav
            className="rounded border border-line bg-panel p-2 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
            aria-label="Contracts by category"
          >
            {grouped.map(({ key, items }) => {
              const isOpen = !collapsed.has(key);
              return (
                <div key={key} className="mb-1.5 last:mb-0">
                  <button
                    onClick={() => toggleCat(key)}
                    aria-expanded={isOpen}
                    className="tap flex w-full items-center gap-2 rounded border border-line bg-panel-2 px-2.5 py-2 text-left hover:border-ink-faint"
                  >
                    <span aria-hidden className="text-sm text-ink-dim">
                      {CATEGORY_ICON[key]}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-widest text-ink">{key}</span>
                    <span className="num ml-auto flex h-5 min-w-5 items-center justify-center rounded-full border border-line px-1 text-[10px] text-ink-dim">
                      {items.length}
                    </span>
                    <span aria-hidden className="text-[10px] text-ink-faint">
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="mt-1 space-y-1 pl-1">
                      {items.map((c) => {
                        const active = selected?.id === c.id;
                        const clock = railClock(c);
                        const amount = c.awardedAmount ?? c.payout;
                        return (
                          <li key={c.id}>
                            <button
                              onClick={() => {
                                setSelectedId(c.id);
                                // Stacked layout: the dossier is below the whole rail, so
                                // selecting without moving the viewport looks like nothing
                                // happened. Desktop shows both panes already.
                                if (window.innerWidth < 1024) {
                                  requestAnimationFrame(() =>
                                    dossierRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                                  );
                                }
                              }}
                              aria-current={active ? "true" : undefined}
                              className={`tap flex w-full items-start gap-2 rounded border-l-2 py-1.5 pl-2 pr-2 text-left transition-colors ${
                                active
                                  ? "border-l-up bg-up/10"
                                  : "border-l-accent/50 bg-panel-2/40 hover:bg-panel-2"
                              }`}
                            >
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate text-[11px] font-bold uppercase tracking-wide ${active ? "text-up" : "text-ink"}`}
                                >
                                  {c.visibility === "classified" && <span aria-hidden>▩ </span>}
                                  {c.title}
                                </span>
                                <span className="block truncate text-[10px] uppercase tracking-wider text-ink-faint">
                                  {c.issuerName ?? "issuer withheld"}
                                </span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className={`num block text-[11px] font-bold ${active ? "text-up" : "text-ink-dim"}`}>
                                  {c.pricingMode === "bid" && c.awardedAmount == null ? "≤" : ""}
                                  {short(amount)}
                                </span>
                                {clock && (
                                  <span className="num block text-[10px] text-ink-faint" suppressHydrationWarning>
                                    {clock}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>

          {/* -------------------------------------------------------------- dossier */}
          {selected && (
            <div ref={dossierRef} className="space-y-3 scroll-mt-4">
              {/* Title bar and the three facts the mobiGlas puts beside it. */}
              <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-stretch">
                <div className="flex items-center rounded border border-line bg-panel px-4 py-3">
                  <h2 className="text-lg font-bold text-ink">{selected.title}</h2>
                </div>
                <dl className="rounded border border-line bg-panel px-4 py-3 text-xs xl:min-w-[19rem]">
                  {[
                    {
                      k: selected.awardedAmount != null ? "Awarded" : selected.pricingMode === "bid" ? "Budget ceiling" : "Reward",
                      v: `${fmt(selected.awardedAmount ?? selected.payout)} aUEC`,
                    },
                    {
                      k: selected.status === "bidding" ? "Bidding closes" : "Contract availability",
                      v:
                        selected.status === "bidding" && selected.bidsCloseAt
                          ? countdown(selected.bidsCloseAt)
                          : selected.expiresAt
                            ? timeLeft(selected.expiresAt)
                            : "—",
                    },
                    { k: "Contracted by", v: selected.issuerName ?? "withheld" },
                  ].map((row) => (
                    <div key={row.k} className="flex items-baseline justify-between gap-6 py-0.5">
                      <dt className="text-accent">{row.k}</dt>
                      <dd className="num text-right text-ink" suppressHydrationWarning>
                        {row.v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <ContractDossier
                c={selected}
                signedIn={signedIn}
                busy={busy}
                onTake={take}
                onAct={act}
                onAcceptAward={acceptAward}
                onDeclineAward={(id) => respondToAward(id, "decline")}
                onWithdrawBid={withdrawBid}
                onRefresh={refresh}
                onError={setError}
                onSignIn={() => router.push("/signin")}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The dossier pane: everything about one contract, laid out as the mobiGlas does it —
 * DETAILS on the left, PRIMARY OBJECTIVES on the right, the commitment button bottom-right.
 *
 * Extracted from the board rather than left inline because the board now renders exactly one
 * of these instead of a list, and 250 lines of contract body nested inside a category
 * accordion inside a grid is not something anyone can safely edit later.
 */
function ContractDossier({
  c,
  signedIn,
  busy,
  onTake,
  onAct,
  onAcceptAward,
  onDeclineAward,
  onWithdrawBid,
  onRefresh,
  onError,
  onSignIn,
}: {
  c: ServiceContractDto;
  signedIn: boolean;
  busy: string | null;
  onTake: (c: ServiceContractDto) => void;
  onAct: (id: string, action: "claim" | "confirm" | "cancel") => void | Promise<void>;
  onAcceptAward: (c: ServiceContractDto) => void;
  onDeclineAward: (id: string) => void;
  onWithdrawBid: (id: string) => void;
  onRefresh: () => Promise<void> | void;
  onError: (m: string | null) => void;
  onSignIn: () => void;
}) {
  const act = (id: string, action: "claim" | "confirm" | "cancel") => void onAct(id, action);
  const refresh = () => void onRefresh();
  const setError = onError;
  const take = onTake;
  const acceptAward = onAcceptAward;
  const respondToAward = (id: string, action: "accept" | "decline") => {
    if (action === "decline") onDeclineAward(id);
  };
  const withdrawBid = onWithdrawBid;
  const router = { push: (_: string) => onSignIn() };

  return (
    <article className="rounded border border-line bg-panel p-4">
      {/* Status chips. Title and reward now live in the header above, as they do in-game. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {c.category && (
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            {CATEGORY_ICON[(c.category as Category) in CATEGORY_ICON ? (c.category as Category) : "other"]} {c.category}
          </span>
        )}
        {c.visibility === "classified" && (
          <span
            className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger"
            title="Details are hidden until someone takes this contract"
          >
            ▩ Classified
          </span>
        )}
        {c.pricingMode === "bid" && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
            ⚖ Out for bid
          </span>
        )}
        {c.awardedAmount != null && (
          <span className="num text-[10px] text-ink-faint">
            won at {fmt(c.awardedAmount)} · budget {fmt(c.payout)}
          </span>
        )}
      </div>

      {/*
       * DETAILS | PRIMARY OBJECTIVES, mirroring the mobiGlas. The divider is a left border on
       * the second column rather than a separate element, so it collapses cleanly when the
       * columns stack on a narrow screen.
       */}
      <div className="grid gap-5 md:grid-cols-[1fr_minmax(14rem,20rem)]">
        <section>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink">Details</h3>

              {c.redacted && (
                <p className="mt-2 rounded border border-dashed border-danger/40 bg-danger/5 px-3 py-2 text-xs text-ink-faint">
                  <span className="font-bold text-danger">Classified.</span> You can see the title
                  and the payout. The brief, the deadline, the location, any image and who posted
                  it are released the moment you take this contract, and not before.
                </p>
              )}

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
                    // A contract whose image 404s (deleted upload, bad filename) otherwise
                    // renders the alt text as broken-image furniture in the middle of the brief.
                    onError={(e) => {
                      const link = e.currentTarget.closest("a");
                      if (link) link.style.display = "none";
                    }}
                  />
                </a>
              )}

          {!c.description && !c.redacted && (
            <p className="text-xs text-ink-faint">No brief was written for this contract.</p>
          )}
        </section>

        {/*
         * PRIMARY OBJECTIVES — in-game this is the checklist of what you must actually do.
         * Here the equivalent is the state of the agreement: who is party to it, which clock
         * is running, and what each side still has to do before the payout moves.
         */}
        <section className="md:border-l md:border-line md:pl-5">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink">Primary objectives</h3>

          <ul className="mb-3 space-y-1.5 text-xs">
            {objectivesFor(c).map((o, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className={o.done ? "text-up" : "text-accent"}>
                  {o.done ? "◆" : "◇"}
                </span>
                <span className={o.done ? "text-ink-faint line-through" : "text-ink-dim"}>{o.text}</span>
              </li>
            ))}
          </ul>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                {c.issuerName ? (
                  <span className="flex items-center gap-1.5">
                    posted by{" "}
                    {c.orgSid ? (
                      <span
                        className="flex items-center gap-1"
                        title={`${c.orgName} — issued by the org, paid from its treasury`}
                      >
                        {c.orgLogoFilename && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/uploads/orgs/${c.orgLogoFilename}`}
                            alt=""
                            className="h-3.5 w-3.5 rounded-sm"
                          />
                        )}
                        <span className="font-bold text-ink-dim">{c.orgSid}</span>
                        <span className="text-ink-faint">via {c.issuerName}</span>
                      </span>
                    ) : (
                      <span className="text-ink-dim">{c.issuerName}</span>
                    )}
                    {c.issuerStanding && <ContractStandingBadge {...c.issuerStanding} compact />}
                  </span>
                ) : (
                  <span className="text-ink-faint">issuer withheld</span>
                )}
                {c.executorName && (
                  <span className="flex items-center gap-1.5">
                    taken by <span className="text-ink-dim">{c.executorName}</span>
                    {c.executorStanding && <ContractStandingBadge {...c.executorStanding} compact />}
                  </span>
                )}
                {c.expiresAt && <span suppressHydrationWarning>{timeLeft(c.expiresAt)}</span>}
                {c.status === "bidding" && c.bidsCloseAt && (
                  <span className="text-accent" suppressHydrationWarning>
                    bidding closes in {countdown(c.bidsCloseAt)}
                    {!c.redacted && ` · ${c.bidCount} ${c.bidCount === 1 ? "bid" : "bids"} (sealed)`}
                  </span>
                )}
                {c.status === "awarded" && (
                  <span className="text-accent" suppressHydrationWarning>
                    awarded to <span className="text-ink-dim">{c.awardedToName}</span>
                    {c.awardExpiresAt && ` · ${countdown(c.awardExpiresAt)} to accept`}
                  </span>
                )}
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

              {c.status === "bidding" && !c.isIssuer && (
                <BidPanel
                  contract={c}
                  signedIn={signedIn}
                  busy={busy === c.id}
                  onSignIn={() => router.push("/signin")}
                  onPlaced={refresh}
                  onWithdraw={() => withdrawBid(c.id)}
                  onError={setError}
                />
              )}

              {c.status === "bidding" && c.isIssuer && (
                <p className="mt-2 rounded border border-line bg-panel-2 px-3 py-2 text-[11px] text-ink-faint">
                  Bids are sealed — you'll see the winning number when the window closes, not
                  before. The lowest bid wins automatically; ties go to whoever bid first. Your
                  full {fmt(c.payout)} aUEC ceiling stays committed until then.
                </p>
              )}

              {c.status === "awarded" && c.isAwardee && (
                <div className="mt-2 rounded border border-accent/40 bg-accent/5 px-3 py-2">
                  <p className="text-xs text-ink">
                    <span className="font-bold text-accent">You won this contract</span> at{" "}
                    <span className="num font-bold">{fmt(c.awardedAmount ?? 0)} aUEC</span>.
                    {c.redacted && " Accepting releases the full brief and any attached image."}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => acceptAward(c)}
                      disabled={busy === c.id}
                      className="tap rounded bg-up/20 px-3 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:opacity-50"
                    >
                      {c.visibility === "classified" ? "Review conditions and accept" : "Accept and start"}
                    </button>
                    <button
                      onClick={() => respondToAward(c.id, "decline")}
                      disabled={busy === c.id}
                      className="tap rounded px-3 py-1 text-xs text-ink-faint hover:text-danger disabled:opacity-50"
                    >
                      Decline
                    </button>
                    <span className="text-[11px] text-ink-faint">
                      Declining passes it to the next-lowest bidder.
                    </span>
                  </div>
                </div>
              )}

              {c.breach && (
                <div className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
                  <p className="font-bold text-danger">
                    ▩ Breach of conditions {c.breach.status === "dismissed" ? "— dismissed by a moderator" : "recorded"}
                    {c.breach.status === "disputed" && " — contested"}
                    {c.breach.status === "upheld" && " — upheld"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-ink-dim">{c.breach.reason}</p>
                  {c.breach.response && (
                    <p className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-2 text-ink-faint">
                      Reply: {c.breach.response}
                    </p>
                  )}
                  {c.isExecutor && c.breach.status === "reported" && (
                    <BreachAction id={c.id} action="dispute" onDone={refresh} onError={setError} />
                  )}
                </div>
              )}

              {c.visibility === "classified" && c.isIssuer && c.executorId && !c.breach && (
                <BreachAction id={c.id} action="report" onDone={refresh} onError={setError} />
              )}
        </section>
      </div>

      {/* Commitment sits bottom-right in its own rule, where ACCEPT OFFER does in-game. */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                {c.status === "open" && !c.isIssuer && (
                  <button
                    onClick={() => take(c)}
                    disabled={busy === c.id}
                    className="tap rounded bg-up/20 px-3 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:opacity-50"
                  >
                    {c.visibility === "classified" ? "Request access to this contract" : "Take this contract"}
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
                {(c.status === "open" || c.status === "bidding" || c.status === "awarded") && c.isIssuer && (
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
  );
}

/**
 * Report a breach, or reply to one.
 *
 * Both sides go through the same small form on purpose: filing a breach and answering one are
 * equally consequential, and neither should be a single unconsidered tap.
 */
function BreachAction({
  id,
  action,
  onDone,
  onError,
}: {
  id: string;
  action: "report" | "dispute";
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const reporting = action === "report";

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/service-contracts/${id}/breach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reporting ? { action, reason: text.trim() } : { action, response: text.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) onError(body.error ?? "Failed");
      else {
        setOpen(false);
        setText("");
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`tap mt-2 text-[11px] ${reporting ? "text-ink-faint hover:text-danger" : "text-accent hover:underline"}`}
      >
        {reporting ? "Report a breach of conditions" : "Dispute this"}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded border border-danger/40 bg-panel-2 p-3">
      <p className="mb-2 text-[11px] text-ink-dim">
        {reporting
          ? "Describe what was disclosed and where. This is recorded against their contract standing and shown publicly, so be specific and factual."
          : "Give your side. It's shown alongside the claim, and a moderator can dismiss the breach entirely."}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder={reporting ? "What was shared, with whom, and how you know" : "Your account of what happened"}
        className="w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 10}
          className="tap rounded bg-danger/20 px-3 py-1 text-xs font-bold text-danger hover:bg-danger/30 disabled:opacity-40"
        >
          {busy ? "…" : reporting ? "File breach" : "Submit reply"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setText("");
          }}
          className="tap text-xs text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Sealed-bid entry for one contract.
 *
 * Shows the bidder their own number and the total count, never anyone else's amount — the
 * board never receives other bids, so there is nothing here that a devtools panel could
 * reveal that the API didn't already decide to send.
 */
function BidPanel({
  contract,
  signedIn,
  busy,
  onSignIn,
  onPlaced,
  onWithdraw,
  onError,
}: {
  contract: ServiceContractDto;
  signedIn: boolean;
  busy: boolean;
  onSignIn: () => void;
  onPlaced: () => void;
  onWithdraw: () => void;
  onError: (msg: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const mine = contract.myBid && contract.myBid.status !== "withdrawn" ? contract.myBid : null;

  const submit = async () => {
    const value = Math.round(Number(amount));
    if (!(value > 0)) return;
    setSaving(true);
    onError(null);
    try {
      const res = await fetch(`/api/service-contracts/${contract.id}/bids`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) onError(body.error ?? "Could not bid");
      else {
        setOpen(false);
        setAmount("");
        onPlaced();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!signedIn) {
    return (
      <div className="mt-2">
        <button
          onClick={onSignIn}
          className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30"
        >
          Sign in to bid
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded border border-line bg-panel-2 px-3 py-2">
      {mine ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className="text-ink-dim">
            Your bid: <span className="num font-bold text-ink">{fmt(mine.amount)} aUEC</span>
          </span>
          <button onClick={() => setOpen((v) => !v)} className="tap text-accent hover:underline">
            {open ? "cancel" : "revise"}
          </button>
          <button onClick={onWithdraw} disabled={busy} className="tap text-ink-faint hover:text-danger disabled:opacity-50">
            withdraw
          </button>
        </div>
      ) : (
        !open && (
          <button
            onClick={() => setOpen(true)}
            className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30"
          >
            Place a bid
          </button>
        )
      )}

      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Your price (aUEC) — must be at or under {fmt(contract.payout)}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={contract.payout}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-right text-sm text-ink focus:outline-none"
            />
          </label>
          <button
            onClick={submit}
            disabled={saving || !(Number(amount) > 0)}
            className="tap rounded bg-accent/20 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            {saving ? "Sending…" : mine ? "Update bid" : "Submit bid"}
          </button>
        </div>
      )}

      <p className="mt-1 text-[11px] text-ink-faint">
        Sealed bidding — nobody sees your number, and you can't see theirs. Lowest bid wins when
        the window closes.
        {contract.redacted && " This contract is classified: you're bidding on the title and the ceiling alone."}
      </p>
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
  const [pricingMode, setPricingMode] = useState<"fixed" | "bid">("fixed");
  const [bidWindowHours, setBidWindowHours] = useState(24);
  const [awardResponseHours, setAwardResponseHours] = useState(24);
  const [classified, setClassified] = useState(false);
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
          pricingMode,
          visibility: classified ? "classified" : "public",
          ...(pricingMode === "bid" ? { bidWindowHours, awardResponseHours } : {}),
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
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              {pricingMode === "bid" ? "Most you'll pay (aUEC)" : "Payout (aUEC)"}
            </span>
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">How it's priced</span>
          <div className="mt-1 flex gap-1">
            <button
              onClick={() => setPricingMode("fixed")}
              className={`tap flex-1 rounded border px-2 py-1.5 text-xs ${
                pricingMode === "fixed" ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
              }`}
            >
              Fixed price — first to take it
            </button>
            <button
              onClick={() => setPricingMode("bid")}
              className={`tap flex-1 rounded border px-2 py-1.5 text-xs ${
                pricingMode === "bid" ? "border-accent text-accent" : "border-line text-ink-faint hover:text-ink-dim"
              }`}
            >
              Out for bid — lowest wins
            </button>
          </div>
        </div>

        {pricingMode === "bid" && (
          <div className="rounded border border-accent/30 bg-accent/5 p-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  Bidding stays open for
                </span>
                <div className="mt-1 flex gap-1">
                  {BID_WINDOWS.map((w) => (
                    <button
                      key={w.hours}
                      onClick={() => setBidWindowHours(w.hours)}
                      className={`tap flex-1 rounded border px-2 py-1 text-xs ${
                        bidWindowHours === w.hours
                          ? "border-accent text-accent"
                          : "border-line text-ink-faint hover:text-ink-dim"
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="w-32">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  Winner has (hrs)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={168}
                  value={awardResponseHours}
                  onChange={(e) => setAwardResponseHours(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                  className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Bids are sealed: nobody sees anyone else's number. When the window closes the
              lowest bid wins automatically — ties go to whoever bid first — and that bidder
              gets the time above to accept. If they decline or go quiet it passes to the next
              lowest. Your full ceiling stays committed until a winner accepts, then only the
              winning amount does.
            </p>
          </div>
        )}
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

        <div className={`rounded border p-3 ${classified ? "border-danger/40 bg-danger/5" : "border-line"}`}>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={classified}
              onChange={(e) => setClassified(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#e8b449]"
            />
            <span className="text-xs">
              <span className="font-bold text-ink">Classified — only the title and the payout until someone takes it</span>
              <span className="mt-1 block text-[11px] text-ink-faint">
                The brief, the deadline, the location, the image and your own name are all
                withheld from the board. Everything is released the moment someone takes the
                contract.
              </span>
            </span>
          </label>
          {classified && (
            <p className="mt-2 rounded bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
              The title and the {pricingMode === "bid" ? "ceiling" : "payout"} are all anyone
              sees — keep the target out of the title, and make it enough for someone to say
              yes to.
            </p>
          )}
        </div>

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
            {pricingMode === "bid"
              ? "Your ceiling is committed against your declared balance while bidding runs."
              : "The payout is committed against your declared balance until the contract closes."}
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
