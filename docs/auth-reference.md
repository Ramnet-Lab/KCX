# Auth implementation reference

Verified against **better-auth 1.6.25** + Next.js 16 + Drizzle/Postgres (researched 2026-08-03).
Kept here because several details differ from every tutorial online.

## Packages

```
better-auth@1.6.25
@better-auth/drizzle-adapter@1.6.25   # adapter is its OWN package now
```

CLI is `npx auth@latest generate` — **not** `npx @better-auth/cli` (frozen at 1.4.21).
`npx auth@latest migrate` does NOT work with Drizzle; use `drizzle-kit generate` + `migrate`.

Env: `BETTER_AUTH_SECRET` (32+ chars), `BETTER_AUTH_URL`.

## Required tables

Four tables: `user`, `session`, `account`, `verification`.

- **user**: `id` (PK text), `name` (notNull), `email` (notNull, unique), `emailVerified`
  (boolean notNull default false), `image`, `createdAt`, `updatedAt`.
- **session**: `id`, `expiresAt`, **`token`** (notNull unique — NOT `sessionToken`, that's
  Auth.js), `createdAt`, `updatedAt`, `ipAddress`, `userAgent`, `userId` (FK → user.id
  cascade, indexed).
- **account**: `id`, `accountId`, `providerId`, `userId` (FK cascade, indexed), `accessToken`,
  `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`,
  `password`, `createdAt`, `updatedAt`.
- **verification**: `id`, `identifier` (indexed), `value`, `expiresAt`, `createdAt`, `updatedAt`.

Only FKs: `session.userId` and `account.userId` → `user.id`, both ON DELETE CASCADE.

**The adapter resolves fields by the TypeScript property key, not the SQL column string.** So
TS keys must be exactly `emailVerified`, `userId`, `expiresAt`, … The quoted column name is
free-form (`camelCase: false` is the adapter default, so the generator emits snake_case columns
with camelCase TS keys).

`emailVerified` must be `boolean NOT NULL DEFAULT false` — making it a timestamp (Auth.js
style) is the classic migration error.

## Custom fields

`user.additionalFields` are REAL columns and must exist in the Drizzle schema. Keep
`required: false` — OAuth signup can't supply them and would fail. Use `input: false` for
anything the client must never set (balances, verification flags, role).

## Next.js integration

- Route handler: `app/api/auth/[...all]/route.ts` → `export const { GET, POST } = toNextJsHandler(auth)`
  from `better-auth/next-js`.
- `nextCookies()` plugin must be **last** in the plugins array.
- Server session: `auth.api.getSession({ headers: await headers() })` — `headers()` is async
  in Next 15/16.
- ⚠ **Next.js 16 removed `middleware.ts`.** It is now `proxy.ts` exporting a function named
  `proxy`. Route protection must be re-checked per page/route regardless — `getSessionCookie`
  only proves a cookie exists and is explicitly NOT authentication.

## Discord provider (if used)

- Redirect URI to register: `{BETTER_AUTH_URL}/api/auth/callback/discord`
- Default scopes `["identify","email"]`; `disableDefaultScope` + `scope` to override.
- ⚠ Discord returns `email: null` for phone-only accounts. Since `user.email` is NOT NULL,
  those signups fail — needs `mapProfileToUser` to synthesize a fallback.

## Other gotchas

- drizzle-orm peer is narrowed to `^0.45.2`; Drizzle 1.0-rc unsupported.
- Cookies are prefixed `better-auth.` (`better-auth.session_token`).
- `experimental: { joins: true }` goes at the top level of `betterAuth()`, not in the adapter,
  and needs Drizzle `relations()`.
- Session defaults: `expiresIn` 7d, `updateAge` 1d, `freshAge` 1d.

## Open decision

Sign-in method is NOT yet chosen — see the RSI-auth research. RSI has no OAuth/SSO, so the
candidates are Discord OAuth, or RSI-profile-bio verification as the primary identity with a
passkey/password for returning devices.
