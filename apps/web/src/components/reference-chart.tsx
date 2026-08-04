"use client";

import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import {
  localTickMarkFormatter,
  localTimeFormatter,
  localZoneLabel,
  utcDateFormatter,
  utcDateTickMarkFormatter,
} from "@/lib/chart-time";

export type CandlePoint = {
  /** epoch seconds */
  time: number;
  /** KCX mark OHLC — baseline until players fill orders, then driven by print VWAP. */
  mktOpen: number | null;
  mktHigh: number | null;
  mktLow: number | null;
  mktClose: number | null;
  /** NPC reference lines for context. */
  sellClose: number | null;
  buyClose: number | null;
};

type Props = {
  candles1h: CandlePoint[];
  candles1d: CandlePoint[];
};

/**
 * NPC-baseline chart: candlesticks = best sell-to payout across terminals,
 * line = cheapest buy-from. Thin wrapper owning the lightweight-charts lifecycle.
 */
export function ReferenceChart({ candles1h, candles1d }: Props) {
  const [period, setPeriod] = useState<"1h" | "1d">("1h");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const data = period === "1h" ? candles1h : candles1d;

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

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#4ade80",
      downColor: "#f87171",
      borderUpColor: "#4ade80",
      borderDownColor: "#f87171",
      wickUpColor: "#4ade80",
      wickDownColor: "#f87171",
    });
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

    // NPC reference: where the market sits when no player has traded.
    const baselineLine = chart.addSeries(LineSeries, {
      color: "#8b96a8",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    baselineLine.setData(
      data
        .filter((c) => c.sellClose != null)
        .map((c) => ({ time: c.time as UTCTimestamp, value: c.sellClose! })),
    );

    const buyLine = chart.addSeries(LineSeries, {
      color: "#e8b449",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    buyLine.setData(
      data
        .filter((c) => c.buyClose != null)
        .map((c) => ({ time: c.time as UTCTimestamp, value: c.buyClose! })),
    );

    chart.timeScale().fitContent();

    const resize = () => chart.applyOptions({ width: el.clientWidth });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, period]);

  const hasData = data.length >= 1;

  return (
    <div className="mb-6 rounded border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-dim">
          <span className="text-up">KCX mark</span> · <span className="text-ink-dim">NPC baseline</span> ·{" "}
          <span className="text-accent">cheapest buy-from</span>
        </span>
        <span className="ml-auto text-[10px] text-ink-faint">
          {period === "1h" ? `times in ${localZoneLabel()}` : "UTC days"}
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
