"use client";

import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  localTickMarkFormatter,
  localTimeFormatter,
  useLocalZoneLabel,
  utcDateFormatter,
  utcDateTickMarkFormatter,
} from "@/lib/chart-time";
import { useMarketFeed } from "@/lib/use-market-feed";

export type CandlePoint = {
  /** epoch seconds */
  time: number;
  /** KCX mark OHLC — the NPC seed until this commodity's first fill, player-driven after. */
  mktOpen: number | null;
  mktHigh: number | null;
  mktLow: number | null;
  mktClose: number | null;
  /** NPC reference lines, polled every 30 minutes for context. */
  sellClose: number | null;
  buyClose: number | null;
};

type Props = {
  commodityId: number;
  candles1h: CandlePoint[];
  candles1d: CandlePoint[];
  wsUrl: string;
};

/** Replace same-bucket points and append new ones, keeping the series time-ordered. */
function mergeCandles(existing: CandlePoint[], fresh: CandlePoint[]): CandlePoint[] {
  if (fresh.length === 0) return existing;
  const byTime = new Map(existing.map((c) => [c.time, c]));
  for (const c of fresh) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Commodity chart: candlesticks are the KCX mark, the dashed line is the NPC sell-to
 * baseline, the gold line is the cheapest NPC buy-from.
 *
 * Live: a confirmed fill writes a reference point immediately (see market-point.ts), so the
 * bucket this trade belongs to changes the moment it settles. The chart repaints just the
 * affected buckets rather than remounting — remounting, or a router.refresh(), would reset
 * the viewer's pan and zoom every time anyone anywhere traded this commodity.
 */
export function ReferenceChart({ commodityId, candles1h, candles1d, wsUrl }: Props) {
  const [period, setPeriod] = useState<"1h" | "1d">("1h");
  const [hourly, setHourly] = useState<CandlePoint[]>(candles1h);
  const [daily, setDaily] = useState<CandlePoint[]>(candles1d);
  const [movedAt, setMovedAt] = useState<string | null>(null);
  const zoneLabel = useLocalZoneLabel();

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const baselineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const buyRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fittedRef = useRef(false);

  // A fresh server render (navigating between commodities) replaces the live series.
  useEffect(() => setHourly(candles1h), [candles1h]);
  useEffect(() => setDaily(candles1d), [candles1d]);

  const data = period === "1h" ? hourly : daily;
  const hasData = data.length >= 1;

  const pullTail = useCallback(async () => {
    // Both periods, so switching to 1D after a fill doesn't show a stale bucket. Each is a
    // three-row query against the candles primary key.
    const load = async (p: "1h" | "1d") => {
      const res = await fetch(`/api/candles?commodityId=${commodityId}&period=${p}&limit=3`, {
        cache: "no-store",
      });
      if (!res.ok) return [] as CandlePoint[];
      const body = (await res.json()) as { candles: CandlePoint[] };
      return body.candles ?? [];
    };
    const [fresh1h, fresh1d] = await Promise.all([load("1h"), load("1d")]);
    setHourly((prev) => mergeCandles(prev, fresh1h));
    setDaily((prev) => mergeCandles(prev, fresh1d));
    setMovedAt(new Date().toISOString());
  }, [commodityId]);

  useMarketFeed(wsUrl, (update) => {
    // A null update is a reconnect — re-sync regardless, since we may have missed events.
    if (update && !(update.priceMoved && update.commodityId === commodityId)) return;
    void pullTail().catch(() => {
      /* the next poll or a reload will heal it */
    });
  });

  // Chart lifecycle — recreated only when the period changes, because the axis formatters
  // and time visibility are baked in at construction.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b96a8",
        fontFamily: "ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "#1a2230" },
        horzLines: { color: "#1a2230" },
      },
      rightPriceScale: { borderColor: "#232c3b" },
      timeScale: {
        borderColor: "#232c3b",
        timeVisible: period === "1h",
        secondsVisible: false,
        // Without this the axis renders UTC and reads hours off the viewer's clock.
        tickMarkFormatter: period === "1h" ? localTickMarkFormatter : utcDateTickMarkFormatter,
      },
      localization: { timeFormatter: period === "1h" ? localTimeFormatter : utcDateFormatter },
      // Let a vertical drag scroll the PAGE, not the chart — otherwise the chart traps the finger.
      handleScroll: { vertTouchDrag: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;
    fittedRef.current = false;

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#4ade80",
      downColor: "#f87171",
      borderUpColor: "#4ade80",
      borderDownColor: "#f87171",
      wickUpColor: "#4ade80",
      wickDownColor: "#f87171",
    });
    // NPC reference: where the market sits when no player has traded.
    baselineRef.current = chart.addSeries(LineSeries, {
      color: "#8b96a8",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    buyRef.current = chart.addSeries(LineSeries, {
      color: "#e8b449",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const resize = () => chart.applyOptions({ width: el.clientWidth });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      baselineRef.current = null;
      buyRef.current = null;
    };
    // `hasData` gates whether the container is in the DOM at all, so the chart has to be
    // built once history first arrives — otherwise a commodity that starts empty never
    // renders a chart, even after the poller fills it in.
  }, [period, hasData]);

  // Data — setData rather than a remount, so the visible range survives an update.
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles || !baselineRef.current || !buyRef.current) return;

    candles.setData(
      data
        .filter((c) => c.mktOpen != null && c.mktHigh != null && c.mktLow != null && c.mktClose != null)
        .map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.mktOpen!,
          high: c.mktHigh!,
          low: c.mktLow!,
          close: c.mktClose!,
        })),
    );
    baselineRef.current.setData(
      data.filter((c) => c.sellClose != null).map((c) => ({ time: c.time as UTCTimestamp, value: c.sellClose! })),
    );
    buyRef.current.setData(
      data.filter((c) => c.buyClose != null).map((c) => ({ time: c.time as UTCTimestamp, value: c.buyClose! })),
    );

    // Only on first paint for this period — refitting on every live update would yank the
    // view back whenever someone traded.
    if (!fittedRef.current && data.length > 0) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [data]);

  return (
    <div className="mb-6 rounded border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-dim">
          <span className="text-up">KCX mark</span> · <span className="text-ink-dim">NPC baseline</span> ·{" "}
          <span className="text-accent">cheapest buy-from</span>
        </span>
        <span className="ml-auto text-[10px] text-ink-faint">
          {movedAt ? `moved ${new Date(movedAt).toLocaleTimeString()}` : period === "1h" ? (zoneLabel ? `times in ${zoneLabel}` : "") : "UTC days"}
        </span>
        <div className="flex gap-1">
          {(["1h", "1d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`tap rounded px-3 py-1.5 text-xs ${
                period === p ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <div ref={containerRef} className="chart-surface w-full" />
      ) : (
        <div className="flex h-40 items-center justify-center text-xs text-ink-faint">
          Price history accumulates while the poller runs — check back in a few hours.
        </div>
      )}
    </div>
  );
}
