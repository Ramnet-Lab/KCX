# Scope: spatial pricing

**Status:** proposed, not built. This is the design for making the mark a function of *where*,
not just *what*.

## The problem

KCX publishes one mark per commodity. Commodity value in Star Citizen is not one number — it
is a function of location, quantity, and time. The entire trade loop is spatial arbitrage:
buy at A, sell at B, and the difference pays for the trip. A galaxy-wide scalar erases the
only dimension the game is actually about.

The measurements, from the live dataset (204 tradable commodities, 123 currently priced):

| | |
|---|---|
| Commodities with **no NPC purchase price at all** | **36** — mined, refined, salvaged. Players are the only source. |
| Commodities NPCs sell but never buy | 10 |
| Commodities with both NPC sides | 77 |
| Of those, **best-sell and best-buy in different star systems** | **54 (70%)** |

That last row is the headline. For 70% of two-sided commodities, the two NPC figures KCX
displays side by side are not in the same system. They were being presented as though they
were a spread. They are two prices in two places.

We have since labelled both figures with their terminal and system (shipped — see
`commodity_marks_latest.best_sell_terminal` and friends). That makes the display honest. It
does not make the *model* spatial, which is what this document is about.

## What "spatial" would mean

Three candidate models, increasing in cost and fidelity.

### A. System-scoped marks — recommended

One mark per (commodity, system). Stanton Titanium and Pyro Titanium become distinct prices.

- **Why this one:** it matches how players already think and talk ("what's it going for in
  Pyro"), the cardinality is tiny (96 systems, realistically 2–3 with any liquidity), and the
  data already exists — `orders.location_id` is populated and `terminals` roll up to systems
  via the recursive walk already written in `market-point.ts`.
- **Liquidity risk:** splitting an already-thin tape across systems makes each thinner. Needs
  a fallback: show the system mark where one exists, otherwise the global mark labelled as
  such. Without the fallback most (commodity, system) cells would be empty at launch.

### B. Region/route-scoped marks

Group systems into trade regions, or price *routes* (A→B) rather than places.

- Closer to how hauling actually works — the tradeable quantity is the route, not the ore.
- But there is no natural region taxonomy in the data, routes are O(n²), and it is a much
  harder thing to explain on a tile. Defer.

### C. Delivered price

Mark plus modelled transit cost (fuel, time, risk) to the viewer's location.

- The most truthful answer, and unbuildable at present: we have no reliable distance table,
  no fuel model, and no way to know where the viewer is. Revisit only if a distance dataset
  appears.

**Recommendation: A, with a global fallback and explicit labelling of which is being shown.**

## Also in scope: stock-aware baselines

The same "price is not scalar" problem in a different dimension. We already ingest `scu_buy`,
`scu_sell` and `scu_sell_stock` and then discard them. The cheapest terminal holding 1 SCU is
not the cheapest terminal holding 700 — a Hull-C cannot be filled at the price we display.

Cheap version: alongside `best_buy`, store `best_buy_for_bulk` — the cheapest terminal
holding at least some threshold (say 100 SCU). Two extra columns, same capture pass, no new
concepts. Worth doing whether or not A happens.

## Work

### Schema

- `commodity_marks_latest` → `commodity_marks` keyed `(commodity_id, scope)` where scope is a
  system id or `0` for global. The global row remains, so every existing read keeps working
  during migration.
- `trade_prints` gains `system_id`, derived from the order's `location_id` at settlement.
  Prints without a location contribute to the global mark only — this is the crux, and it
  means the order form should push harder for a location than it currently does
  (`orders.location_flexible` defaults to true).
- `commodity_reference_points` unchanged: the NPC baseline is already per-terminal upstream,
  so per-system baselines are an aggregation change, not a schema change.

### Query layer

- `marketStatsCte` takes an optional system and groups by it.
- `judgePrint` scopes pair limits and share caps per system. **Note the risk:** scoping makes
  each pool smaller, so the share cap trips more readily — thresholds need re-tuning against
  real data, not carried over.
- `tickerEntries` takes a scope, defaulting to global.

### UI

- System selector on the wall and the commodity page; remembered per browser like collections.
- Every price labelled with its scope. A system mark that fell back to global must say so —
  an unlabelled fallback is the same class of bug as the better-of rule we just removed.
- The tape filters by system.

### Derived series

- Candles gain a scope dimension (`reference_candles` PK becomes 4-wide) — the biggest single
  piece of work here, and the one most likely to need a backfill.
- **Sector indices stay global.** An index is a market-wide aggregate; per-system indices
  would be a separate product with its own methodology, not a variant of this one.

## Effort

Roughly: schema and capture 1–2 days; query layer 2 days; candles and backfill 2 days; UI
2 days; re-tuning the integrity thresholds against real per-system volume, unknown and
gated on having that volume. Call it **a week and a half**, plus tuning that cannot be
scheduled because it depends on data we do not yet have.

## Do it when

Not yet, and the reason is liquidity rather than effort. With 2 prints on the whole exchange,
splitting the tape by system yields empty cells and a fallback shown almost everywhere — all
the cost, none of the fidelity.

Trigger: **a system other than Stanton accumulates enough prints to sustain its own mark** —
concretely, ≥3 distinct counterparty pairs trading a commodity within a 72h window in that
system, which is the same bar `MARK_CONFIDENT_PAIRS` and `SHARE_CAP_MIN_PAIRS` already use
for "this price means something".

Until then the shipped labelling carries the honesty, and the stock-aware baseline is the
better next increment: it is two columns, it needs no liquidity to be useful, and it fixes a
case where the displayed price is simply unreachable at the quantity being discussed.

## Open questions

1. What is the right fallback when a system has no mark — global, nearest system, or nothing?
   "Nothing" is the most honest and the most useless.
2. Should an order with `location_flexible = true` print to the global mark, its stated
   system, or both? Both double-counts; global only makes flexible orders invisible locally.
3. Does a system-scoped tape make the pair-limit thresholds too tight to be usable at KCX's
   scale? Cannot be answered without the data, which is also the launch trigger above.
