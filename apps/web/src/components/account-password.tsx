"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Set, change or remove the account password.
 *
 * Sits beside the passkey list because the two solve different halves of the same problem: a
 * passkey is the better credential but never leaves the device that made it, so without this
 * a trader who enrolled on a desktop simply cannot sign in on their phone.
 */
export function AccountPassword({ hasPassword: initial, minLength }: { hasPassword: boolean; minLength: number }) {
  const [hasPassword, setHasPassword] = useState(initial);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();

  /** With a fresh RSI verification the old password isn't needed — that IS the reset. */
  const needsCurrent = hasPassword && !forgot;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return false;
      }
      setHasPassword(!!data.hasPassword);
      reset();
      setOpen(false);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (next !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    const ok = await send({ action: "set", password: next, ...(needsCurrent ? { currentPassword: current } : {}) });
    if (ok) setNote("Password saved. You can now sign in with your handle and password on any device.");
  };

  const remove = async () => {
    const ok = await send({ action: "remove", currentPassword: current });
    if (ok) setNote("Password removed.");
  };

  return (
    <section className="mt-6">
      <h2 className="mb-1 text-sm font-bold text-ink">Password</h2>
      <p className="mb-3 text-xs text-ink-dim">
        {hasPassword
          ? "You can sign in with your handle and password on any device."
          : "Passkeys only work on the device that created them. Set a password to sign in from your phone or any other device."}
      </p>

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}
      {note && <div className="mb-3 rounded border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">{note}</div>}

      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="tap rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10"
          >
            {hasPassword ? "Change password" : "Set a password"}
          </button>
          {hasPassword && <span className="text-[11px] text-ink-faint">A password is set on this account.</span>}
        </div>
      ) : (
        <div className="max-w-sm space-y-3 rounded border border-line bg-panel p-3">
          {/* Autofill wants a username field next to a password to offer the right entry. */}
          <input type="text" autoComplete="username" className="hidden" readOnly value="" />
          {needsCurrent && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-ink-faint focus:outline-none"
              />
              <button
                onClick={() => {
                  setForgot(true);
                  setCurrent("");
                  setError(null);
                }}
                className="tap mt-1 text-[11px] text-accent hover:underline"
              >
                I don't know my current password
              </button>
            </label>
          )}

          {hasPassword && forgot && (
            <div className="rounded border border-accent/40 bg-accent/5 px-3 py-2 text-[11px] text-ink-dim">
              Verify your RSI handle again, then come straight back here and save — proving the
              handle is yours replaces the old password.
              <a href="/signin" className="ml-1 font-bold text-accent hover:underline">
                Verify now &rarr;
              </a>
              <button
                onClick={() => {
                  setForgot(false);
                  setError(null);
                }}
                className="tap ml-2 text-ink-faint hover:text-ink"
              >
                cancel
              </button>
            </div>
          )}
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={`At least ${minLength} characters`}
              className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Confirm</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-ink-faint focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={busy || next.length < minLength || !confirm || (needsCurrent && !current)}
              className="tap rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {busy ? "…" : "Save"}
            </button>
            <button
              onClick={() => {
                reset();
                setOpen(false);
                setForgot(false);
                setError(null);
              }}
              className="tap px-3 text-xs text-ink-faint hover:text-ink"
            >
              Cancel
            </button>
            {hasPassword && !forgot && (
              <button
                onClick={remove}
                disabled={busy || !current}
                className="tap ml-auto text-xs text-ink-faint hover:text-danger disabled:opacity-40"
              >
                Remove password
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
