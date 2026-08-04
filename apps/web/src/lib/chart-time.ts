import { TickMarkType, type Time } from "lightweight-charts";

/**
 * lightweight-charts renders its time axis in UTC by default, which makes every candle
 * read hours away from the viewer's wall clock. Our buckets are deliberately UTC-aligned
 * (stable keys across environments), so the fix belongs in the display layer only.
 *
 * Intraday marks render in the viewer's LOCAL timezone — "when did this happen to me".
 * Daily marks keep their UTC date, because that date IS the bucket's identity; shifting
 * it locally would relabel a UTC-Aug-4 bar as Aug 3.
 */

const toDate = (time: Time) => new Date((time as number) * 1000);

/** Axis ticks for intraday series (hourly candles, 30-min index captures, portfolio). */
export function localTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  const d = toDate(time);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    case TickMarkType.DayOfMonth:
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    default:
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
}

/** Crosshair/tooltip label for intraday series — full local date and time. */
export function localTimeFormatter(time: Time): string {
  return toDate(time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Axis ticks for daily candles — the bucket's own UTC date. */
export function utcDateTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  const d = toDate(time);
  if (tickMarkType === TickMarkType.Year) return String(d.getUTCFullYear());
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Crosshair label for daily candles. */
export function utcDateFormatter(time: Time): string {
  return `${toDate(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} (UTC day)`;
}

/** Short label naming the timezone the axis is currently showing. */
export function localZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "local";
  } catch {
    return "local";
  }
}
