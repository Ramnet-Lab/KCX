# Instalment plans

An economy without credit is barter. A 40-million-aUEC ship is out of reach for most traders
in one payment, and the deals that do happen for them happen entirely on trust in a Discord
DM with no record at all. This puts a schedule around that.

**Read this section before the rest.** It is the reason every guard below exists.

## What this is not

It is not a loan, and KCX is not a party to it.

- **No interest, no fees.** A plan's total is taken from the *sale*, never from the caller.
  Changing *when* money moves is the entire feature; changing *how much* would be interest
  by another name.
- **No lender.** Nobody advances anything. The buyer pays the seller directly, in
  instalments, exactly as they would have paid once.
- **aUEC only.** Real-money terms are banned by CIG and by this site.

UEX bans "banking or lending services… or any system that mimics real-world monetary risk"
on their marketplace, and they are right to be careful. A no-interest payment schedule in
game currency with no lender is a different object from a loan — but it is close enough that
the line has to be defended deliberately rather than assumed.

## The failure mode, and what stops it

The obvious attack is: agree a plan, take delivery on a 10% deposit, vanish.

**So the goods do not move on the deposit.** The seller keeps the item until the final
payment clears — layaway, not credit. Both parties are told this in those words on the
proposal screen, before they agree. A plan that let a buyer walk away with a ship after one
payment would be a scam generator, and no amount of reputation tracking repairs that after
the fact.

This is the single most important behaviour here, and `pnpm check:instalments` asserts it
directly: *the sale is STILL pending after the first payment*.

## Who can use one

The cheapest attack is a fresh account with nothing to lose, so access is gated on the
buyer:

| Gate | Value | Why |
|---|---|---|
| RSI verified | required | An unverified account is free to make. Without this the scheme is "take a schedule with a throwaway handle". |
| Settled bazaar sales | **5**, at **80%+** completion | Not a credit score — a floor. The first thing someone does here cannot be to owe somebody forty million. |
| Prior defaults | **0** | Someone who stopped paying once does not get a second schedule. |
| Concurrent plans | **1** | Nobody runs two at a time and owes several people at once. |
| Sale size | over **5,000,000 aUEC** | A schedule on a small sale is ceremony with extra risk attached. |

## The schedule

Between **2 and 12** payments, **1–30 days** apart. One payment isn't an instalment plan,
and a schedule long enough to outlive the patch it was agreed in is a dispute waiting to
happen.

Every row is written up front, so both sides see every date and amount at the moment they
agree rather than discovering the next one as it arrives. **Rounding goes on the first
payment, not the last** — a buyer should not find the final instalment is the awkward one
after they have already paid everything else.

Payments settle **in order**, and each needs **both sides**, exactly like every other
settlement on KCX: the buyer says they paid, the seller agrees, and only then does the
balance move. Confirming out of order would let a buyer skip an awkward payment and leave a
hole nobody notices until the end.

## Default

A payment sitting **3 days** past due defaults the plan. Then:

- The remaining instalments are marked missed.
- The underlying sale is **cancelled** — the seller never handed the item over, so the units
  go back on the board rather than being stranded against a dead plan.
- A record is written **permanently**, noting how far they got: *defaulted on payment 6 of 8*
  and *took one payment and stopped* are different facts, and a bare count loses that.

Defaults are kept apart from ordinary standing on purpose. A missed sale is somebody who
didn't turn up once; a default is somebody who took a payment schedule and stopped partway
through. Averaging that into a star rating would bury exactly the thing a future
counterparty needs to see.

## Constants

Defined in `packages/db/src/queries/instalments.ts`.

| Constant | Value |
|---|---|
| `INSTALMENT_MIN_TOTAL` | 5,000,000 aUEC |
| `INSTALMENT_MIN_SETTLED` | 5 |
| `INSTALMENT_MIN_COMPLETION_PCT` | 80 |
| `INSTALMENT_GRACE_DAYS` | 3 |
| `MAX_ACTIVE_PLANS` | 1 |

## Known limits

- **Everything is still self-declared.** The buyer's balance is a number they typed. The
  schedule records what was agreed and whether both parties confirmed each step; it cannot
  make anyone pay.
- **The seller carries the holding risk.** They keep the item off the market for the length
  of the plan and get nothing but the record if the buyer defaults. That is the honest trade,
  and it is why the buyer gates are as strict as they are.
- **Partial payments are not refunded by the platform.** On a default the buyer has paid for
  something they do not receive. KCX records the amounts on both sides; settling it is
  between the two of them, as with everything else here.
- **This is the feature most likely to need withdrawing.** If it produces disputes faster
  than it produces trades, the right response is to turn it off, not to add rules.
