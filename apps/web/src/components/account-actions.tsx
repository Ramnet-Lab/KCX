"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Sign-out / switch-handle controls.
 *
 * These live on the account page itself, not only in the header: the header link is easy
 * to miss (and gets clipped on narrow screens), and without a visible way out a signed-in
 * user has no route back to /signin — that page redirects them straight back here.
 */
export function AccountActions({
  className = "",
  variant = "plain",
}: {
  className?: string;
  variant?: "plain" | "cta";
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const signOut = async (thenSignIn: boolean) => {
    setBusy(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      router.push(thenSignIn ? "/signin" : "/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (variant === "cta") {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => signOut(true)}
          disabled={busy}
          className="rounded bg-accent/20 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          {busy ? "…" : "Sign out & claim my RSI handle"}
        </button>
      </div>
    );
  }

  return (
    <span className={`flex gap-3 text-xs ${className}`}>
      <button onClick={() => signOut(true)} disabled={busy} className="text-ink-faint hover:text-ink">
        switch handle
      </button>
      <button onClick={() => signOut(false)} disabled={busy} className="text-ink-faint hover:text-danger">
        sign out
      </button>
    </span>
  );
}
