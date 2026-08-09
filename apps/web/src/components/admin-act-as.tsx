"use client";

import { useState } from "react";
import { refreshSession } from "@/components/session-bar";

/**
 * Pull up another trader's desk and work it as them.
 *
 * The alternative to this is reading four tables by hand and guessing at what the page did
 * with them, which is how a support question becomes an afternoon. Switching accounts wholesale
 * means the desk that renders is the desk they are describing — not an admin's reconstruction
 * of it — and anything that reproduces here reproduces for real.
 *
 * Rendered only for admins, and the server checks that again on every call; this component
 * appearing is a convenience, not the permission.
 */
export function AdminActAs() {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    const q = handle.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: q }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error ?? "Could not switch");
        return;
      }
      refreshSession();
      // Hard reload rather than router.refresh(): every server component on the page was
      // rendered for the previous account, and a soft refresh leaves some of them cached.
      window.location.reload();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded border border-accent/40 bg-accent/5 p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-accent">Admin</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
          placeholder="RSI handle"
          aria-label="Handle to act as"
          className="min-w-48 flex-1 rounded border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button
          onClick={() => void go()}
          disabled={busy || !handle.trim()}
          className="tap rounded bg-accent/20 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          {busy ? "…" : "Open their desk"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      <p className="mt-2 text-[11px] text-ink-faint">
        Loads their desk and acts as them everywhere until you stop. You lose your own admin
        rights for the duration — the site behaves exactly as it does for them.
      </p>
    </div>
  );
}
