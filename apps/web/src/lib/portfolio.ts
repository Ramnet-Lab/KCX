/**
 * Client-side portfolio: manually-entered holdings + aUEC balance, valued live against
 * market prices. localStorage until accounts exist (M5) — then synced server-side.
 * (Local game files don't expose wallet/inventory; an optional Game.log companion
 * importer is a possible post-v1 enhancement.)
 */

/** `avgCost` = weighted average aUEC/SCU paid; optional, unlocks unrealized P/L. */
export type Holding = { commodityId: number; scu: number; avgCost?: number };
export type Portfolio = { auec: number; holdings: Holding[] };

const KEY = "kcx.portfolio.v1";

export function loadPortfolio(): Portfolio {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { auec: 0, holdings: [] };
    const p = JSON.parse(raw) as Portfolio;
    if (typeof p !== "object" || p === null) return { auec: 0, holdings: [] };
    return {
      auec: typeof p.auec === "number" && Number.isFinite(p.auec) ? p.auec : 0,
      holdings: Array.isArray(p.holdings)
        ? p.holdings
            .filter((h) => typeof h?.commodityId === "number" && typeof h?.scu === "number" && h.scu > 0)
            .map((h) => ({
              commodityId: h.commodityId,
              scu: h.scu,
              ...(typeof h.avgCost === "number" && h.avgCost > 0 ? { avgCost: h.avgCost } : {}),
            }))
        : [],
    };
  } catch {
    return { auec: 0, holdings: [] };
  }
}

export function savePortfolio(p: Portfolio): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — portfolio just won't persist */
  }
}

/**
 * True account-value history, recorded forward from live ticker updates (one point per
 * market capture, deduped to 30-min buckets, capped). Not charted yet — it accumulates so
 * the chart can switch from retroactive valuation to genuine recorded history, and it
 * migrates to the account at M5.
 */
export type HistoryPoint = { t: number; total: number };

const HISTORY_KEY = "kcx.portfolio.history.v1";
const HISTORY_CAP = 5000;
const BUCKET_SECONDS = 1800;

export function loadPortfolioHistory(): HistoryPoint[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? (JSON.parse(raw) as HistoryPoint[]) : [];
    return Array.isArray(arr) ? arr.filter((p) => typeof p?.t === "number" && typeof p?.total === "number") : [];
  } catch {
    return [];
  }
}

export function recordPortfolioHistoryPoint(t: number, total: number): void {
  try {
    const bucket = Math.floor(t / BUCKET_SECONDS) * BUCKET_SECONDS;
    const history = loadPortfolioHistory();
    const last = history[history.length - 1];
    if (last && Math.floor(last.t / BUCKET_SECONDS) * BUCKET_SECONDS === bucket) {
      last.t = t;
      last.total = total;
    } else {
      history.push({ t, total });
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_CAP)));
  } catch {
    /* best-effort */
  }
}
