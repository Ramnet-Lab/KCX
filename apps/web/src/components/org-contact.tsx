"use client";

import type { OrgDto } from "@kcx/db";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * "Contact this org" on a public org page.
 *
 * Only offered to the president of a verified org, and only against another verified one —
 * a channel needs somebody who can speak at each end, and an unverified org has nobody who
 * can be said to speak for it.
 *
 * The button is hidden rather than disabled for everyone else. A greyed-out control that
 * explains a rule to people it will never apply to is noise on a page whose job is to help
 * a buyer decide whether to trust an org.
 */
export function OrgContactButton({
  targetOrgId,
  targetSid,
  verified,
}: {
  targetOrgId: string;
  targetSid: string;
  verified: boolean;
}) {
  const [myOrgs, setMyOrgs] = useState<OrgDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    void fetch("/api/orgs")
      .then((r) => (r.ok ? r.json() : { orgs: [] }))
      .then((b) => setMyOrgs(b.orgs ?? []))
      .catch(() => setMyOrgs([]));
  }, []);

  // The president of a verified org, looking at a different verified org.
  const asOrg = myOrgs?.find((o) => o.myRole === "president" && o.status === "verified" && o.id !== targetOrgId);
  if (!verified || !asOrg) return null;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromOrgId: asOrg.id, toOrgId: targetOrgId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not open a channel");
        return;
      }
      router.push(`/orgs?id=${asOrg.id}&channel=${body.channelId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        onClick={open}
        disabled={busy}
        title={`Open a private channel between ${asOrg.sid} and ${targetSid}`}
        className="tap rounded border border-accent/60 px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
      >
        {busy ? "…" : `Contact as ${asOrg.sid}`}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
