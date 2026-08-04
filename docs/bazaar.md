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

## The item catalogue

A listing title is an advertisement — "Drake Cutlass Black — fully kitted, S4 shields" — and
no two sellers write it the same way. So titles can never answer *what did one of these go
for last time*. Every listing also names an **item**, and that is what prices attach to.

Seeded from UEX, which is already the source for commodity prices, so it costs no new
dependency, no new token, and no new attribution:

| Walk | Endpoint | Rows |
|---|---|---|
| Items | `/categories` → `/items?id_category=N` for the ~66 of type `item` | ~7,700 |
| Vehicles | `/vehicles`, stored under `name_full` ("Drake Cutlass Black") | ~280 |

`/items` refuses a bare call — it needs `id_category`, `id_company` or `uuid` — hence the
category walk. Ten of those categories are legitimately empty; the ingest treats that as
"no rows" rather than a failure, because a job that cries wolf nightly trains everyone to
ignore the night it is right.

### Names are matched on a normalised key

Every entry stores `name` (shown) and `name_key` (matched), the latter being the name folded
by `itemNameKey` in `@kcx/shared`: Unicode-decomposed, accents dropped, lowercased, and every
run of non-alphanumerics collapsed to one space. So `P4-AR`, `p4 ar` and a copy-paste
carrying a non-breaking space are one key, and the uniqueness constraint sits on that column.

This is the whole reason the catalogue is usable. Matching on display names instead would
split one rifle's price history three ways and leave every copy reading as thin.

### It grows from below

A seller who can't find their item types its in-game inventory name. That name is normalised
and looked up: if it already exists in *any* spelling they get the existing entry, and only a
genuinely new key creates a row. New rows are marked `source = 'player'`, and a later UEX
sync **adopts** them in place rather than adding a canonical duplicate — keeping the id, and
with it every listing and sale already pointing at it. Player entries nobody ever listed
against are pruned after 30 days.

### Search ranking

Exact key match first, then how many listings the item has had, then vehicles ahead of items,
then where the match falls in the name. Rule three exists because without it "cutlass black"
returns the plushie, the ship armour and the livery before the ship — all shorter names that
start with the term, and all of them named after the thing you were looking for.

## What it last sold for

Sellers get the item's history on the compose form, above the price box rather than below it,
because a reference shown after the number has been typed is a reference nobody used. Buyers
get the same panel on the listing page, next to what this one is asking.

It reports last price, median, range, and the recent sales behind them — **settled sales
only**, per unit. An asking price nobody paid is not evidence: a listing sitting unsold at ten
million says only that ten million was too much, and counting it would let anyone set a
market by posting a listing they never intend to honour. Fewer than two distinct trading
pairs is flagged `thin`, on the same reasoning as the commodity mark.

When there is no history the panel says so in words — *nobody has traded one of these, the
number is your call, and it becomes the first data point everyone else sees* — rather than
showing a blank where a number goes. A first seller reading empty space as agreement is the
failure mode worth spending a sentence on.

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
| Catalogue sync | daily, 04:00 UTC (`apps/server/src/jobs/sync-items.ts`) |
| Player-entry prune | unused for 30 days |

## Known limits

- **Self-declared balances.** As everywhere on KCX, the buyer's aUEC is a number they typed.
  The collateral rules raise the cost of bidding on things you can't pay for; they don't
  make it impossible.
- **No item verification.** Nothing confirms the seller owns what they're listing, or that
  the photos are theirs. Standing and the public record of failed settlements are the only
  signals, which is why both are on every card.
- **The item link is self-reported.** A seller can attach any catalogue entry to any listing,
  so price history is only as honest as the people naming their goods. Nothing detects a
  Cutlass listed as a Polaris — the picture and the standing are what a buyer has.
- **UEX names are not always in-game names.** The catalogue is crowdsourced upstream, so an
  item may be listed under a name nobody sees in their inventory. That is exactly what the
  type-it-yourself path is for, and why those entries are adopted rather than discarded.
- **Sellers post nothing.** A seller who never turns up loses standing and nothing else.
