"use client";

import type { ServiceContractDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ClassifiedBriefing } from "@/components/classified-briefing";
import { ContractStandingBadge, StarPicker } from "@/components/trader-standing";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const CATEGORIES = ["hauling", "escort", "mining", "salvage", "medical", "combat", "exploration", "other"] as const;
type Category = (typeof CATEGORIES)[number];

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
        <div className="space-y-2">
          {visible.map((c) => (
            <article key={c.id} className={`rounded border p-3 ${c.isIssuer || c.isExecutor ? "border-accent/40" : "border-line"} bg-panel`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {c.category && (
                  <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                    {c.category}
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
                <h3 className="text-sm font-bold text-ink">{c.title}</h3>
                <span className="num ml-auto text-right text-sm font-bold text-up">
                  {c.awardedAmount != null ? (
                    <>
                      {fmt(c.awardedAmount)} aUEC
                      <span className="block text-[10px] font-normal text-ink-faint">
                        won at · budget {fmt(c.payout)}
                      </span>
                    </>
                  ) : c.pricingMode === "bid" ? (
                    <>
                      ≤ {fmt(c.payout)} aUEC
                      <span className="block text-[10px] font-normal text-ink-faint">budget ceiling</span>
                    </>
                  ) : (
                    <>{fmt(c.payout)} aUEC</>
                  )}
                </span>
              </div>

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
                  />
                </a>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                {c.issuerName ? (
                  <span className="flex items-center gap-1.5">
                    posted by <span className="text-ink-dim">{c.issuerName}</span>
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

              <div className="mt-2 flex flex-wrap items-center gap-2">
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
          ))}
        </div>
      )}
    </div>
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
