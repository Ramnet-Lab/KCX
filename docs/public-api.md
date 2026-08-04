# The public API

KCX publishes a free, keyless, CORS-open read API at `/api/v1`, documented for humans at
`/developers`.

## Why this exists

It is a strategic move before it is a technical one.

KCX consumes UEX's feed for NPC terminal prices, commodity master data and the bazaar item
catalogue. That makes their feed a single point of failure held by a party who is also, on
the marketplace side, a competitor — and whose terms reserve the right to cut API access
"for any reason" (§5.7). Being purely a consumer of someone else's data is a bad position.

The one thing KCX produces that nobody else does is a price derived from **settled
player-to-player trades**. UEX's own marketplace trend data is, by their documentation,
built from listing asking prices. So publishing ours — in a stable, documented shape other
tools can build on — turns us from a consumer into a source. Tools that integrate a player
price have a reason to link back, and the dependency stops running only one way.

The secondary reason is accountability. A price feed whose method nobody can read is an
assertion. Everything needed to check our arithmetic is published: the tape per commodity,
the whole print history as CSV, and the rules in `market-model.md` and `bazaar.md`.

## Design rules

| Rule | Reason |
|---|---|
| **Versioned.** `/api/v1` shapes are a promise: fields get added, never repurposed or removed. | A consumer that has to re-check the shape on every deploy will not stay a consumer. |
| **CORS open (`*`).** | This is public data and most consumers are browser tools. Refusing cross-origin reads means every one of them needs a proxy. |
| **Short cache headers.** 60s on live prices, 300s on history. | Marks move on a settlement or a half-hourly poll, so a minute of staleness is invisible and absorbs hot loops. |
| **No rate limit; capped page sizes instead.** | This runs as one container, so an in-process limiter would be per-instance and reset on deploy. We would rather cap sizes and say so than run a counter that calls itself a quota. |
| **Attribution travels with the payload.** Every response carries a `notice` object. | Including the credit for UEX's NPC reference data, which is theirs, not ours. |

## The privacy line in the bulk export

The per-commodity tape (`/api/v1/commodities/{slug}/prints`) names both traders. That is
deliberate and matches the site: checking a specific price means checking who traded it, and
reputation is the trust model here.

`prints.csv` does **not**. A whole-history file is a different object from a single page —
it is about prices, and shipping one that makes mass profiling of individual traders trivial
is not the same thing as being auditable. Each row instead carries `pair_key`, a stable
order-independent hash of the two counterparties, which is what someone reproducing the
integrity rules actually needs: it groups trades by relationship without naming anybody.

## Endpoints

| Path | Gives you |
|---|---|
| `/api/v1` | Discovery, including how each number is computed. |
| `/api/v1/commodities` | Every commodity: mark, change, NPC references. `?playerPriced=1` filters to those with a real player price. |
| `/api/v1/commodities/{slug}` | One commodity in full. |
| `/api/v1/commodities/{slug}/prints` | The tape, including withheld prints and why. |
| `/api/v1/items` | Bazaar catalogue search (`?q=`). |
| `/api/v1/items/{id}/prices` | Settled bazaar sale history for one item. |
| `/api/v1/prints.csv` | Bulk tape download. `?since=` ISO 8601, `?limit=` up to 50,000. |

### The field most consumers get wrong

`mark` is null until a commodity has had a qualifying player fill; `price` falls back to the
NPC seed so tiles always have something to draw. **`hasPlayerPrice`** distinguishes them.
Quoting a seeded NPC price back as a player price is the easiest mistake to make with this
feed, which is why the flag is explicit rather than something to infer.

Similarly, `thin` on an item is only meaningful once something has sold — an item with no
history is not a thin market, it is no market, and `sales: 0` already says so.
