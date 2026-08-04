"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type SessionUser = {
  id: string;
  handle: string;
  displayName: string;
  isVerified: boolean;
  avatarUrl: string | null;
};

let cached: Promise<{ user: SessionUser | null; devLoginEnabled: boolean }> | null = null;
function fetchSession() {
  cached ??= fetch("/api/auth/session")
    .then((r) => r.json())
    .catch(() => ({ user: null, devLoginEnabled: false }));
  return cached;
}

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetchSession().then((s) => {
      setUser(s.user);
      setLoaded(true);
    });
  }, []);
  return { user, loaded, setUser, invalidate: () => (cached = null) };
}

/** Header sign-in state. RSI handle is the identity; passkeys are the key. */
export function SessionBar() {
  const { user, loaded, setUser, invalidate } = useSession();
  const router = useRouter();

  // Never render nothing. A blank slot while the session request is in flight reads as
  // "this site has no way to sign in" — which is exactly how it looked on mobile.
  if (!loaded || !user) {
    return (
      <Link
        href="/signin"
        className="rounded border border-accent/60 px-2 py-0.5 text-xs font-bold text-accent hover:bg-accent/10"
      >
        Sign in
      </Link>
    );
  }

  const signOut = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    invalidate();
    setUser(null);
    router.push("/");
    router.refresh();
  };

  return (
    <span className="flex items-center gap-2 text-xs">
      <Link href="/account" className="flex items-center gap-1.5 text-ink-dim hover:text-ink">
        {user.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-4 w-4 rounded-sm" />
        )}
        {user.displayName}
        {user.isVerified && (
          <span className="text-accent" title="RSI handle verified">
            ✓
          </span>
        )}
      </Link>
      <button onClick={signOut} className="text-ink-faint hover:text-ink">
        sign out
      </button>
    </span>
  );
}
