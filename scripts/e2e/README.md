# Browser click-through

Drives a real Chromium against a **local** dev server. Never point it at production — it
signs in, opens forms, and clicks privilege controls.

```sh
npm i playwright && npx playwright install chromium   # once, outside the pnpm workspace
node scripts/e2e/clickthrough.mjs                     # needs the dev server on :3000
```

Requires a local admin with a password. `apps/server/src/scripts/seed-ui-user.ts` creates one:

```sh
pnpm --filter @kcx/server exec tsx src/scripts/seed-ui-user.ts
```

## Why this exists

Status codes and server-rendered markup pass while the UI is broken. They cannot tell you
that a button's `onClick` is wired, that a tab renders a panel and not just a label, that a
form posts the field the API expects, or that a page throws in the console. Every check here
failed at least once against markup that looked correct:

- Sign-in has **no inputs** until you pick a route, so a naive selector finds nothing.
- The admin selects only exist on the Users tab *after* its fetch resolves — counting them
  from the Audit tab reports zero and blames the UI for the test's own navigation.
- The contract compose form is an **inline panel**, not a modal. Escape deliberately does not
  dismiss it: discarding a half-typed contract with no confirmation would be worse than the
  inconsistency with the order modal. The Close toggle is the affordance, so that is what is
  asserted.
- `ERR_ABORTED` on an in-flight fetch is a page navigating away, not a failure.
