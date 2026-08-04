# The bazaar

The bazaar is where players sell things that aren't bulk cargo: ships, components, weapons,
armour, crafted goods, paints. A listing has pictures, a price, and a clock. It is a
classifieds board, not an exchange — and the difference matters in three places.

## It does not move the market price

The mark, the tape, the candles and the sector indices are built from **commodity fills
only**. A bazaar sale writes no print and touches none of them. See
[market-model.md](market-model.md).

This is not an omission. A Polaris changing hands at forty million says nothing about the
price of Titanium, and there is no unit in which the two are comparable — bazaar items have
no SCU price, no NPC reference to anchor against, and mostly no second example to compare
with. A number that moved on unrelated goods would be worse than no number, because it would
look exactly like a real one.

## Auctions run open and ascending

The mirror image of a service contract's sealed reverse auction, and deliberately so.

On a contract, the issuer is being bid **down** by people selling labour. A visible book
there means bidders undercut each other by one aUEC at the close, and whoever bid honestly
first loses for having done so — hence sealed bids.

On the bazaar, the seller is being bid **up**. Visibility is the mechanism rather than the
leak: a bidder needs to see the standing price to decide whether to go past it, and nobody
is harmed by knowing what it is.

| Rule | Value | Why |
|---|---|---|
| Minimum raise | 2%, at least 1 aUEC | Stops a 40M ship being nudged one aUEC at a time. |
| Soft close | a bid inside the last **5 minutes** pushes the close out to 5 minutes from now | Without it the winning strategy is one bid, in the last second, at the top of your range. That is a worse price for the seller and a worse three days for everyone who bid honestly. |
| Bid retraction | none | A bid is binding; see collateral below. |
| Lot size | one | Bidding on "one of twenty" has no meaning when each unit would clear at a different price. Multiples are sold at a fixed price instead. |

A listing may carry both a clock and a buy-it-now price. **The buy-it-now price retires the
moment somebody bids.** Buying an item out from under a live bidder is the one move that
would make bidding early irrational, and bidding early is what the soft close exists to
reward.

## Who has to have the money

| Side | Backed? | Why |
|---|---|---|
| Buyer | **Yes** — the bid, or the sale total, is committed against their declared balance | aUEC is a number the exchange already tracks per account, so a bid that can't be covered can be refused. |
| Seller | No | A "Polaris with C-tier components" is not a declared holding. Commodity cargo can be checked per commodity; an arbitrary item cannot. |

Only the **standing high bid** is committed. Being outbid frees the money immediately, so
chasing several auctions at once doesn't require pretending to have the money more than
once. The arithmetic lives in one place — `COMMITTED_AUEC` in
`packages/db/src/queries/collateral.ts` — alongside resting orders, open escrows and service
contract payouts, because a trader's exposure is one number and splitting it is how a caller
ends up undercounting it.

What backs the seller instead is their record: settled sales over sales entered, plus stars,
shown on every card on the board. Both travel with the listing so a buyer can price the risk
before committing.

## Settlement

Identical to commodity escrow and service contracts: the pair meet in-game, and **both**
confirm. One confirmation alone changes nothing — the seller can't declare a delivery that
never happened, and the buyer can't quietly keep the goods.

A sale that nobody confirms inside **48 hours** expires. The units go back on the board and
the record stays, counting against both parties' settled-sales ratio. A failed *auction*
does not reopen bidding: it already ran its course, every other bidder has moved on, and
restarting it would leave a clock in the past. The seller relists.

## Ratings

Kept in their own table, apart from contract standing and commodity-trading standing. Being
a reliable ship seller is not the same claim as being a reliable hauler, and one blended
score would let a good record in one buy trust in the other.

## Constants

Defined in `packages/db/src/queries/bazaar.ts` and `packages/shared/src/bazaar.ts`.

| Constant | Value |
|---|---|
| `BAZAAR_SETTLE_HOURS` | 48 |
| `BID_SOFT_CLOSE_MINUTES` | 5 |
| `MIN_BID_INCREMENT_PCT` / `_ABS` | 0.02 / 1 |
| `BAZAAR_BUMP_COOLDOWN_MS` | 8h |
| `MAX_LISTING_IMAGES` | 6 |
| `BAZAAR_MAX_HOURS` | 720 |

## Known limits

- **Self-declared balances.** As everywhere on KCX, the buyer's aUEC is a number they typed.
  The collateral rules raise the cost of bidding on things you can't pay for; they don't
  make it impossible.
- **No item verification.** Nothing confirms the seller owns what they're listing, or that
  the photos are theirs. Standing and the public record of failed settlements are the only
  signals, which is why both are on every card.
- **Sellers post nothing.** A seller who never turns up loses standing and nothing else.
