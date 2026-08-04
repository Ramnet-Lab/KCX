"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Device = { id: string; deviceName: string | null; createdAt: Date; lastUsedAt: Date | null };

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never";

export function AccountPasskeys({ initial }: { initial: Device[] }) {
  const [devices, setDevices] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "register-options" }),
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error ?? "Could not start enrolment");
      const attestation = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "register-verify",
          response: attestation,
          deviceName: navigator.platform || "This device",
        }),
      });
      const verified = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verified.error ?? "Enrolment failed");
      const list = await fetch("/api/auth/passkey").then((r) => r.json());
      setDevices(list.passkeys ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrolment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-line bg-panel p-4">
      <div className="mb-2 flex items-baseline">
        <h2 className="text-sm font-bold text-ink">Passkeys</h2>
        <span className="ml-2 text-xs text-ink-faint">{devices.length} enrolled</span>
        <button
          onClick={add}
          disabled={busy}
          className="ml-auto rounded border border-accent/60 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {busy ? "Waiting for device…" : "+ Add this device"}
        </button>
      </div>

      {error && <div className="mb-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      {devices.length === 0 ? (
        <p className="rounded border border-dashed border-line p-4 text-center text-xs text-ink-faint">
          No passkeys yet — you&apos;ll need to verify your RSI handle each time you sign in. Add one
          to sign in with a tap.
        </p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line uppercase tracking-wider text-ink-dim">
            <tr>
              <th className="py-1.5">Device</th>
              <th className="py-1.5">Added</th>
              <th className="py-1.5">Last used</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-b border-line/50">
                <td className="py-1.5 text-ink">{d.deviceName ?? "Unnamed device"}</td>
                <td className="py-1.5 text-ink-dim">{fmt(d.createdAt)}</td>
                <td className="py-1.5 text-ink-dim">{fmt(d.lastUsedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
