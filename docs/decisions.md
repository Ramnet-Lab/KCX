# Decisions

Things the original plan specified that were built differently, cut, or narrowed. Recorded so
the divergence is a choice on the record rather than a gap nobody noticed.

Each entry is a recommendation from the build, not a ruling — reverse any of them by saying so.

---

## D1 — Auth is passkeys + password, not Discord OAuth

**Plan:** Better Auth with Discord as the identity provider; RSI verification layered on top.
**Built:** WebAuthn passkeys as the primary credential, an optional password for portability,
and RSI bio verification as the root credential and the recovery path. No Discord.

**Why.** Discord OAuth makes Discord the account. That means a Discord outage, ban, or account
loss takes the trader's exchange identity with it, and it adds a third party to a project whose
whole trust model is "the RSI handle is the durable thing". RSI verification had to exist
regardless — it is the only proof of identity that means anything here — and once it does,
Discord is a second login for no additional assurance.

The password exists because passkeys are device-bound: enrol on a desktop and your phone has no
way in. That was a real dead end hit during the build, not a hypothetical.

**Status: cut deliberately.** No Discord dependency anywhere.

---

## D2 — The trade room and tranche calculator are cut

**Plan:** `packages/shared/tranche.ts`, a terms-lock state machine, a generated interleaved
payment/cargo schedule with an exposure cap, running paid/delivered meters, dual-tick
checklists, and lower-reputation-party-moves-first ordering.
**Built:** an escrow contract — claim, reserve quantity, both parties confirm, settle — plus
service contracts with bidding and breach reporting.

**Why.** The tranche calculator solves counterparty risk on large trades by splitting them into
steps small enough that a defection is survivable. That is a genuinely good design, and it is
sized for an exchange with liquidity. KCX currently has **2 prints total**. Building a
multi-step settlement choreographer for trades that are not happening would be sophistication
with nothing underneath it, and every hour spent on it is an hour not spent on the reason
nobody is trading yet.

**Status: cut for now, revisit on evidence.** Concretely: revisit when a single trade above
~5M aUEC is attempted, or when a dispute is filed that tranching would have prevented. Until
then the escrow flow is the whole settlement story and should be described as such.

The exposure-cap arithmetic is worth keeping in mind even without the UI: the in-game transfer
limit is 999,999 aUEC per transaction, so any trade above that is already multi-step in
practice whether or not the site helps.

---

## D3 — Presence is cut

**Plan:** a `user_presence` table, a live WebSocket connection map, in-game/online/invisible
toggles, presence holds surviving restarts, 30-minute heartbeat lapse to auto-offline.
**Built:** nothing.

**Why.** Presence answers "can I trade with this person right now", which matters when the
board is deep enough that you are choosing between counterparties. With a handful of listings
you contact whoever posted and wait. It is also the single most expensive feature per unit of
value in the plan — a stateful subsystem with restart semantics, hold timers, and a cache that
lies whenever the process dies.

**Status: cut for now.** Revisit when the board sustains enough concurrent listings that
choosing between counterparties is a real decision. A "last seen" timestamp derived from
existing session activity would cover most of the value for almost none of the cost, and is the
thing to build first if this comes back.

---

## D4 — Reputation stays descriptive; no scored engine

**Plan:** `reputation_events` and `reputation_scores`, per-event point weights, a counterparty
diversity factor, per-pair and per-day velocity caps, RSI-age multipliers, cosmetic rank tiers
(Drifter → Baron), and T3 Broker promotion unlocking raised caps and a bulk board.
**Built:** star ratings, and an objective completion ratio (settled ÷ entered) computed from
the trade record.

**Why.** The scored engine was designed to do two jobs. The first — making manipulation
expensive — has since been taken over by the **print integrity engine**, which does it directly
and better: pair rate limits, single-account volume share caps, verification requirements, and
a public tape carrying every refusal with its reason. Those act on the price itself rather than
on a number that gates who may influence the price.

The second job is helping a trader judge a counterparty. For that, a single opaque integer is
worse than what already ships: "4.6 stars over 11 trades, 9 of 11 entered contracts settled"
tells you more than "reputation 340", and cannot be farmed by volume the way a point total can.

The weighting machinery — diversity factors, velocity caps, RSI-age multipliers — exists
precisely to stop a point total being farmed. Not having a point total removes the problem
rather than mitigating it.

**Status: narrowed deliberately.** Capability tiers (T0–T4) are worth reconsidering separately;
they gate *actions* rather than display trust, and posting caps for brand-new accounts are a
reasonable abuse control independent of any scoring system.

---

## D5 — The sector index runs continuously and is never rebased

**Decision:** the stored series chains across patch boundaries. Season-to-date is derived at
read time by dividing by the season's opening value.

**Why not rebase.** A rebased series answers "how has this moved this patch" and forgets
everything else. Whether commodities inflate patch over patch, and what a wipe does to prices,
are questions no other Star Citizen tool is positioned to answer, and they are only answerable
from an unbroken series. Chain-linking makes the continuous version sound where the old
equal-weight-of-relatives method would have broken across a changing constituent set.

**Why show both.** "Since the patch" is the horizon a trader trades on. Because the season
figure is a *view* of the continuous series rather than a second series, the two can never
disagree about what happened — which a separately-maintained pair eventually would.

---

## D6 — Spatial (system-scoped) marks are deferred

Fully scoped in [spatial-pricing-scope.md](./spatial-pricing-scope.md). Summary: the mark is
one scalar per commodity when value in this game is a function of location — 53 of 77
two-sided commodities have their best NPC buy and sell in *different star systems*. The fix is
system-scoped marks with a labelled global fallback.

**Status: deferred on liquidity, not effort.** Splitting a 2-print tape by system yields empty
cells everywhere. Trigger: a system sustaining 3 distinct counterparty pairs in a 72h window —
the same bar the integrity rules already use for "this price means something".

Shipped in the meantime: every NPC price is labelled with the terminal and system it is at, so
the two figures no longer read as a spread anyone could capture.
