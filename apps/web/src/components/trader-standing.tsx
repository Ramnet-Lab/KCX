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
