"use client";

import type { OrgChannelDto } from "@kcx/db";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const MESSAGE_MAX = 4000;

/**
 * Inter-org correspondence.
 *
 * The bazaar's threads hang off a listing and connect two people. This connects two ORGS,
 * about nothing in particular — which is what inter-org work looks like before it becomes a
 * contract: "are you moving Quantanium through Pyro this week?"
 *
 * The channel belongs to the orgs, not to whoever opened it, so a president who hands over
 * leadership hands over the correspondence with it. Presidents only: a channel commits an
 * org to things before any contract exists, and "who may say we'll do that" needs one
 * answer rather than a committee.
 */
export function OrgChannelPanel({ orgId, openChannelId }: { orgId: string; openChannelId?: string | null }) {
  const [channels, setChannels] = useState<OrgChannelDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(openChannelId ?? null);
  const [thread, setThread] = useState<OrgChannelDto | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/orgs/channels?orgId=${orgId}`, { cache: "no-store" });
    const list = res.ok ? ((await res.json()).channels ?? []) : [];
    setChannels(list);
    setSelected((cur) => cur ?? list[0]?.id ?? null);
  }, [orgId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadThread = useCallback(async () => {
    if (!selected) return;
    const res = await fetch(`/api/orgs/channels/${selected}`, { cache: "no-store" });
    setThread(res.ok ? ((await res.json()).channel ?? null) : null);
  }, [selected]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const send = async () => {
    if (!selected || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/channels/${selected}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Could not send that");
        return;
      }
      setBody("");
      await loadThread();
      await loadList();
    } finally {
      setBusy(false);
    }
  };

  if (channels == null) return null;

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
        Org channels{" "}
        {channels.some((c) => c.unread) && (
          <span className="num text-accent">{channels.filter((c) => c.unread).length} new</span>
        )}
      </h2>

      {channels.length === 0 ? (
        <div className="rounded border border-dashed border-line p-6 text-center text-xs text-ink-faint">
          <p className="mb-1 text-ink">No channels open.</p>
          <p>
            Find another verified org in the{" "}
            <Link href="/orgs/directory" className="text-accent hover:underline">
              directory
            </Link>{" "}
            and contact them — it&apos;s where inter-org work starts before it becomes a contract.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {channels.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`tap flex w-full items-center gap-2 rounded border p-2 text-left ${
                  selected === c.id ? "border-accent/60 bg-panel-2" : "border-line bg-panel hover:border-ink-faint"
                }`}
              >
                {c.otherOrgLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/orgs/${c.otherOrgLogo}`}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded border border-line object-cover"
                  />
                ) : (
                  <span className="h-7 w-7 shrink-0 rounded border border-line bg-panel-2" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-ink">{c.otherOrgSid}</span>
                  <span className="block truncate text-[11px] text-ink-faint">{c.otherOrgName}</span>
                </span>
                {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
              </button>
            ))}
          </div>

          <div className="rounded border border-line bg-panel p-3">
            {!thread ? (
              <p className="text-xs text-ink-faint">Pick a channel.</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <Link href={`/orgs/${thread.otherOrgSid}`} className="text-sm font-bold text-ink hover:text-accent">
                    {thread.otherOrgName}
                  </Link>
                  <span className="text-[11px] text-ink-faint">{thread.otherOrgSid}</span>
                </div>

                <div className="max-h-72 space-y-2 overflow-y-auto rounded border border-line bg-bg p-2">
                  {thread.messages.length === 0 && (
                    <p className="px-1 py-2 text-xs text-ink-faint">Nothing said yet.</p>
                  )}
                  {thread.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.isMine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded px-2 py-1.5 ${m.isMine ? "bg-accent/10" : "bg-panel-2"}`}
                      >
                        <div className="text-[10px] text-ink-faint">
                          {m.orgSid} · {m.senderName}
                          <span className="ml-2" suppressHydrationWarning>
                            {new Date(m.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink">{m.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={2}
                  maxLength={MESSAGE_MAX}
                  placeholder="Speaking for your org…"
                  aria-label="Message"
                  className="mt-2 w-full rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                />
                <button
                  onClick={send}
                  disabled={busy || !body.trim()}
                  className="tap mt-1 rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
                >
                  {busy ? "…" : "Send"}
                </button>
                <p className="mt-1 text-[11px] text-ink-faint">
                  Private between the two presidents. Your name is recorded on each message — an
                  org can&apos;t type, and &quot;who said this on our behalf&quot; is the first question when a
                  deal goes wrong.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
