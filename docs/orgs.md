# Orgs

Orgs are not created on KCX. One appears the moment a verified trader's public RSI profile
names it as their main org, and its roster is whatever set of verified traders currently name
it. Nobody adds or removes anyone — you join an org on RSI.

That removes the whole class of abuse where somebody registers a name they have nothing to do
with. What it does not settle is who speaks for the org, which is what the rest of this is
about.

## The two credentials

**Rank stars (0–5)**, read off each member's dossier. Set by the org's real leadership on RSI,
not by the member, so they cannot be self-awarded. They decide who is *presumed* to lead
before anything is proven, and are compared strictly within one org — plenty of orgs hand
everyone five stars.

**The charter code.** The org's RSI page carries a Charter, History and Manifesto that only
org admins can edit. Pasting a KCX code there proves control of the *org*, exactly as pasting
one in a bio proves control of a handle. Whoever completes it becomes the charter holder, and
their word then overrides the star ranking entirely.

An org cannot touch the market until that has happened. A roster with no proven leader is a
list of people, not a trading entity — so there is no window in which whoever signed up first
can point a treasury at the board.

## Lifecycle

| Status | Meaning |
|---|---|
| `derived` | Auto-created from a member's profile. Roster only; cannot trade. |
| `pending` | A leadership claim is outstanding with a code to paste. |
| `verified` | Charter proven. Treasury, listings and contracts in the org's name. |
| `suspended` | A moderator stopped it trading. The roster and the president survive. |

Suspension deliberately does **not** unseat the president: an org reinstated after a dispute
should come back to the leader it had. An earlier iff-shaped constraint made suspending a
verified org impossible, which the org checks caught.

## Roles

| Role | How it's acquired | What it does |
|---|---|---|
| **member** | Derived. Cannot be refused or removed here. | Counted in the org's record. Spends nothing. |
| **treasurer** | **Granted by the president.** Never self-declared. | Spends up to a delegated limit. |
| **president** | Proven via the charter code, or set by a moderator. | Everything. |

Each of the two roles that touch money is acquired a different way, and neither can be
self-declared. The president's word is final and overrides the star ranking outright — they
can make the lowest-ranked member treasurer and leave a five-star member as a plain member.
The ranking only ever decided who got to make the claim.

## Spending

Two ceilings, both enforced: the org's uncommitted treasury, and the acting member's delegated
slice of it. Enforcing only the treasury would make every spend limit decorative, and an org
that trusts someone with 10M of a 200M treasury has said something specific.

Committed aUEC covers live wanted ads, unsettled purchases, open board proposals and issued
service contracts — the same "what have you promised" accounting a personal balance gets.

**Authority goes stale.** Sixty days without the membership being seen on a live profile and
spending stops until they re-verify. Someone who left the org two months ago should not still
be spending its money because nobody noticed. Only spending is affected; the roster keeps
showing them until their profile says otherwise.

## The board

Designated members must agree before an org-attributed transaction goes ahead, above a
per-org value threshold. The proposal holds the same payload the ordinary endpoint takes and
replays against it on approval — a board path with its own copy of "create a listing" would
drift from the non-board path, and the drift would show up as org purchases behaving subtly
differently from everyone else's.

The proposer can never supply their own quorum, the same rule that stops someone accepting
their own offer on the bazaar. **That binds the president too.** They set the threshold and
can veto any proposal, but cannot carry one alone: a board the president can bypass
constrains nothing. They control the rules, not the individual outcome, and lowering the
threshold is visible and only applies going forward.

The replay carries an `approvedProposalId` that the target route re-reads before honouring.
Without it the listing would belong to whoever cast the deciding vote rather than the
proposer, and the board gate would fire again — so every approval would spawn another
proposal.

## Moderators

Charter verification settles the ordinary case with nobody's judgement involved, which is why
moderators are the escape hatch rather than the queue: compromised accounts, leadership that
changed hands off-platform, disputed claims, and orgs that have to stop trading now.

## Branding

The org logo is fetched once at verification and cached through the ordinary upload pipeline —
magic-byte sniffed, generated filename, served from our own origin. Hotlinking would put RSI's
bandwidth behind every board render and break the moment they set a referrer policy.

Org-controlled listings and contracts carry the org's badge and SID, and read "acting for
⟨org⟩ via ⟨member⟩" — an org transaction should be visibly an org transaction.

## Known limits

- **We only see the MAIN org.** RSI supports affiliate orgs and the dossier doesn't show them,
  so a roster is honestly "people whose *main* org is X".
- **Redacted profiles are left alone**, not dropped. RSI is saying there IS an org it won't
  name, and removing someone on that basis would strip a treasurer of their seat for changing
  a privacy setting.
- **The treasury is self-declared**, like every balance here. The rules stop an org promising
  more than it says it has; they cannot make the number true.
- **Rank inflation is real.** Stars are only ever compared within one org, and an org where
  everyone is five stars simply falls through to the tiebreakers.

Constants live in `packages/db/src/queries/orgs.ts`. `pnpm check:orgs` exercises derivation,
the trade gate, who may claim, the override, staleness, leaving, the board, suspension and
transfer.
