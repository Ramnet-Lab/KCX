"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMPOSITE_SECTOR,
  SECTORS,
  type IndexLatest,
  type IndexSeries,
  type SectorCode,
  type TickerEntry,
} from "@kcx/shared";
import { localTickMarkFormatter, localTimeFormatter, localZoneLabel } from "@/lib/chart-time";
import { loadPortfolio, savePortfolio, type Portfolio } from "@/lib/portfolio";

export type PlaceOrderSeed = {
  commodityId?: number;
  side?: "buy" | "sell";
  quantityScu?: number;
  pricePerScu?: number;
};

type Props = {
  series: IndexSeries;
  latest: IndexLatest[];
  /** ISO time of the latest broadcast — timestamps live chart appends. */
  latestAt: string | null;
  entries: TickerEntry[];
  onPlaceOrder: (seed: PlaceOrderSeed) => void;
};

const fmtIdx = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtAuec = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Top-of-page panel: sector index chart (market tab) + portfolio valuation tab. */
export function IndexPanel({ series, latest, latestAt, entries, onPlaceOrder }: Props) {
  const [tab, setTab] = useState<"market" | "portfolio">("market");
  const [sector, setSector] = useState<SectorCode>(COMPOSITE_SECTOR);

  const latestBySector = useMemo(() => new Map(latest.map((l) => [l.sector, l])), [latest]);
  const sectorsWithData = SECTORS.filter((s) => (series[s.code]?.length ?? 0) > 0 || latestBySector.has(s.code));

  const points = series[sector] ?? [];
  const current = latestBySector.get(sector)?.value ?? points[points.length - 1]?.value ?? null;
  const first = points[0]?.value ?? null;
  const changePct = current != null && first != null && first > 0 ? ((current - first) / first) * 100 : null;

  return (
    <div className="mb-6 rounded border border-line bg-panel">
      <div className="flex items-center gap-1 border-b border-line px-3 pt-2">
        <button
          onClick={() => setTab("market")}
          className={`rounded-t px-3 py-1.5 text-xs font-bold ${tab === "market" ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"}`}
        >
          Market
        </button>
        <button
          onClick={() => setTab("portfolio")}
          className={`rounded-t px-3 py-1.5 text-xs font-bold ${tab === "portfolio" ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"}`}
        >
          Portfolio
        </button>
        {tab === "market" && (
          <span className="ml-auto pb-1 text-right">
            <span className="num text-lg text-ink">{current != null ? fmtIdx(current) : "—"}</span>
            {changePct != null && (
              <span className={`num ml-2 text-xs ${changePct >= 0 ? "text-up" : "text-down"}`}>
                {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
              </span>
            )}
          </span>
        )}
      </div>

      {tab === "market" ? (
        <div className="p-3">
          <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
            {sectorsWithData.map((s) => (
              <button
                key={s.code}
                onClick={() => setSector(s.code)}
                className={`tap rounded-full border px-3 py-1.5 ${
                  sector === s.code ? "border-accent text-accent" : "border-line text-ink-dim hover:text-ink"
                }`}
                title={`${s.name} · ${latestBySector.get(s.code)?.constituents ?? "?"} constituents`}
              >
                <span className="font-bold">{s.code}</span> {s.name}
              </button>
            ))}
          </div>
          <IndexChart points={points} latest={latestBySector.get(sector) ?? null} latestAt={latestAt} />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Base-1000, equal-weight vs each commodity&apos;s first-seen baseline, tracking the KCX
            mark — so player fills move it, not just NPC prices. Times shown in {localZoneLabel()}.
          </p>
        </div>
      ) : (
        <PortfolioTab entries={entries} onPlaceOrder={onPlaceOrder} />
      )}
    </div>
  );
}

function IndexChart({
  points,
  latest,
  latestAt,
}: {
  points: { time: number; value: number }[];
  latest: IndexLatest | null;
  latestAt: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b96a8",
        fontFamily: "ui-monospace, monospace",
      },
      grid: { vertLines: { color: "#1a2230" }, horzLines: { color: "#1a2230" } },
      rightPriceScale: { borderColor: "#232c3b" },
      timeScale: {
        borderColor: "#232c3b",
        timeVisible: true,
        secondsVisible: false,
        // Render the viewer's local clock, not UTC (lightweight-charts' default).
        tickMarkFormatter: localTickMarkFormatter,
      },
      localization: { timeFormatter: localTimeFormatter },
      // Let a vertical drag scroll the PAGE, not the chart — otherwise the chart traps the finger.
      handleScroll: { vertTouchDrag: false },
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: "#e8b449",
      topColor: "rgba(232, 180, 73, 0.25)",
      bottomColor: "rgba(232, 180, 73, 0.02)",
      lineWidth: 2,
    });
    area.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    lastTimeRef.current = points[points.length - 1]?.time ?? 0;
    chart.timeScale().fitContent();
    chartRef.current = chart;
    seriesRef.current = area;

    const resize = () => chart.applyOptions({ width: el.clientWidth });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // Live append from broadcasts, without rebuilding the chart.
  useEffect(() => {
    if (!seriesRef.current || !latest || !latestAt) return;
    const t = Math.floor(new Date(latestAt).getTime() / 1000);
    if (t > lastTimeRef.current) {
      seriesRef.current.update({ time: t as UTCTimestamp, value: latest.value });
      lastTimeRef.current = t;
    }
  }, [latest, latestAt]);

  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-ink-faint">
        Index history accumulates while the poller runs.
      </div>
    );
  }
  return <div ref={containerRef} className="chart-surface w-full" />;
}

