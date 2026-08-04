"use client";

import type { PriceAlertDto, WatchEntryDto } from "@kcx/db";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtAuec } from "@/lib/countdown";

/**
 * The watchlist and its alert feed.
 *
 * Everything here compares against SETTLED prices — a commodity's mark, or an item's last
 * confirmed sale. A tempting asking price never triggers anything, because nobody paid it,
 * and an alert that fired on a listing somebody posted and never honoured would be worse
 * than no alert at all.
 */
export function WatchlistPanel({
  entries: initial,
  alerts: initialAlerts,
}: {
  entries: WatchEntryDto[];
  alerts: PriceAlertDto[];
}) {
  const [entries, setEntries] = useState(initial);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [busy, setBusy] = useState<number | null>(null);
  const router = useRouter();

  const unread = alerts.filter((a) => !a.read);

  // Opening the tab is what "seeing" the alerts means, so clear the badge on mount rather
  // than making someone dismiss a list they are already looking at.
  useEffect(() => {
    if (unread.length === 0) return;
    void fetch("/api/alerts", { method: "POST" }).then(() => {
      setAlerts((a) => a.map((x) => ({ ...x, read: true })));
      router.refresh();
    });
    // Deliberately mount-only: re-running on every alert change would re-POST forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id: number) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setEntries((e) => e.filter((x) => x.id !== id));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {unread.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-accent">
            New since you last looked <span className="num">{unread.length}</span>
          </h2>
          <div className="space-y-1">
            {unread.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="flex flex-wrap items-baseline gap-x-2 rounded border border-accent/40 bg-accent/5 p-2 text-xs hover:border-accent"
              >
                <span className="font-bold text-ink">{a.label}</span>
                <span className="num text-up">{fmtAuec(a.price)} aUEC</span>
                <span className="text-ink-faint">
                  {a.direction === "below" ? "at or under" : a.direction === "above" ? "at or over" : "moved off"}{" "}
                  <span className="num">{fmtAuec(a.threshold)}</span>
                </span>
                <span className="ml-auto text-[11px] text-ink-faint" suppressHydrationWarning>
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
          Watching <span className="num text-ink-dim">{entries.length}</span>
        </h2>
        {entries.length === 0 ? (
          <div className="rounded border border-dashed border-line p-8 text-center text-sm text-ink-faint">
            <p className="mb-1 text-ink">Nothing on the watchlist.</p>
            <p>
              Add a commodity from its page, or an item from the{" "}
              <Link href="/bazaar" className="text-accent hover:underline">
                bazaar
              </Link>
              , and set a price you want to hear about.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((e) => (
              <article key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line bg-panel p-2.5">
                <Link href={e.href} className="min-w-40 flex-1 text-sm font-bold text-ink hover:text-accent">
                  {e.label}
                </Link>

                <span className="num text-sm text-ink-dim">
                  {e.hasPrice ? (
                    `${fmtAuec(e.price!)} aUEC`
                  ) : (
                    <span className="text-[11px] text-ink-faint">nothing settled yet</span>
                  )}
                </span>

                {e.threshold != null ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      e.triggeredAt ? "bg-accent/20 text-accent" : "bg-panel-2 text-ink-faint"
                    }`}
                    title={
                      e.triggeredAt
                        ? `Fired at ${fmtAuec(e.triggeredPrice ?? 0)} — re-arms when the price crosses back`
                        : "Armed"
                    }
                  >
                    {e.direction === "below" ? "≤" : e.direction === "above" ? "≥" : "≠"} {fmtAuec(e.threshold)}
                    {e.triggeredAt && " · fired"}
                  </span>
                ) : (
                  <span className="text-[10px] text-ink-faint">no alert</span>
                )}

                {e.note && <span className="text-[11px] text-ink-faint">{e.note}</span>}

                <button
                  onClick={() => remove(e.id)}
                  disabled={busy === e.id}
                  className="tap rounded border border-line px-2 py-0.5 text-[11px] text-ink-faint hover:text-danger disabled:opacity-40"
                >
                  remove
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-ink-faint">
        Alerts compare against settled prices only — a commodity&apos;s mark, or an item&apos;s last
        confirmed sale. An asking price nobody paid never triggers one. A fired alert re-arms
        itself once the price crosses back, so it works next time too.
      </p>
    </div>
  );
}

/**
 * The watch control on a commodity or item page.
 *
 * The threshold is optional on purpose. A watchlist that can only hold alarms becomes a list
 * of alarms, and people stop adding things to it — so "just keep an eye on this" is a valid
 * and one-click state.
 */
export function WatchButton({
  commodityId,
  itemId,
  label,
  existing,
}: {
  commodityId?: number;
  itemId?: number;
  label: string;
  existing?: { id: number; threshold: number | null; direction: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [threshold, setThreshold] = useState(existing?.threshold ? String(existing.threshold) : "");
  const [direction, setDirection] = useState(existing?.direction ?? "below");
  const [saved, setSaved] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const save = async (withThreshold: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(commodityId != null ? { commodityId } : { itemId }),
          threshold: withThreshold && Number(threshold) > 0 ? Math.round(Number(threshold)) : null,
          direction,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save that");
        return;
      }
      setSaved(true);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => (saved ? setOpen((v) => !v) : save(false))}
        disabled={busy}
        title={saved ? "Change the alert" : `Watch ${label}`}
        className={`tap rounded border px-2 py-1 text-xs disabled:opacity-40 ${
          saved ? "border-accent/60 text-accent" : "border-line text-ink-dim hover:text-ink"
        }`}
      >
        {saved ? "★ watching" : "☆ watch"}
      </button>

      {open && (
        <span className="flex flex-wrap items-end gap-2 rounded border border-line bg-panel-2 p-2">
          <label>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Tell me when it settles
            </span>
            <span className="mt-1 flex gap-1">
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                aria-label="Direction"
                className="rounded border border-line bg-bg px-1.5 py-1 text-xs text-ink focus:outline-none"
              >
                <option value="below">at or under</option>
                <option value="above">at or over</option>
                <option value="any">away from</option>
              </select>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="aUEC"
                className="num w-28 rounded border border-line bg-bg px-2 py-1 text-right text-xs text-ink focus:outline-none"
              />
            </span>
          </label>
          <button
            onClick={() => save(true)}
            disabled={busy}
            className="tap rounded bg-accent/20 px-2 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            Set
          </button>
          <button
            onClick={() => save(false)}
            disabled={busy}
            title="Keep watching, but stop alerting"
            className="tap rounded border border-line px-2 py-1 text-[11px] text-ink-faint hover:text-ink disabled:opacity-40"
          >
            no alert
          </button>
          {error && <span className="w-full text-[11px] text-danger">{error}</span>}
        </span>
      )}
    </span>
  );
}
