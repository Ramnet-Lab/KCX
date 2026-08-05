# Instalment plans

An economy without credit is barter. A 40-million-aUEC ship is out of reach for most traders
in one payment, and the deals that do happen for them happen entirely on trust in a Discord
DM with no record at all. This puts a schedule around that.

**Read this section before the rest.** It is the reason every guard below exists.

## Where the line sits

Sellers set an interest rate. That is a deliberate change from the original design, which
charged nothing and used "no interest" as the argument that this was a schedule rather than
credit. It is no longer that argument, and leaving the old claim in this file would have made
the documentation lie about the product.

What is still true, and what the guards below actually protect:

- **KCX is not a party and lends nothing.** No third party advances anything. The buyer pays
  the seller directly, on terms the two of them agreed.
- **aUEC only.** Real-money terms are banned by CIG and by this site.
- **The principal is the sale price**, taken from the sale and never from the caller. A plan
  cannot quietly change what the goods cost — only what waiting for the money costs.
- **The rate is the seller's, advertised before either side agrees**, and fixed at
  acceptance. Nobody finds out the price of paying over time after committing to it.
- **Simple interest, charged once on the principal.** Not compounding: a headline rate you
  cannot check against what you end up paying is not a headline rate.

UEX bans "banking or lending services… or any system that mimics real-world monetary risk"
on their marketplace. An interest-bearing schedule sits closer to that line than the original
design did. It is in-game currency, between two players, with no lender in the middle — which
is the argument for it — but this remains the feature most likely to need withdrawing.

## Pricing

The seller names a rate. **Two windows is that rate**; every window beyond two adds **2%**.
So a seller asking 5% is quoting 5% over two payments, 7% over three, 9% over four, and so
on. Longer schedules cost more because the seller waits longer for the money and keeps the
item off the market while they do.

```
effective = base + 2% × (windows − 2)
interest  = round(principal × effective)
total     = principal + interest
```

Rates are held in **basis points** (500 = 5.00%) so nothing touches a float — money that
rounds differently depending on which side computed it is money someone will argue about.
The arithmetic lives in `@kcx/shared/instalments.ts` and is imported by both the proposal
form and the server, so the figure a buyer agrees to and the figure written into the schedule
are produced by the same code.

**Only the seller can charge.** A buyer may propose a schedule, but it always carries zero
interest — a buyer setting their own rate is not a term anyone would honour. The seller is
free to decline and put up their own.

## What is no longer limited

The **minimum sale price** and the **rate cap** are both gone. What a schedule is worth is
between the two parties: a seller who wants to offer terms on a small item, or to charge a
lot for waiting, is making a commercial decision the exchange has no standing to overrule.
What the exchange still enforces is that the terms are visible before anyone agrees.

The **window count is still bounded at 2–24**, and that bound is mechanical rather than a
policy: every window is a database row, and a proposal asking for ten thousand payments is a
denial-of-service dressed as a purchase.

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

## The schedule

Between **2 and 24** payments, **1–30 days** apart. One payment isn't an instalment plan.

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
| `INSTALMENT_MIN_SETTLED` | 5 |
| `INSTALMENT_MIN_COMPLETION_PCT` | 80 |
| `INSTALMENT_GRACE_DAYS` | 3 |
| `MAX_ACTIVE_PLANS` | 1 |
| `INSTALMENT_RATE_STEP_BPS` | 200 (2% per extra window) |
| `INSTALMENT_MIN_WINDOWS` / `_MAX_WINDOWS` | 2 / 24 |

## Known limits

- **Everything is still self-declared.** The buyer's balance is a number they typed. The
  schedule records what was agreed and whether both parties confirmed each step; it cannot
  make anyone pay.
- **The seller carries the holding risk.** They keep the item off the market for the length
  of the plan and get nothing but the record if the buyer defaults. The rate is how they are
  compensated for that, and it is why the buyer gates are as strict as they are.
- **Nothing caps the rate.** A seller can quote a number nobody should accept. The defence is
  that it is shown in full, in aUEC and as a percentage, before the buyer agrees — not that
  the exchange forbids it.
- **Partial payments are not refunded by the platform.** On a default the buyer has paid for
  something they do not receive. KCX records the amounts on both sides; settling it is
  between the two of them, as with everything else here.
- **This is the feature most likely to need withdrawing.** If it produces disputes faster
  than it produces trades, the right response is to turn it off, not to add rules.
