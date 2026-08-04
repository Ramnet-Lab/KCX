"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Conditions-of-access briefing, shown before anyone can take a classified contract.
 *
 * Deliberately styled as a clearance indoctrination rather than a generic "are you sure?".
 * The point is that the reader should feel they are crossing a line, because they are: the
 * next screen hands them somebody's target, location and imagery, and the only thing
 * protecting the issuer afterwards is this person's word.
 *
 * The acknowledgement it produces is recorded server-side against the contract, and the
 * server refuses the acceptance without it — so this is a real gate, not a courtesy dialog.
 */
export function ClassifiedBriefing({
  title,
  payout,
  onAccept,
  onCancel,
  busy,
}: {
  title: string;
  payout: number;
  onAccept: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [understood, setUnderstood] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the dialog so a keyboard user isn't stranded behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ready = understood && accepted && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="classified-briefing-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="my-auto w-full max-w-xl rounded border-2 border-danger/60 bg-bg shadow-2xl focus:outline-none"
      >
        {/* Header band */}
        <div className="border-b-2 border-danger/60 bg-danger/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none text-danger">▩</span>
            <span className="num text-[10px] font-bold uppercase tracking-[0.2em] text-danger">
              Classified — conditions of access
            </span>
          </div>
          <h2 id="classified-briefing-title" className="mt-1 text-sm font-bold text-ink">
            {title}
          </h2>
          <p className="num mt-0.5 text-[11px] text-ink-faint">
            Payout {payout.toLocaleString()} aUEC
          </p>
        </div>

        <div className="space-y-4 px-4 py-4 text-xs leading-relaxed text-ink-dim">
          <p>
            You are about to be read in to a classified contract. On acceptance you will be
            granted the full brief, any attached imagery, and the location — material the issuer
            has withheld from every other trader on this exchange.
          </p>

          <div className="rounded border border-line bg-panel-2 p-3">
            <p className="num mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              Terms you are accepting
            </p>
            <ol className="space-y-2">
              <li className="flex gap-2">
                <span className="num shrink-0 text-danger">01</span>
                <span>
                  The contents of this contract are disclosed to you{" "}
                  <span className="text-ink">for the execution of this contract only</span>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="num shrink-0 text-danger">02</span>
                <span>
                  You will not republish, forward, screenshot, stream, or describe the brief,
                  the imagery, the location, or the identity of the issuer to any third party —
                  in game, on Spectrum, on Discord, or anywhere else.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="num shrink-0 text-danger">03</span>
                <span>
                  You will not act on the information for any purpose other than completing this
                  contract, nor pass it to a competing party.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="num shrink-0 text-danger">04</span>
                <span>
                  These terms survive the contract. Stepping away, letting it expire, or
                  completing it does not release you from them.
                </span>
              </li>
            </ol>
          </div>

          <div className="rounded border border-danger/40 bg-danger/5 p-3">
            <p className="num mb-1 text-[10px] font-bold uppercase tracking-wider text-danger">
              Consequences of breach
            </p>
            <p>
              If the issuer reports that you have broken these terms, a{" "}
              <span className="font-bold text-danger">breach is recorded against your contract standing</span>{" "}
              and displayed beside your rating to everyone on the exchange. It is counted
              separately from stars and cannot be averaged away by good work elsewhere. You will
              be given a right of reply, and a moderator can dismiss a claim that doesn't hold —
              but an upheld breach stays on your record.
            </p>
          </div>

          <p className="text-[11px] text-ink-faint">
            KCX cannot see what you do in game. This works on reputation alone — which is exactly
            why the mark is permanent and public.
          </p>

          <div className="space-y-2 border-t border-line pt-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#e8b449]"
              />
              <span className="text-ink-dim">
                I have read the conditions above and understand what I am being given access to.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#e8b449]"
              />
              <span className="text-ink-dim">
                I accept that a breach will be recorded permanently against my contract standing.
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-3">
          <button
            onClick={onAccept}
            disabled={!ready}
            className="tap rounded bg-danger/20 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-faint"
          >
            {busy ? "Reading you in…" : "Accept conditions and take contract"}
          </button>
          <button onClick={onCancel} disabled={busy} className="tap px-3 py-2 text-xs text-ink-faint hover:text-ink">
            Cancel
          </button>
          {!ready && !busy && (
            <span className="text-[11px] text-ink-faint">Tick both boxes to continue.</span>
          )}
        </div>
      </div>
    </div>
  );
}
