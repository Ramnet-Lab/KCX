"use client";

import type { InstalmentPlanDto } from "@kcx/db";
import {
  INSTALMENT_MAX_WINDOWS,
  INSTALMENT_MIN_WINDOWS,
  INSTALMENT_RATE_STEP_BPS,
  formatRate,
  quoteInstalments,
} from "@kcx/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtAuec, timeLeft } from "@/lib/countdown";

/**
 * Instalment plans, from both ends.
 *
 * The single most important thing on this screen is the sentence saying the goods do not
 * change hands until the schedule finishes. Everything else here is bookkeeping; that line
 * is what stops a plan being a way to take delivery on a deposit and vanish, and both
 * parties need to have read it before they agree rather than after.
 */
export function InstalmentPanel({
  plans,
  eligibility,
}: {
  plans: InstalmentPlanDto[];
  eligibility: { allowed: boolean; reason: string | null } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const post = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instalments", {
        method: "POST",
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
    <div className="space-y-3">
      <div className="rounded border border-line bg-panel-2 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
        <span className="font-bold text-ink-dim">How this works.</span> The seller sets a rate
        for waiting, shown in full before either side agrees and fixed once accepted. Longer
        schedules cost more: two windows is the seller&apos;s rate, and each window after that
        adds {formatRate(INSTALMENT_RATE_STEP_BPS)}. aUEC only, and KCX lends nothing and is
        not a party — the buyer pays the seller directly. Each payment is confirmed by both
        sides like any other settlement.{" "}
        <span className="text-ink">The seller keeps the item until the final payment clears.</span>{" "}
        Nothing is delivered on a deposit.
      </div>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {eligibility && !eligibility.allowed && plans.length === 0 && (
        <div className="rounded border border-line bg-panel px-3 py-2 text-xs text-ink-dim">
          <span className="font-bold text-ink">You can&apos;t start a plan yet.</span> {eligibility.reason}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="rounded border border-dashed border-line p-8 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">No instalment plans.</p>
          <p>Propose one from a pending bazaar sale on your desk.</p>
        </div>
      ) : (
        plans.map((p) => <PlanCard key={p.id} plan={p} busy={busy} onPost={post} />)
      )}
    </div>
  );
}