/** Minimal area chart for the portfolio value line (no live-append machinery needed). */
function AreaTimeChart({ points, color }: { points: { time: number; value: number }[]; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      height: 200,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b96a8",
        fontFamily: "ui-monospace, monospace",
      },
      grid: { vertLines: { color: "#1a2230" }, horzLines: { color: "#1a2230" } },
      rightPriceScale: { borderColor: "#232c3b" },
      timeScale: {
        borderColor: "#232c3b",
        timeVisible: true,
        secondsVisible: false,
        // Render the viewer's local clock, not UTC (lightweight-charts' default).
        tickMarkFormatter: localTickMarkFormatter,
      },
      localization: { timeFormatter: localTimeFormatter },
      // Let a vertical drag scroll the PAGE, not the chart — otherwise the chart traps the finger.
      handleScroll: { vertTouchDrag: false },
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}40`,
      bottomColor: `${color}05`,
      lineWidth: 2,
    });
    area.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    chart.timeScale().fitContent();
    const resize = () => chart.applyOptions({ width: el.clientWidth });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [points, color]);

  return <div ref={containerRef} className="chart-surface w-full" />;
}

function PortfolioTab({
  entries,
  onPlaceOrder,
}: {
  entries: TickerEntry[];
  onPlaceOrder: (seed: PlaceOrderSeed) => void;
}) {
  const [portfolio, setPortfolio] = useState<Portfolio>({ auec: 0, holdings: [] });
  const [pick, setPick] = useState("");
  const [scu, setScu] = useState("");
  const [cost, setCost] = useState("");
  const [histories, setHistories] = useState<Record<number, { t: number; v: number }[]>>({});
  // Hydration gate must be STATE, not a ref: a ref flips synchronously in the first
  // effect, letting the save-effect's initial run persist the empty default over the
  // stored data (guaranteed under StrictMode's double-invoked effects).
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // When signed in the SERVER holds the position — it's the collateral orders are checked
  // against, so the browser copy can't be authoritative. Local data seeds an empty account.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = loadPortfolio();
      try {
        const res = await fetch("/api/portfolio");
        const body = await res.json();
        if (cancelled) return;
        if (body.portfolio) {
          setSignedIn(true);
          const server = body.portfolio as { auec: number; holdings: { commodityId: number; scu: number; avgCost: number | null }[] };
          const serverEmpty = server.auec === 0 && server.holdings.length === 0;
          const localHasData = local.auec > 0 || local.holdings.length > 0;
          if (serverEmpty && localHasData) {
            await fetch("/api/portfolio", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(local),
            });
            setPortfolio(local);
          } else {
            setPortfolio({
              auec: server.auec,
              holdings: server.holdings.map((h) => ({
                commodityId: h.commodityId,
                scu: h.scu,
                ...(h.avgCost != null ? { avgCost: h.avgCost } : {}),
              })),
            });
          }
        } else {
          setPortfolio(local);
        }
      } catch {
        if (!cancelled) setPortfolio(local);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePortfolio(portfolio);
    if (!signedIn) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/portfolio", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            auec: Math.round(portfolio.auec),
            holdings: portfolio.holdings.map((h) => ({
              commodityId: h.commodityId,
              scu: Math.round(h.scu),
              avgCost: h.avgCost != null ? Math.round(h.avgCost) : null,
            })),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setSyncError(res.ok ? null : (body.error ?? "Could not save to your account"));
      } catch {
        setSyncError("Offline — changes saved locally only");
      }
    }, 700); // debounce: inline edits fire on every keystroke
    return () => clearTimeout(timer);
  }, [portfolio, hydrated, signedIn]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.commodityId, e])), [entries]);
  const byLabel = useMemo(() => new Map(entries.map((e) => [`${e.code} — ${e.name}`, e])), [entries]);

  // Price history for held commodities → retroactive value chart.
  const heldIds = useMemo(
    () => portfolio.holdings.map((h) => h.commodityId).sort((a, b) => a - b).join(","),
    [portfolio.holdings],
  );
  useEffect(() => {
    if (!heldIds) {
      setHistories({});
      return;
    }
    let cancelled = false;
    fetch(`/api/price-history?ids=${heldIds}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (!cancelled) setHistories(data as Record<number, { t: number; v: number }[]>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [heldIds]);

  const valueSeries = useMemo(() => {
    if (portfolio.holdings.length === 0) return [];
    // Union timeline with last-observation-carried-forward per commodity.
    const times = new Set<number>();
    for (const h of portfolio.holdings) for (const p of histories[h.commodityId] ?? []) times.add(p.t);
    const timeline = [...times].sort((a, b) => a - b);
    if (timeline.length === 0) return [];
    const cursors = new Map<number, { i: number; last: number | null }>(
      portfolio.holdings.map((h) => [h.commodityId, { i: 0, last: null }]),
    );
    const series: { time: number; value: number }[] = [];
    for (const t of timeline) {
      let holdingsValue = 0;
      let priced = 0;
      for (const h of portfolio.holdings) {
        const cur = cursors.get(h.commodityId)!;
        const pts = histories[h.commodityId] ?? [];
        while (cur.i < pts.length && pts[cur.i]!.t <= t) {
          cur.last = pts[cur.i]!.v;
          cur.i++;
        }
        if (cur.last != null) {
          holdingsValue += h.scu * cur.last;
          priced++;
        }
      }
      // Skip leading timestamps where nothing we hold has a price yet.
      if (priced > 0) series.push({ time: t, value: portfolio.auec + holdingsValue });
    }
    // End the line at "now" using live prices.
    const liveValue = portfolio.holdings.reduce((sum, h) => {
      const price = byId.get(h.commodityId)?.effectiveSell;
      return sum + (price != null ? h.scu * price : 0);
    }, 0);
    const nowT = Math.floor(Date.now() / 1000);
    if (series.length > 0 && nowT > series[series.length - 1]!.time) {
      series.push({ time: nowT, value: portfolio.auec + liveValue });
    }
    return series;
  }, [portfolio.holdings, portfolio.auec, histories, byId]);

  const rows = portfolio.holdings.map((h) => {
    const e = byId.get(h.commodityId);
    // Value holdings at what they'd actually fetch — player market if it beats the terminals.
    const price = e?.effectiveSell ?? null;
    const value = price != null ? h.scu * price : null;
    const prev = price != null && e?.change24hPct != null ? price / (1 + e.change24hPct / 100) : null;
    const delta = value != null && prev != null ? value - h.scu * prev : null;
    const cost = h.avgCost != null ? h.scu * h.avgCost : null;
    const pnl = value != null && cost != null ? value - cost : null;
    const pnlPct = pnl != null && cost != null && cost > 0 ? (pnl / cost) * 100 : null;
    return { holding: h, entry: e, price, value, delta, cost, pnl, pnlPct };
  });
  const holdingsValue = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const total = portfolio.auec + holdingsValue;
  const totalDelta = rows.reduce((sum, r) => sum + (r.delta ?? 0), 0);
  const totalCost = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const totalPnl = rows.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  const hasCostBasis = rows.some((r) => r.cost != null);

  const patchHolding = (commodityId: number, patch: Partial<(typeof portfolio.holdings)[number]>) =>
    setPortfolio((p) => ({
      ...p,
      holdings: p.holdings.map((h) => (h.commodityId === commodityId ? { ...h, ...patch } : h)),
    }));

  const addHolding = () => {
    const e = byLabel.get(pick);
    const n = Number(scu);
    if (!e || !Number.isFinite(n) || n <= 0) return;
    const paid = Number(cost);
    const paidValid = Number.isFinite(paid) && paid > 0;
    setPortfolio((p) => {
      const existing = p.holdings.find((h) => h.commodityId === e.commodityId);
      if (!existing) {
        return {
          ...p,
          holdings: [...p.holdings, { commodityId: e.commodityId, scu: n, ...(paidValid ? { avgCost: paid } : {}) }],
        };
      }
      // Merging into an existing lot: weight the cost basis by quantity, like a real average.
      const totalScu = existing.scu + n;
      let avgCost = existing.avgCost;
      if (paidValid && existing.avgCost != null) {
        avgCost = (existing.scu * existing.avgCost + n * paid) / totalScu;
      } else if (paidValid) {
        avgCost = paid;
      }
      return {
        ...p,
        holdings: p.holdings.map((h) =>
          h.commodityId === e.commodityId ? { ...h, scu: totalScu, ...(avgCost != null ? { avgCost } : {}) } : h,
        ),
      };
    });
    setPick("");
    setScu("");
    setCost("");
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total value</div>
          <div className="num text-2xl text-ink">{fmtAuec(total)} aUEC</div>
        </div>
        {totalDelta !== 0 && (
          <div className={`num text-sm ${totalDelta >= 0 ? "text-up" : "text-down"}`}>
            {totalDelta >= 0 ? "▲" : "▼"} {fmtAuec(Math.abs(totalDelta))} (24h)
          </div>
        )}
        {hasCostBasis && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Unrealized P/L</div>
            <div className={`num text-sm ${totalPnl >= 0 ? "text-up" : "text-down"}`}>
              {totalPnl >= 0 ? "+" : "−"}
              {fmtAuec(Math.abs(totalPnl))}
              {totalCost > 0 && ` (${totalPnl >= 0 ? "+" : "−"}${Math.abs((totalPnl / totalCost) * 100).toFixed(1)}%)`}
            </div>
          </div>
        )}
        <label className="ml-auto text-xs text-ink-dim">
          aUEC balance{" "}
          <input
            type="number" inputMode="numeric"
            min={0}
            value={portfolio.auec || ""}
            onChange={(e) => setPortfolio((p) => ({ ...p, auec: Math.max(0, Number(e.target.value) || 0) }))}
            placeholder="0"
            className="num ml-1 w-36 rounded border border-line bg-bg px-2 py-1 text-right text-ink focus:outline-none"
          />
        </label>
      </div>

      {syncError && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {syncError}
        </div>
      )}

      {valueSeries.length >= 2 && (
        <div className="mb-3">
          <AreaTimeChart points={valueSeries} color="#4ade80" />
          <p className="mt-1 text-[11px] text-ink-faint">
            Your current holdings + balance valued at historical market prices. True forward
            tracking records in the background and takes over as it accumulates; it moves to
            your account when logins arrive.
          </p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          list="kcx-commodity-picker"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          placeholder="Add holding: ticker or name…"
          className="w-64 rounded border border-line bg-bg px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <datalist id="kcx-commodity-picker">
          {entries.map((e) => (
            <option key={e.commodityId} value={`${e.code} — ${e.name}`} />
          ))}
        </datalist>
        <input
          type="number" inputMode="numeric"
          min={1}
          value={scu}
          onChange={(e) => setScu(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addHolding()}
          placeholder="SCU"
          className="num w-24 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
        />
        <input
          type="number" inputMode="numeric"
          min={0}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addHolding()}
          placeholder="paid /SCU"
          title="Optional: what you paid per SCU — unlocks profit/loss tracking"
          className="num w-28 rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button
          onClick={addHolding}
          className="rounded border border-line px-3 py-1 text-sm text-ink-dim hover:border-ink-faint hover:text-ink"
        >
          Add
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-line p-6 text-center text-xs text-ink-faint">
          No holdings yet. Add what&apos;s in your hangar — it&apos;s valued live at the best NPC payout
          (player-market pricing joins when the order board ships). Stored in this browser until
          accounts arrive.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="py-1.5 pr-3">Commodity</th>
                <th className="py-1.5 pr-3 text-right">SCU</th>
                <th className="py-1.5 pr-3 text-right">Paid /SCU</th>
                <th className="py-1.5 pr-3 text-right">Best sell</th>
                <th className="py-1.5 pr-3 text-right">Value</th>
                <th className="py-1.5 pr-3 text-right">P/L</th>
                <th className="py-1.5 pr-3 text-right">24h</th>
                <th className="py-1.5 pr-3 text-center">Trade</th>
                <th className="py-1.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ holding, entry, price, value, delta, pnl, pnlPct }) => (
                <tr key={holding.commodityId} className="border-b border-line/50">
                  <td className="py-1.5 pr-3 text-ink">
                    {entry ? entry.name : `#${holding.commodityId} (no longer traded)`}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input
                      type="number" inputMode="numeric"
                      min={0}
                      value={holding.scu}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0) patchHolding(holding.commodityId, { scu: n });
                      }}
                      aria-label={`SCU held of ${entry?.name ?? holding.commodityId}`}
                      className="num w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-ink-dim hover:border-line focus:border-ink-faint focus:outline-none"
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input
                      type="number" inputMode="numeric"
                      min={0}
                      value={holding.avgCost ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        const v = e.target.value;
                        const n = Number(v);
                        patchHolding(holding.commodityId, {
                          avgCost: v === "" || !Number.isFinite(n) || n <= 0 ? undefined : n,
                        });
                      }}
                      aria-label={`Average price paid per SCU for ${entry?.name ?? holding.commodityId}`}
                      className="num w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-ink-dim placeholder:text-ink-faint hover:border-line focus:border-ink-faint focus:outline-none"
                    />
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-ink-dim">{price != null ? fmtAuec(price) : "—"}</td>
                  <td className="num py-1.5 pr-3 text-right text-ink">{value != null ? fmtAuec(value) : "—"}</td>
                  <td
                    className={`num py-1.5 pr-3 text-right ${pnl == null ? "text-ink-faint" : pnl >= 0 ? "text-up" : "text-down"}`}
                    title={pnl == null ? "Enter what you paid per SCU to track profit/loss" : undefined}
                  >
                    {pnl == null
                      ? "—"
                      : `${pnl >= 0 ? "+" : "−"}${fmtAuec(Math.abs(pnl))}${pnlPct != null ? ` (${Math.abs(pnlPct).toFixed(1)}%)` : ""}`}
                  </td>
                  <td
                    className={`num py-1.5 pr-3 text-right ${delta == null ? "text-ink-faint" : delta >= 0 ? "text-up" : "text-down"}`}
                  >
                    {delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${fmtAuec(Math.abs(delta))}`}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="flex justify-center gap-1">
                      <button
                        onClick={() => onPlaceOrder({ commodityId: holding.commodityId, side: "buy" })}
                        title="Post a WTB order for more of this"
                        className="rounded bg-up/15 px-1.5 py-0.5 text-[10px] font-bold text-up hover:bg-up/25"
                      >
                        BUY
                      </button>
                      <button
                        onClick={() =>
                          onPlaceOrder({
                            commodityId: holding.commodityId,
                            side: "sell",
                            // Prefill the whole position — the common case is listing what you hold.
                            quantityScu: holding.scu,
                          })
                        }
                        title="Post a WTS order for this holding"
                        className="rounded bg-down/15 px-1.5 py-0.5 text-[10px] font-bold text-down hover:bg-down/25"
                      >
                        SELL
                      </button>
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() =>
                        setPortfolio((p) => ({
                          ...p,
                          holdings: p.holdings.filter((h) => h.commodityId !== holding.commodityId),
                        }))
                      }
                      className="text-ink-faint hover:text-danger"
                      title="Remove holding"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
