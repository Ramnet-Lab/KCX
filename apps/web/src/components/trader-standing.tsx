"use client";

/**
 * A trader's standing, shown as two independent signals rather than one blended score.
 *
 * "9/10 met" is what actually happened; "★4.6" is how counterparties felt about it. A
 * single number would hide the difference between someone unreliable and someone merely
 * brusque — and on an exchange where settlement happens off-platform, reliability is the
 * thing a counterparty needs to judge before committing cargo.
 */
export function TraderStanding({
  settled,
  entered,
  completionPct,
  stars,
  ratingCount,
  compact = false,
}: {
  settled: number;
  entered: number;
  completionPct: number | null;
  stars: number | null;
  ratingCount: number;
  compact?: boolean;
}) {
  const isNew = entered === 0 && ratingCount === 0;
  if (isNew) {
    return (
      <span className="text-[10px] text-ink-faint" title="No completed contracts yet">
        new trader
      </span>
    );
  }

  // Below 70% is worth flagging: it means roughly a third of their contracts fell through.
  const pctColor =
    completionPct == null
      ? "text-ink-faint"
      : completionPct >= 90
        ? "text-up"
        : completionPct >= 70
          ? "text-ink-dim"
          : "text-down";

  return (
    <span className={`flex items-center gap-1.5 ${compact ? "text-[10px]" : "text-xs"}`}>
      {entered > 0 && (
        <span className={`num ${pctColor}`} title={`${settled} of ${entered} contracts settled`}>
          {settled}/{entered} met
        </span>
      )}
      {stars != null && (
        <span className="text-accent" title={`${stars.toFixed(2)} from ${ratingCount} rating${ratingCount === 1 ? "" : "s"}`}>
          ★{stars.toFixed(1)}
          <span className="text-ink-faint"> ({ratingCount})</span>
        </span>
      )}
    </span>
  );
}

/**
 * Contract standing: reliability, rating, and breaches — three separate facts.
 *
 * The breach count is deliberately not folded into the stars. A rating says someone was slow
 * or awkward; a breach says they couldn't be trusted with something confidential, and that is
 * not the kind of thing an average should be able to wash out.
 */
export function ContractStandingBadge({
  completed,
  undertaken,
  completionPct,
  stars,
  ratingCount,
  breaches,
  breachesDisputed,
  compact = false,
}: {
  completed: number;
  undertaken: number;
  completionPct: number | null;
  stars: number | null;
  ratingCount: number;
  breaches: number;
  breachesDisputed: number;
  compact?: boolean;
}) {
  const isNew = undertaken === 0 && ratingCount === 0 && breaches === 0;
  if (isNew) {
    return (
      <span className="text-[10px] text-ink-faint" title="No contracts completed yet">
        no contract history
      </span>
    );
  }

  const pctColor =
    completionPct == null
      ? "text-ink-faint"
      : completionPct >= 90
        ? "text-up"
        : completionPct >= 70
          ? "text-ink-dim"
          : "text-down";

  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${compact ? "text-[10px]" : "text-xs"}`}>
      {undertaken > 0 && (
        <span className={`num ${pctColor}`} title={`${completed} of ${undertaken} contracts completed`}>
          {completed}/{undertaken} done
        </span>
      )}
      {stars != null && (
        <span
          className="text-accent"
          title={`${stars.toFixed(2)} from ${ratingCount} rating${ratingCount === 1 ? "" : "s"}`}
        >
          ★{stars.toFixed(1)}
          <span className="text-ink-faint"> ({ratingCount})</span>
        </span>
      )}
      {breaches > 0 && (
        <span
          className="num rounded bg-danger/15 px-1 py-0.5 font-bold text-danger"
          title={
            `${breaches} recorded breach${breaches === 1 ? "" : "es"} of a classified contract's conditions of access` +
            (breachesDisputed > 0 ? ` — ${breachesDisputed} contested by them` : "")
          }
        >
          ▩ {breaches} breach{breaches === 1 ? "" : "es"}
          {breachesDisputed > 0 && <span className="font-normal text-ink-faint"> ({breachesDisputed} contested)</span>}
        </span>
      )}
    </span>
  );
}

/** Read-only star row, used inside the rating form. */
export function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={`tap px-1 text-lg leading-none transition-colors ${
            n <= value ? "text-accent" : "text-ink-faint hover:text-ink-dim"
          } disabled:opacity-50`}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </span>
  );
}
