const auec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "8,349" — aUEC amounts are always whole numbers in the UI. */
export function fmtAuec(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) return "—";
  return auec.format(n);
}

export function fmtScu(value: number | null | undefined): string {
  if (value == null || value <= 0) return "—";
  return `${auec.format(value)} SCU`;
}

/** "3h ago" / "12m ago" — honest staleness display for crowdsourced data. */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
