# KCX — Kestrel Commodities Exchange

Player-driven commodities exchange for Star Citizen: a market-data terminal (per-terminal NPC
prices, charts) fused with a player order board (buy/sell listings settled in-game, dual
confirmation, reputation). Free, non-commercial fan project.

This is an unofficial Star Citizen fan site, not affiliated with the Cloud Imperium group of
companies. All content on this site not authored by its host or users are property of their
respective owners.

## Dev setup (Windows)

Requirements: Node 24 LTS, pnpm (`npm i -g pnpm`). PostgreSQL 17 runs from portable binaries
in `tools/pgsql` (not committed — see below), data in `.pgdata/`, port **5433**.

```
pnpm install
pnpm db:start        # starts portable Postgres on :5433
pnpm db:push         # sync Drizzle schema to the dev DB
pnpm ingest          # one-off pull of UEX master data + latest prices
pnpm dev             # Next.js on http://localhost:3000
```

`tools/pgsql` comes from the EDB "binaries only" zip
(`postgresql-17.x-windows-x64-binaries.zip`) extracted into `tools/`. Prod uses
`postgres:17` via Docker Compose instead.

## Layout

- `apps/web` — Next.js site (public terminal pages + authed app)
- `apps/server` — persistent Node process: socket.io + pg-boss jobs (M1: ingest script only)
- `packages/db` — Drizzle schema, migrations, client
- `packages/shared` — zod schemas for UEX payloads, constants, shared pure logic

Data: commodity master data and NPC terminal prices courtesy of the
[UEX API](https://uexcorp.space/api/documentation/) (crowdsourced) — displayed with
attribution. KCX never holds aUEC or cargo; all player trades settle in-game bilaterally.