function PlanCard({
  plan: p,
  busy,
  onPost,
}: {
  plan: InstalmentPlanDto;
  busy: boolean;
  onPost: (body: unknown) => void;
}) {
  const pct = p.totalAmount > 0 ? Math.round((p.paidAmount / p.totalAmount) * 100) : 0;
  const live = p.status === "active";

  return (
    <article
      className={`rounded border p-3 ${
        p.status === "defaulted" ? "border-danger/50" : live ? "border-accent/40" : "border-line"
      } bg-panel`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={`/bazaar/${p.saleId}`} className="text-sm font-bold text-ink hover:text-accent">
          {p.listingTitle}
        </Link>
        <span className="text-[11px] text-ink-faint">
          {p.isBuyer ? "you're paying" : "you're being paid by"}{" "}
          <span className="text-ink-dim">{p.isBuyer ? p.sellerName : p.buyerName}</span>
        </span>
        <span className="num ml-auto text-sm font-bold text-up">{fmtAuec(p.totalAmount)} aUEC</span>
      </div>

      <div className="mt-1 text-[11px] text-ink-faint">
        {p.instalmentCount} payments, {p.intervalDays} days apart ·{" "}
        <span className={p.status === "defaulted" ? "font-bold text-danger" : "text-ink-dim"}>{p.status}</span>
        {live && ` · ${fmtAuec(p.outstanding)} aUEC outstanding`}
      </div>

      {/* The two numbers a buyer wants side by side: what it costs, and what waiting costs. */}
      <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-ink-faint">
        <span>
          item <span className="num text-ink-dim">{fmtAuec(p.principal)}</span>
        </span>
        {p.interestAmount > 0 ? (
          <span>
            interest at <span className="text-ink-dim">{formatRate(p.effectiveRateBps)}</span>{" "}
            <span className="num text-ink-dim">+{fmtAuec(p.interestAmount)}</span>
            {p.effectiveRateBps !== p.baseRateBps && (
              <span className="text-ink-faint">
                {" "}
                ({formatRate(p.baseRateBps)} asked, +{formatRate(p.effectiveRateBps - p.baseRateBps)} for the
                longer schedule)
              </span>
            )}
          </span>
        ) : (
          <span>no interest</span>
        )}
      </div>

      {/* A plain progress bar: "3 of 8 paid" is the fact both parties check first. */}
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-panel-2">
        <div className="h-full bg-up" style={{ width: `${pct}%` }} />
      </div>

      {p.status === "proposed" && (
        <div className="mt-2 rounded border border-accent/40 bg-accent/5 px-2 py-1.5">
          <p className="text-[11px] text-ink-dim">
            {p.proposedByMe
              ? "Waiting on them to accept this schedule."
              : "They've proposed paying in instalments. The item stays with the seller until the last payment clears."}
          </p>
          {!p.proposedByMe && (
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => onPost({ action: "accept", planId: p.id })}
                disabled={busy}
                className="tap rounded bg-up/20 px-3 py-1 text-xs font-bold text-up hover:bg-up/30 disabled:opacity-40"
              >
                Accept schedule
              </button>
              <button
                onClick={() => onPost({ action: "decline", planId: p.id })}
                disabled={busy}
                className="tap rounded px-2 py-1 text-xs text-ink-faint hover:text-danger disabled:opacity-40"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      )}

      <ol className="mt-2 space-y-1">
        {p.instalments.map((i) => {
          const iConfirmed = p.isBuyer ? i.buyerConfirmed : i.sellerConfirmed;
          const isNext = p.nextDue?.id === i.id;
          return (
            <li
              key={i.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1 text-xs ${
                i.status === "paid"
                  ? "text-ink-faint"
                  : i.status === "missed"
                    ? "bg-danger/5 text-danger"
                    : isNext
                      ? "bg-panel-2 text-ink"
                      : "text-ink-dim"
              }`}
            >
              <span className="num w-6 text-ink-faint">{i.sequence}</span>
              <span className="num w-28">{fmtAuec(i.amount)} aUEC</span>
              <span className="text-[11px]" suppressHydrationWarning>
                {i.status === "paid" ? "paid" : i.status === "missed" ? "missed" : timeLeft(i.dueAt)}
              </span>
              {i.status !== "paid" && i.status !== "missed" && (iConfirmed || (p.isBuyer ? i.sellerConfirmed : i.buyerConfirmed)) && (
                <span className="text-[11px] text-accent">
                  {iConfirmed ? "you confirmed — waiting on them" : "they confirmed — waiting on you"}
                </span>
              )}
              {live && isNext && i.status !== "paid" && (
                <button
                  onClick={() => onPost({ action: "confirm", instalmentId: i.id })}
                  disabled={busy || iConfirmed}
                  className="tap ml-auto rounded bg-up/20 px-2 py-0.5 text-[11px] font-bold text-up hover:bg-up/30 disabled:cursor-default disabled:bg-panel-2 disabled:text-ink-faint"
                >
                  {iConfirmed ? "✓ confirmed" : p.isBuyer ? "I've paid this" : "payment received"}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {p.status === "defaulted" && (
        <p className="mt-2 rounded border border-danger/40 bg-danger/5 px-2 py-1.5 text-[11px] text-danger">
          This plan defaulted. The sale was cancelled and the item stayed with the seller. The
          default is on {p.isBuyer ? "your" : "the buyer's"} permanent record.
        </p>
      )}
      {p.status === "completed" && (
        <p className="mt-2 text-[11px] text-up">Paid in full — the item changes hands now.</p>
      )}
    </article>
  );
}

/** Propose a schedule against a pending sale, from the sale row on the desk. */
export function ProposeInstalments({
  saleId,
  totalPrice,
  isSeller,
}: {
  saleId: string;
  totalPrice: number;
  /** Only the seller may name a rate; a buyer-side proposal is always at zero. */
  isSeller: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(4);
  const [interval, setInterval] = useState(7);
  const [ratePct, setRatePct] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/instalments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          saleId,
          instalmentCount: count,
          intervalDays: interval,
          ...(isSeller ? { rateBps } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not propose that");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="tap rounded border border-line px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
      >
        pay in instalments
      </button>
    );
  }

  // Priced by the same function the server uses, so the figure here and the figure in the
  // schedule cannot disagree about what was agreed.
  const rateBps = isSeller ? Math.max(0, Math.round(Number(ratePct) * 100)) : 0;
  const quote = quoteInstalments(totalPrice, rateBps, count);

  return (
    <div className="mt-2 w-full rounded border border-line bg-panel-2 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Payments</span>
          <input
            type="number"
            min={INSTALMENT_MIN_WINDOWS}
            max={INSTALMENT_MAX_WINDOWS}
            value={count}
            onChange={(e) =>
              setCount(
                Math.min(INSTALMENT_MAX_WINDOWS, Math.max(INSTALMENT_MIN_WINDOWS, Math.round(Number(e.target.value) || 2))),
              )
            }
            className="num mt-1 w-20 rounded border border-line bg-bg px-2 py-1 text-right text-xs text-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Days apart</span>
          <input
            type="number"
            min={1}
            max={30}
            value={interval}
            onChange={(e) => setInterval(Math.min(30, Math.max(1, Math.round(Number(e.target.value) || 1))))}
            className="num mt-1 w-20 rounded border border-line bg-bg px-2 py-1 text-right text-xs text-ink focus:outline-none"
          />
        </label>
        {isSeller && (
          <label>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Your rate %
            </span>
            <input
              type="number"
              min={0}
              step="0.25"
              value={ratePct}
              onChange={(e) => setRatePct(e.target.value)}
              className="num mt-1 w-24 rounded border border-line bg-bg px-2 py-1 text-right text-xs text-ink focus:outline-none"
            />
          </label>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          Propose
        </button>
        <button onClick={() => setOpen(false)} className="tap px-2 py-1 text-[11px] text-ink-faint hover:text-ink">
          cancel
        </button>
      </div>
      <div className="mt-1.5 rounded border border-line bg-bg px-2 py-1.5 text-[11px] text-ink-faint">
        <div className="flex flex-wrap gap-x-4">
          <span>
            item <span className="num text-ink-dim">{fmtAuec(quote.principal)}</span>
          </span>
          <span>
            interest <span className="text-ink-dim">{formatRate(quote.effectiveRateBps)}</span>{" "}
            <span className="num text-ink-dim">+{fmtAuec(quote.interest)}</span>
          </span>
          <span className="font-bold">
            total <span className="num text-up">{fmtAuec(quote.total)}</span> aUEC
          </span>
        </div>
        <div className="mt-0.5">
          {quote.windows} payments of about{" "}
          <span className="num text-ink-dim">{fmtAuec(quote.schedule[quote.schedule.length - 1] ?? 0)}</span>, every{" "}
          {interval} days. The first carries the rounding.
        </div>
        {isSeller && quote.effectiveRateBps !== quote.baseRateBps && (
          <div className="mt-0.5">
            Your {formatRate(quote.baseRateBps)} covers {INSTALMENT_MIN_WINDOWS} windows; this schedule adds{" "}
            {formatRate(quote.effectiveRateBps - quote.baseRateBps)} for the extra time.
          </div>
        )}
        {!isSeller && (
          <div className="mt-0.5">
            You&apos;re proposing terms to the seller, so this carries no interest. They can decline
            and put up their own rate.
          </div>
        )}
        <div className="mt-0.5 text-ink-dim">The seller keeps the item until the last payment clears.</div>
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
