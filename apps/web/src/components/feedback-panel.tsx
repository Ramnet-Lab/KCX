"use client";

import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TITLE_MAX,
  type FeedbackKind,
  type FeedbackStatus,
} from "@kcx/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type MyRequest = {
  id: string;
  kind: FeedbackKind;
  title: string;
  status: FeedbackStatus;
  createdAt: string;
  respondedAt: string | null;
};

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  new: "bg-ink-faint/15 text-ink-dim",
  reviewing: "bg-accent/15 text-accent",
  planned: "bg-accent/15 text-accent",
  shipped: "bg-up/15 text-up",
  declined: "bg-ink-faint/15 text-ink-faint",
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * The suggestion box, beside the index chart on the front page.
 *
 * Deliberately on the main page rather than behind a "Feedback" link in the footer. The
 * things worth hearing about are the ones someone notices while using the site, and a form
 * they have to go looking for collects only the complaints stubborn enough to survive a
 * search. The cost is one column on a wide screen.
 *
 * Signed-in only, because every one of these gets answered into the author's inbox. Signed
 * out, the panel says what it is and points at sign-in rather than taking input it would
 * then have to throw away.
 *
 * The form lays itself out from the PANEL's width rather than the window's (`@container`),
 * because this thing lives in two very different shapes: a 19rem rail in the right margin
 * of a wide monitor, and a full-width block under the chart everywhere else. A media query
 * can't tell those apart — the window is wide in both cases.
 */
export function FeedbackPanel({ signedIn }: { signedIn: boolean }) {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<MyRequest[]>([]);

  const loadMine = useCallback(async () => {
    if (!signedIn) return;
    const res = await fetch("/api/feedback", { cache: "no-store" }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.requests) setMine(data.requests as MyRequest[]);
  }, [signedIn]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, title: title.trim(), body: body.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That didn't send");
        return;
      }
      setTitle("");
      setBody("");
      setSent(true);
      await loadMine();
    } catch {
      setError("That didn't send — check your connection");
    } finally {
      setBusy(false);
    }
  };

  const ready = title.trim().length >= 3 && body.trim().length >= 5;
  const answered = mine.filter((r) => r.respondedAt != null).length;

  return (
    <aside className="@container rounded border border-line bg-panel" aria-labelledby="ideas-heading">
      <div className="border-b border-line px-3 py-2">
        <h2 id="ideas-heading" className="text-xs font-bold uppercase tracking-wider text-accent">
          Ideas &amp; requests
        </h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          Something missing, or something broken? Say so here — it goes straight to the desk, and
          the answer comes back to your inbox.
        </p>
      </div>

      <div className="p-3">
        {!signedIn ? (
          <div className="text-xs text-ink-dim">
            <p className="mb-3 leading-relaxed">
              Sign in first. Every request gets a reply, and a reply needs somewhere to land.
            </p>
            <Link
              href="/signin"
              className="tap inline-block rounded border border-accent/60 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10"
            >
              Sign in
            </Link>
          </div>
        ) : sent ? (
          <div className="text-xs text-ink-dim">
            <p className="mb-1 font-bold text-up">Filed. Thank you.</p>
            <p className="mb-3 leading-relaxed">
              It sits in the review queue until someone gets to it. When there&apos;s an answer
              you&apos;ll see a mark on your name up top.
            </p>
            <button
              onClick={() => setSent(false)}
              className="tap rounded border border-line px-3 py-1.5 text-xs font-bold text-ink-dim hover:text-ink"
            >
              Send another
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Side by side once the panel is wide enough to hold both without cramping. */}
            <div className="space-y-2 @md:flex @md:gap-2 @md:space-y-0">
              <label className="block @md:w-48">
                <span className="text-[10px] uppercase tracking-wider text-ink-faint">Kind</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as FeedbackKind)}
                  className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink focus:outline-none"
                >
                  {FEEDBACK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FEEDBACK_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block @md:flex-1">
                <span className="text-[10px] uppercase tracking-wider text-ink-faint">In a line</span>
                <input
                  value={title}
                  maxLength={FEEDBACK_TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Show cargo capacity on the order board"
                  className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-ink-faint">Detail</span>
              <textarea
                value={body}
                maxLength={FEEDBACK_BODY_MAX}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="What you were doing, what you expected, and what would make it better."
                className="mt-1 w-full resize-y rounded border border-line bg-bg px-2 py-1.5 text-xs leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none @md:h-20"
              />
            </label>

            {error && (
              <p className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
                {error}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={submit}
                disabled={busy || !ready}
                className="tap rounded border border-accent/60 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {busy ? "Sending…" : "Send it"}
              </button>
              <span className="num text-[10px] text-ink-faint">
                {body.trim().length}/{FEEDBACK_BODY_MAX}
              </span>
            </div>
          </div>
        )}

        {signedIn && mine.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Yours{answered > 0 && <span className="ml-1 text-up">· {answered} answered</span>}
            </p>
            <ul className="space-y-1.5 @md:grid @md:grid-cols-2 @md:gap-x-4 @md:space-y-0 @2xl:grid-cols-3">
              {mine.slice(0, 6).map((r) => (
                <li key={r.id} className="py-0.5 text-[11px] leading-snug">
                  <span className="flex items-baseline gap-1.5">
                    <span className={`rounded px-1 py-px text-[9px] font-bold uppercase ${STATUS_CLASS[r.status]}`}>
                      {FEEDBACK_STATUS_LABELS[r.status]}
                    </span>
                    <span className="text-ink-faint">{fmtDate(r.createdAt)}</span>
                  </span>
                  <span className="mt-0.5 block text-ink-dim">{r.title}</span>
                  {r.respondedAt && (
                    <Link href="/account#inbox" className="text-[10px] text-accent hover:underline">
                      ✉ reply in your inbox
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
