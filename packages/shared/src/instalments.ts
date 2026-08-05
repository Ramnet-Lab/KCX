/**
 * Instalment pricing.
 *
 * One implementation, imported by the proposal form and by the server. A buyer must see the
 * exact figure they will owe before agreeing to it, and two copies of this arithmetic is how
 * the screen and the schedule end up disagreeing about what was agreed.
 *
 * Rates are held in BASIS POINTS — 500 = 5.00% — so nothing here touches a float. Money that
 * rounds differently depending on which side computed it is money someone will argue about.
 */

/** How much each extra payment window adds to the seller's rate. 200bp = 2%. */
export const INSTALMENT_RATE_STEP_BPS = 200;

/** The window count the seller's own rate applies to; beyond this the step compounds. */
export const INSTALMENT_BASE_WINDOWS = 2;

/**
 * Bounds on the schedule.
 *
 * These are NOT a policy on how much credit is reasonable — the seller decides that. The
 * ceiling exists because every window is a database row and a proposal asking for ten
 * thousand payments is a denial-of-service dressed as a purchase.
 */
export const INSTALMENT_MIN_WINDOWS = 2;
export const INSTALMENT_MAX_WINDOWS = 24;
export const INSTALMENT_MAX_RATE_BPS = 100_000; // 1000%, i.e. effectively uncapped

/**
 * The rate actually charged, given the seller's demanded rate and the number of windows.
 *
 * Two windows is the seller's rate as advertised. Each window after that adds the step, so
 * a longer schedule costs more — which is the point: the seller is waiting longer for their
 * money and carrying the item off the market while they do.
 */
export function effectiveRateBps(baseRateBps: number, windows: number): number {
  const extra = Math.max(0, windows - INSTALMENT_BASE_WINDOWS);
  return Math.max(0, baseRateBps) + extra * INSTALMENT_RATE_STEP_BPS;
}

export type InstalmentQuote = {
  principal: number;
  baseRateBps: number;
  effectiveRateBps: number;
  interest: number;
  total: number;
  windows: number;
  /** Every payment, in order. The first carries the rounding. */
  schedule: number[];
};

/**
 * Price a schedule.
 *
 * Interest is computed on the principal once — simple, not compounding. A schedule that
 * compounds per window would make the headline rate a number nobody could check against
 * what they end up paying, and the whole reason the rate is advertised is so it can be
 * checked.
 *
 * Rounding lands on the FIRST payment, not the last: a buyer should not discover the final
 * instalment is the awkward one after they have already paid everything else.
 */
export function quoteInstalments(principal: number, baseRateBps: number, windows: number): InstalmentQuote {
  const n = Math.max(INSTALMENT_MIN_WINDOWS, Math.min(INSTALMENT_MAX_WINDOWS, Math.floor(windows)));
  const rate = effectiveRateBps(baseRateBps, n);
  const interest = Math.round((principal * rate) / 10_000);
  const total = principal + interest;

  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const schedule = Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));

  return { principal, baseRateBps: Math.max(0, baseRateBps), effectiveRateBps: rate, interest, total, windows: n, schedule };
}

/** "5.00%" — rates are quoted to two places because that is how they are stored. */
export function formatRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
