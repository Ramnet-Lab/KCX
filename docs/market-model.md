# How the KCX price works

KCX publishes one number per commodity — the **mark**. This document says exactly where it
comes from, what can and cannot move it, and how to check it. If you only read one section,
read [What can move the mark](#what-can-move-the-mark).

## The ladder

The mark is the highest rung that applies:

| # | Rung | Source |
|---|------|--------|
| 1 | **Windowed VWAP** | Volume-weighted price of qualifying player fills in the last **72 hours**, once at least **10 SCU** has traded. |
| 2 | **Last print** | The most recent qualifying fill, however long ago. Never expires. |
| 3 | **NPC baseline** | The best terminal price, from the UEX feed. |

Rung 3 is a **seed, not a floor**. A commodity's first qualifying fill takes it off the
terminal price permanently. NPC prices keep being polled every 30 minutes, but from that
point they are context — the reference line on the chart — not the headline.

### Why not "the better of NPC and player"

The previous model displayed whichever of the two was better for the trader, and blended the
player VWAP toward the NPC baseline by volume. Both rules pushed the same way, and together
they made the player market almost impossible to see.

Terminals pay at most `best_sell` and charge at least `best_buy`, and `best_buy < best_sell`
— that gap is the hauling margin. Essentially all player-to-player trade clears *inside* that
gap, which is exactly where a better-of rule hides it: a price inside the band is neither
above `best_sell` nor below `best_buy`, so it lost on both sides. A player price could only
ever surface by beating the best terminal in the game.

Player price discovery is the product. It now sets the number.

## What can move the mark

Only a **settled, dual-confirmed contract** writes a print, and only a print that survives
every check below feeds the mark. Posting an order moves nothing. An order that expires
unfilled moves nothing.

Balances and cargo on KCX are **self-declared** — the platform never holds aUEC or cargo, and
Star Citizen has no API to verify either. So the "can they afford it" check at settlement is
a consistency check against a number the user typed, not an economic constraint. The tape is
therefore the only place manipulation can be caught, and a price band alone does not catch it:
two accounts can sit inside any band all day. The checks are mostly about **who** traded.

| Check | Rule | Rationale |
|---|---|---|
| `unverified` | Both parties must be RSI-verified at settlement. | An unverified account is free to create, so it is the cheapest possible input to a fake price. |
| `outlier` | Price must be within **0.25×–3.0×** of the same-side reference. | Catches fat fingers and blatant painting. Compared against the same side only — validating a buy print against a sell reference (as an earlier fallback chain did) makes the band meaningless for the raw ores terminals only buy, which are the most exposed commodities. No same-side reference means no price check; the rules below carry it. |
| `pair_rate_limit` | At most **3** qualifying prints between the same two accounts per commodity per **7 days**. | Repeated trade between two people is normal. Two people repeatedly *setting a public price* is not. |
| `share_cap` | No account may exceed **70%** of a commodity's 72h volume. Applies only once **3 distinct counterparty pairs** have traded. | A trader who is most of the volume *is* the price. Gated on pairs rather than print count so the first honest trader in a commodity isn't capped for being early — that case is already the pair limit's job. |

**Nothing is deleted.** A refused print still settles, still appears on the public tape, and
carries its reason. Silently dropping the inconvenient trades would leave the tape looking
cleanest exactly when someone was attempting something.

### Thin markets

A mark backed by fewer than **2 distinct counterparty pairs** is flagged `THIN` in the UI.
The flag never suppresses the price — hiding it would conceal the manipulation rather than
expose it. Counting *pairs* rather than prints is deliberate: one pair trading with itself
repeatedly is the cheapest way to fake a market, so counting prints would rate exactly the
wrong thing highly.

## Timing

Two things write market state, and they write the same two places
(`commodity_reference_points` for history, `commodity_marks_latest` for the current read):

- **The 30-minute poll** refreshes every commodity's NPC baseline.
- **A confirmed fill** refreshes that one commodity immediately.

A settlement writes a reference point at the instant it happens, so the trade lands in the
current candle bucket instead of waiting up to half an hour. Tiles, charts, the tape and the
sector indices all move on the same event.

## Sector indices

Chain-linked, equal-weight, base 1000:

```
index(t) = index(t−1) × mean over constituents of  value(t) / value(t−1)
```

Constituents are gap-filled to every tick with their last known value. A commodity that
starts trading later contributes no return on the step it first appears and starts
contributing afterwards, so a new listing does not move the index.

The earlier method — each capture as the mean of every commodity's price relative to its own
first-ever price — broke in two ways. New constituents joined at a relative of ~1.0 and
mechanically dragged their sector back toward 1000, and it grouped strictly by timestamp,
which was safe only while every point came from the same poll. Once a settlement could write
a point for one commodity at an off-poll instant, that commodity would have been 100% of the
index at that timestamp.

## Checking it yourself

- **The tape** on every commodity page lists recent settled trades, including the withheld
  ones and why. `GET /api/prints?commodityId=<id>`.
- **The chart** draws the mark as candles, with the NPC sell-to and buy-from as reference
  lines. `GET /api/candles?commodityId=<id>&period=1h`.
- **Change %** is measured over 24h where 24h of history exists, and *since tracking began*
  otherwise — marked with `*`, because the market wall sorts by this number and quietly
  calling a shorter window "24h" would be wrong in a way nobody could see.

## Constants

Defined in `packages/db/src/queries/mark.ts` and `packages/db/src/queries/print-integrity.ts`.

| Constant | Value |
|---|---|
| `MARK_WINDOW_HOURS` | 72 |
| `MARK_MIN_VOLUME_SCU` | 10 |
| `MARK_CONFIDENT_PAIRS` | 2 |
| `OUTLIER_LOW` / `OUTLIER_HIGH` | 0.25 / 3.0 |
| `PAIR_PRINT_LIMIT` / `PAIR_WINDOW_DAYS` | 3 / 7 |
| `MAX_ACCOUNT_VOLUME_SHARE` | 0.7 |
| `SHARE_CAP_MIN_PAIRS` | 3 |

## Known limits

- **Self-declared collateral.** The integrity rules raise the cost of manipulation; they do
  not make it impossible. A patient attacker with several verified handles and genuinely
  distinct counterparties can still influence a thin commodity. The `THIN` flag and the
  public tape exist so that this is visible rather than hidden.
- **Exclusions are decided once,** at settlement, and not re-evaluated if the reference later
  moves.
- **Legacy prints** written before parties were recorded contribute volume and a last price
  but no counterparty pairs, so commodities resting on them read as `THIN`.
