"use client";

import type { OrgSummaryDto } from "@kcx/db";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtAuec } from "@/lib/countdown";

/**
 * The org directory.
 *
 * Unverified orgs are listed, greyed rather than hidden. An org that exists but has never
 * proved its leadership is a real fact about the world, and hiding it would make this look
 * like a whitelist — someone searching for a fleet they know exists should find it and see
 * exactly why it can't trade yet.
 */
export function OrgDirectory({ initial }: { initial: OrgSummaryDto[] }) {
  const [orgs, setOrgs] = useState(initial);
  const [search, setSearch] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!search.trim() && !verifiedOnly) {
      setOrgs(initial);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("q", search.trim());
        if (verifiedOnly) params.set("verified", "1");
        const res = await fetch(`/api/orgs/directory?${params}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setOrgs(body.orgs ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, verifiedOnly, initial]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by SID or name…"
          aria-label="Search orgs"
          className="w-56 rounded border border-line bg-panel px-2 py-1.5 text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
        />
        <label className="flex items-center gap-1 text-ink-dim">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            className="accent-[#e8b449]"
          />
          Verified only
        </label>
        <span className="text-ink-faint">{loading ? "…" : `${orgs.length} orgs`}</span>
      </div>

      {orgs.length === 0 ? (
        <div className="rounded border border-dashed border-line p-10 text-center text-sm text-ink-faint">
          <p className="mb-1 text-ink">No orgs yet.</p>
          <p>An org appears here as soon as one of its members verifies their RSI handle.</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {orgs.map((o) => (
            <Link
              key={o.id}
              href={`/orgs/${o.sid}`}
              className={`flex items-center gap-3 rounded border p-3 hover:border-ink-faint ${
                o.verified ? "border-line" : "border-line/60"
              } bg-panel`}
            >
              {o.logoFilename ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/uploads/orgs/${o.logoFilename}`}
                  alt=""
                  className={`h-10 w-10 rounded border border-line object-cover ${o.verified ? "" : "opacity-50"}`}
                />
              ) : (
                <span className="h-10 w-10 rounded border border-line bg-panel-2" />
              )}

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-1.5">
                  <span className={`truncate text-sm font-bold ${o.verified ? "text-ink" : "text-ink-dim"}`}>
                    {o.name}
                  </span>
                  <span className="rounded bg-panel-2 px-1 py-0.5 text-[10px] font-bold tracking-wider text-ink-dim">
                    {o.sid}
                  </span>
                  {o.verified ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-up">verified</span>
                  ) : (
                    <span
                      className="text-[10px] uppercase tracking-wider text-ink-faint"
                      title="Nobody has proved they lead this org, so it can't trade in its own name"
                    >
                      unverified
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-ink-faint">
                  {o.memberCount} member{o.memberCount === 1 ? "" : "s"}
                  {o.completed > 0 && ` · ${o.completed} settled · ${fmtAuec(o.volume)} aUEC`}
                  {o.liveListings > 0 && ` · ${o.liveListings} on the board`}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
