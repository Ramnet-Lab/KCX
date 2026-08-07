"use client";

import type { InboxMessageDto } from "@kcx/db";
import { MESSAGE_KIND_LABELS } from "@kcx/shared";
import Link from "next/link";
import { useState } from "react";
import { refreshSession } from "@/components/session-bar";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The trader's inbox.
 *
 * Lives on the account page because that is where the name in the header goes, and the badge
 * on that name is what brings anyone here. A separate /inbox route would mean the badge
 * points at one page and the name at another.
 *
 * Reading is per message rather than the alert feed's mark-everything-at-once: an alert says
 * a number moved, and glancing at the list answers it. These were written to you by a person,
 * and having opened one says nothing about the other three.
 */
export function InboxPanel({ initial }: { initial: InboxMessageDto[] }) {
  const [messages, setMessages] = useState(initial);
  const [open, setOpen] = useState<string | null>(() => initial.find((m) => !m.read)?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unread = messages.filter((m) => !m.read).length;

  const markRead = async (id?: string) => {
    // Optimistic: the row is already open in front of them, so showing it as unread while a
    // request flies is the wrong kind of honest.
    setMessages((list) => list.map((m) => (id == null || m.id === id ? { ...m, read: true } : m)));
    const res = await fetch("/api/inbox", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { id } : {}),
    }).catch(() => null);
    if (!res?.ok) setError("Couldn't save that — it may show unread again on reload.");
    refreshSession();
  };

  const expand = (m: InboxMessageDto) => {
    const next = open === m.id ? null : m.id;
    setOpen(next);
    if (next && !m.read) void markRead(m.id);
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/inbox?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete that one.");
        return;
      }
      setMessages((list) => list.filter((m) => m.id !== id));
      refreshSession();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="inbox" className="mb-6 scroll-mt-4 rounded border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold text-ink">Inbox</h2>
        {unread > 0 && (
          <span className="num rounded-full bg-danger px-1.5 py-px text-[10px] font-bold leading-4 text-bg">
            {unread}
          </span>
        )}
        {unread > 0 && (
          <button onClick={() => void markRead()} className="tap ml-auto text-xs text-ink-faint hover:text-ink">
            mark all read
          </button>
        )}
      </div>

      {error && (
        <p className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">{error}</p>
      )}

      {messages.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-ink-faint">
          Nothing here. Replies to the ideas you send from the front page, and notes from the
          moderators, land in this box.
        </p>
      ) : (
        <ul>
          {messages.map((m) => (
            <li key={m.id} className={`border-b border-line/50 last:border-b-0 ${m.read ? "" : "bg-accent/5"}`}>
              <div className="flex items-start gap-2 px-4 py-2.5">
                <button
                  onClick={() => expand(m)}
                  aria-expanded={open === m.id}
                  className="flex-1 text-left"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    {!m.read && <span className="text-[10px] text-danger">●</span>}
                    <span className={`text-xs ${m.read ? "text-ink-dim" : "font-bold text-ink"}`}>{m.subject}</span>
                    <span className="text-[10px] text-ink-faint">
                      {MESSAGE_KIND_LABELS[m.kind] ?? "Message"}
                      {m.senderName && ` · ${m.senderName}`}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-[10px] text-ink-faint">
                      {fmtDate(m.createdAt)}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => void remove(m.id)}
                  disabled={busy === m.id}
                  title="Delete"
                  aria-label={`Delete "${m.subject}"`}
                  className="tap text-ink-faint hover:text-danger disabled:opacity-30"
                >
                  ×
                </button>
              </div>
              {open === m.id && (
                <div className="px-4 pb-3">
                  <p className="whitespace-pre-wrap rounded border border-line bg-panel-2 p-3 text-xs leading-relaxed text-ink-dim">
                    {m.body}
                  </p>
                  {m.href && !m.href.startsWith("/account") && (
                    <Link href={m.href} className="mt-1.5 inline-block text-[11px] text-accent hover:underline">
                      Take me there ↗
                    </Link>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
