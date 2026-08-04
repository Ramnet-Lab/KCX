"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Step = "choose" | "handle" | "paste" | "passkey" | "password";

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
};

/**
 * Sign-in / sign-up.
 *
 * Returning traders tap their passkey. New traders prove they own an RSI account by pasting a
 * one-time code into their profile bio — which is also the recovery path, so there is no
 * password to forget and no email to lose access to.
 */
export function SignInFlow() {
  const [step, setStep] = useState<Step>("choose");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [passkeysUsable, setPasskeysUsable] = useState(true);
  const router = useRouter();

  /*
   * WebAuthn is gated behind a secure context. Over http:// on a LAN address (phone testing)
   * the API simply isn't exposed, so the passkey buttons would be dead taps with no
   * explanation. Detect it after mount — window isn't available during SSR.
   */
  useEffect(() => {
    setPasskeysUsable(
      typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential !== "undefined",
    );
  }, []);

  const passkeySignIn = async () => {
    if (!passkeysUsable) {
      setError(
        "Passkeys need a secure connection (https), and this page is plain http. Verify your RSI handle instead.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const options = await post("/api/auth/passkey", { action: "login-options" });
      if (!options.ok) throw new Error(options.body.error ?? "Could not start sign-in");
      const assertion = await startAuthentication({ optionsJSON: options.body });
      const verified = await post("/api/auth/passkey", { action: "login-verify", response: assertion });
      if (!verified.ok) throw new Error(verified.body.error ?? "Sign-in failed");
      router.push("/account");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setError(
        /NotAllowed|abort/i.test(message)
          ? "No passkey was offered. If this is a new device, verify your RSI handle instead."
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  const passwordSignIn = async () => {
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/password", {
      action: "login",
      handle: handle.trim(),
      password,
    });
    setBusy(false);
    if (!res.ok) return setError(res.body.error ?? "Sign-in failed");
    router.push("/account");
    router.refresh();
  };

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/rsi", { action: "start", handle: handle.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.body.error ?? "Could not start verification");
    setCode(res.body.code);
    setStep("paste");
  };

  const checkCode = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await post("/api/auth/rsi", { action: "check", handle: handle.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.body.error ?? "Verification failed");
    setNote(
      res.body.isNewAccount
        ? `Welcome, ${res.body.user.displayName}. Your account is created — you can remove the code from your bio now.`
        : `Verified as ${res.body.user.displayName}. You can remove the code from your bio now.`,
    );
    setStep("passkey");
  };

  const enrolPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await post("/api/auth/passkey", { action: "register-options" });
      if (!options.ok) throw new Error(options.body.error ?? "Could not start enrolment");
      const attestation = await startRegistration({ optionsJSON: options.body });
      const verified = await post("/api/auth/passkey", {
        action: "register-verify",
        response: attestation,
        deviceName: navigator.platform || "This device",
      });
      if (!verified.ok) throw new Error(verified.body.error ?? "Enrolment failed");
      router.push("/account");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrolment failed");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/password", { action: "set", password });
    setBusy(false);
    if (!res.ok) return setError(res.body.error ?? "Could not set password");
    setPassword("");
    router.push("/account");
    router.refresh();
  };

  const skipPasskey = () => {
    router.push("/account");
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-bold text-ink">Sign in to KCX</h1>
      <p className="mb-6 text-xs text-ink-dim">
        Your RSI account is your identity here — no email needed. Prove the handle is yours once,
        then get back in with a passkey or a password. Verifying your handle again always works
        if you lose both.
      </p>

      {!passkeysUsable && (
        <div className="mb-4 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink-dim">
          <span className="font-bold text-accent">Passkeys unavailable on this connection.</span>{" "}
          Browsers only allow them over <span className="text-ink">https</span> (or on localhost), and
          this page is plain http — so verify your RSI handle below instead. That signs you in fully;
          you can add a passkey later from a secure address.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}
      {note && (
        <div className="mb-4 rounded border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">{note}</div>
      )}

      {step === "choose" && (
        // When passkeys can't run, RSI verification becomes the primary action rather than
        // the fallback — leading with a button that cannot work is just a dead tap.
        <div className={`flex flex-col gap-3 ${passkeysUsable ? "" : "flex-col-reverse"}`}>
          <button
            onClick={passkeySignIn}
            disabled={busy || !passkeysUsable}
            title={passkeysUsable ? undefined : "Requires an https connection"}
            className={`w-full rounded border px-4 py-3 text-sm font-bold disabled:cursor-not-allowed ${
              passkeysUsable
                ? "border-accent/60 text-accent hover:bg-accent/10 disabled:opacity-50"
                : "border-line text-ink-faint opacity-60"
            }`}
          >
            {busy ? "Waiting for your device…" : "Sign in with a passkey"}
            {!passkeysUsable && <span className="block text-[11px] font-normal">Needs https — unavailable here</span>}
          </button>
          <div className="text-center text-[11px] text-ink-faint">— or —</div>
          <button
            onClick={() => setStep("password")}
            className="tap w-full rounded border border-line px-4 py-3 text-sm text-ink-dim hover:border-ink-faint hover:text-ink"
          >
            Sign in with a password
            <span className="block text-[11px] font-normal text-ink-faint">
              If you set one — works on any device
            </span>
          </button>
          <button
            onClick={() => setStep("handle")}
            className={`tap w-full rounded border px-4 py-3 text-sm ${
              passkeysUsable
                ? "border-line text-ink-dim hover:border-ink-faint hover:text-ink"
                : "border-accent/60 font-bold text-accent hover:bg-accent/10"
            }`}
          >
            Verify my RSI handle
            <span className="block text-[11px] font-normal text-ink-faint">
              New here, or locked out — always works
            </span>
          </button>
        </div>
      )}

      {step === "password" && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">RSI handle</span>
            <input
              autoFocus
              autoComplete="username"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. ramnet"
              className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && password && passwordSignIn()}
              className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink focus:border-ink-faint focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={passwordSignIn}
              disabled={busy || handle.trim().length < 3 || !password}
              className="tap rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {busy ? "…" : "Sign in"}
            </button>
            <button onClick={() => setStep("choose")} className="tap px-3 text-xs text-ink-faint hover:text-ink">
              Back
            </button>
          </div>
          <p className="text-[11px] text-ink-faint">
            No password set? Verify your RSI handle instead — that always works, and you can set
            a password afterwards from your account page.
          </p>
        </div>
      )}

      {step === "handle" && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">RSI handle</span>
            <input
              autoFocus
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && requestCode()}
              placeholder="e.g. ramnet"
              className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-ink-faint">
              Exactly as it appears at robertsspaceindustries.com/citizens/&lt;handle&gt;
            </span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={requestCode}
              disabled={busy || handle.trim().length < 3}
              className="rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {busy ? "…" : "Continue"}
            </button>
            <button onClick={() => setStep("choose")} className="px-3 text-xs text-ink-faint hover:text-ink">
              Back
            </button>
          </div>
        </div>
      )}

      {step === "paste" && (
        <div className="space-y-4">
          <ol className="space-y-3 text-sm text-ink-dim">
            <li>
              <span className="mr-2 text-ink-faint">1.</span>Copy this code:
              <div className="num mt-1 flex items-center gap-2 rounded border border-accent/50 bg-panel-2 px-3 py-2 text-lg font-bold tracking-widest text-accent">
                {code}
                <button
                  onClick={() => navigator.clipboard?.writeText(code)}
                  className="ml-auto rounded border border-line px-2 py-0.5 text-[11px] font-normal text-ink-dim hover:text-ink"
                >
                  copy
                </button>
              </div>
            </li>
            <li>
              <span className="mr-2 text-ink-faint">2.</span>Paste it into the{" "}
              <span className="text-ink">Short Bio</span> on your RSI account settings, and save.
              <a
                href="https://robertsspaceindustries.com/account/profile"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-accent hover:underline"
              >
                Open RSI profile settings ↗
              </a>
            </li>
            <li>
              <span className="mr-2 text-ink-faint">3.</span>Come back and check. You can delete the
              code straight afterwards.
            </li>
          </ol>
          <div className="flex gap-2">
            <button
              onClick={checkCode}
              disabled={busy}
              className="rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {busy ? "Checking your profile…" : "I've saved it — check now"}
            </button>
            <button onClick={() => setStep("handle")} className="px-3 text-xs text-ink-faint hover:text-ink">
              Change handle
            </button>
          </div>
          <p className="text-[11px] text-ink-faint">
            We read your public profile page once per check — nothing else, and never your password.
          </p>
        </div>
      )}

      {step === "passkey" && (
        <div className="space-y-4">
          <p className="text-sm text-ink-dim">
            You're signed in. Set up how you'll get back in next time — you can do both.
          </p>

          <div className="rounded border border-line p-3">
            <p className="text-xs text-ink-dim">
              <span className="font-bold text-ink">Passkey</span> — sign in with a tap:
              fingerprint, face or device PIN. Fastest and safest, but it only works on{" "}
              <span className="text-ink">this</span> device.
            </p>
            <button
              onClick={enrolPasskey}
              disabled={busy || !passkeysUsable}
              className="tap mt-2 rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {busy ? "Waiting for your device…" : "Add a passkey"}
            </button>
          </div>

          <div className="rounded border border-line p-3">
            <p className="text-xs text-ink-dim">
              <span className="font-bold text-ink">Password</span> — works on every device,
              including your phone. Set one if you don't want to re-verify each time you switch.
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 10 characters"
              className="mt-2 w-full rounded border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
            <button
              onClick={savePassword}
              disabled={busy || password.length < 10}
              className="tap mt-2 rounded border border-accent/60 px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {busy ? "…" : "Set password"}
            </button>
          </div>

          <button onClick={skipPasskey} className="tap px-3 text-xs text-ink-faint hover:text-ink">
            Skip — I'll verify my handle again next time
          </button>
        </div>
      )}
    </div>
  );
}
