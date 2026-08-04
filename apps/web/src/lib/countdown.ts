/**
 * Human-readable clocks for listings, auctions and settlement windows.
 *
 * Rendered on the client and marked `suppressHydrationWarning` at the call sites: the
 * server's "3h left" and the browser's are computed seconds apart, and that difference is a
 * fact about time passing rather than a mismatch worth warning about.
 */

/** "4d left" / "3h left" / "12m left" / "expired". */
export function timeLeft(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m left`;
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

/** Bare duration with no suffix, for "closes in ⟨x⟩" phrasing. */
export function countdown(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** True inside the last hour — the UI paints these in the accent colour. */
export function isClosingSoon(iso: string | null): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms < 3_600_000;
}

export const fmtAuec = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
