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
  role: string;
};

/**
 * Moderator entry point in the header.
 *
 * Rendered from the session rather than a server layout read, so the layout stays static and
 * every page doesn't pay for a database round trip. This only hides the link — /admin and
 * every admin API check the role server-side, so a forged session shape gains nothing.
 */
export function ModNavLink() {
  const { user, loaded } = useSession();
  if (!loaded || !user) return null;
  if (user.role !== "mod" && user.role !== "admin") return null;
  // The link is named after the role holding it. Calling a moderator's link "Admin" invited
  // exactly one misunderstanding — that the powers behind it are the same — and they are not:
  // a mod clears reports and bans, an admin also stands in for people and works any org.
  const isAdmin = user.role === "admin";
  return (
    <Link
      href="/admin"
      className="font-bold text-danger hover:text-ink"
      title={isAdmin ? "Admin console" : "Moderation"}
    >
      {isAdmin ? "Admin" : "Mod"}
    </Link>
  );
}

/**
 * Link to the trader's own desk. Hidden while signed out, where it would only lead to a
 * redirect — same session-driven approach as ModNavLink, and /manage checks the session
 * server-side regardless.
 */
export function DeskNavLink() {
  const { user, loaded } = useSession();
  if (!loaded || !user) return null;
  return (
    <>
      <Link href="/manage" className="hover:text-ink" title="Your listings, contracts and orders">
        My desk
      </Link>
      <Link href="/orgs" className="hover:text-ink" title="Your org">
        My org
      </Link>
    </>
  );
}

type SessionState = {
  user: SessionUser | null;
  devLoginEnabled: boolean;
  unreadMessages: number;
  /** An admin is standing in as `user`; `actualHandle` is who they really are. */
  impersonating: boolean;
  actualHandle: string | null;
};

const SIGNED_OUT: SessionState = {
  user: null,
  devLoginEnabled: false,
  unreadMessages: 0,
  impersonating: false,
  actualHandle: null,
};

let cached: Promise<SessionState> | null = null;
/**
 * Mounted consumers, so a refresh reaches the header from anywhere.
 *
 * The unread badge lives in this bar but is cleared by the inbox on /account — a component
 * that has no way to reach up here. Without the broadcast the badge keeps claiming unread
 * mail until a full page load, which reads as the site being wrong rather than stale.
 */
const listeners = new Set<(s: SessionState) => void>();

function fetchSession(): Promise<SessionState> {
  cached ??= fetch("/api/auth/session")
    .then((r) => r.json())
    .then((s) => ({
      user: (s?.user ?? null) as SessionUser | null,
      devLoginEnabled: !!s?.devLoginEnabled,
      unreadMessages: Number(s?.unreadMessages ?? 0),
      impersonating: !!s?.impersonating,
      actualHandle: (s?.actualHandle ?? null) as string | null,
    }))
    .catch(() => SIGNED_OUT);
  return cached;
}

/** Re-read the session and push it to everything rendering from it. */
export function refreshSession(): void {
  cached = null;
  void fetchSession().then((s) => {
    for (const notify of listeners) notify(s);
  });
}

export function useSession() {
  const [state, setState] = useState<SessionState>(SIGNED_OUT);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const apply = (s: SessionState) => {
      if (!alive) return;
      setState(s);
      setLoaded(true);
    };
    listeners.add(apply);
    void fetchSession().then(apply);
    return () => {
      alive = false;
      listeners.delete(apply);
    };
  }, []);
  return {
    user: state.user,
    unreadMessages: state.unreadMessages,
    impersonating: state.impersonating,
    actualHandle: state.actualHandle,
    loaded,
    setUser: (user: SessionUser | null) => setState((s) => ({ ...s, user })),
    invalidate: () => {
      cached = null;
    },
  };
}

/** Header sign-in state. RSI handle is the identity; passkeys are the key. */
export function SessionBar() {
  const { user, unreadMessages, loaded, setUser, invalidate } = useSession();
  const router = useRouter();

  /*
   * Re-read on the way back to the tab.
   *
   * The session is fetched once and cached for the life of the page, which is right for who
   * you are and wrong for how much mail you have: a reply that lands while someone is
   * reading the board would otherwise stay invisible until a full reload. Coming back to
   * the tab is the moment they are about to look, and it costs one indexed count.
   *
   * Only this component listens, not every useSession() caller — one refresh reaches them
   * all through the broadcast.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSession();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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
      <Link
        href={unreadMessages > 0 ? "/account#inbox" : "/account"}
        className="flex items-center gap-1.5 text-ink-dim hover:text-ink"
      >
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
        {/*
          On the name itself rather than a separate bell: the name is the thing already in
          the header on every page and at every width, and a second icon is one more thing
          to wrap onto a second line on a phone.
        */}
        {unreadMessages > 0 && (
          <span
            className="num rounded-full bg-danger px-1.5 py-px text-[10px] font-bold leading-4 text-bg"
            title={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"} in your inbox`}
            aria-label={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`}
          >
            {unreadMessages > 99 ? "99+" : unreadMessages}
          </span>
        )}
      </Link>
      <button onClick={signOut} className="text-ink-faint hover:text-ink">
        sign out
      </button>
    </span>
  );
}

/**
 * The standing-in banner.
 *
 * Deliberately loud, fixed, and on every page. An admin wearing somebody else's account sees
 * a site that behaves normally in every respect — that is the whole point of the feature and
 * also its only real hazard, because the next thing they do, they do as that person. The one
 * thing that must never be subtle is the way out.
 */
export function ImpersonationBanner() {
  const { impersonating, user, actualHandle } = useSession();
  const [busy, setBusy] = useState(false);
  if (!impersonating || !user) return null;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-2 bg-danger/20 px-3 py-1.5 text-center text-[11px] text-ink">
      <span>
        Acting as <span className="font-bold">@{user.handle}</span>
        {actualHandle && <span className="text-ink-dim"> — you are @{actualHandle}</span>}
      </span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await fetch("/api/admin/impersonate", { method: "DELETE" });
            refreshSession();
            window.location.reload();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="tap rounded bg-danger/30 px-2 py-0.5 font-bold hover:bg-danger/40 disabled:opacity-40"
      >
        {busy ? "…" : "Stop"}
      </button>
    </div>
  );
}
