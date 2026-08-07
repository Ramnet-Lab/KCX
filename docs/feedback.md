# Feedback and the inbox

The suggestion box on the front page, the moderator queue that reads it, and the per-user
inbox the answer comes back through.

## Why it's on the main page

The things worth hearing about are the ones somebody notices *while using the site*. A form
behind a "Feedback" link in the footer collects only the complaints stubborn enough to
survive a search for it, which is a biased sample of the loudest problems and none of the
small ones. The cost is one column of a wide monitor.

That column is the page's right **margin**, not a slice of the content. `main` is capped at
`max-w-6xl` and centred, so a wide screen has dead space either side of it; at ≥1800px the
dashboard grid spills into that space with a negative right margin and gives the rail a
column of its own. The chart and the ticker wall keep exactly the width they had. Below
1800px there is no margin worth the name, so the grid collapses and the panel sits under the
chart at full width.

The panel lays its own form out with **container queries** rather than media queries, because
it lives in two very different shapes at the same window width: a 19rem rail, and a
full-width block. Only the panel's own width can tell those apart.

## Signed-in only

Every request gets answered into the author's inbox, and there is nowhere to deliver an
anonymous one. An unauthenticated box on the front page is a spam endpoint with extra steps.
Signed out, the panel says what it is and points at sign-in rather than taking input it would
then have to throw away.

The only other gate is **five a day per person** (`FEEDBACK_DAILY_LIMIT`) — a cap an honest
user never notices and a script hits immediately. There is no global cap and no queue depth
limit: one person flooding is the problem worth solving, and the exchange having a lot to
answer is not.

## Two tables, not one thread

`feature_requests` is a thing somebody asked for, that a moderator triages.
`user_messages` is a thing delivered to one person's inbox.

Modelling the answer as a reply row on the request would mean the only way to tell a trader
anything is to invent a request for them to have made. So the inbox is generic from the
start: subject, body, an optional link, and an optional foreign key back to the request that
prompted it. Anything else that needs to reach a specific person — a moderation note, a
settlement warning — uses the same table instead of growing a second notification system
next to it.

Distinct from `price_alerts`, which is a machine-generated feed of things that happened to
the market and is read as a batch (one "mark all read" and the badge is answered). Inbox
messages are addressed to you by a person, so they carry **per-message** read state: having
opened one says nothing about the other three.

## Statuses

`new` → `reviewing` → `planned` → `shipped`, or `declined`.

`declined` is a decision and not a deletion. The author is told, and the record of the answer
stays. A suggestion box that silently swallows what it won't build teaches people not to use
it — and the second time somebody notices their idea vanished, it has cost more than the
reply would have.

The moderator badge counts requests that are **unanswered and still live** (`responded_at IS
NULL` and not shipped/declined), not requests that are `new`. Triaging is not replying, and
the thing the author is waiting on is the reply.

## The alert on the name

The unread count rides along on `GET /api/auth/session` rather than getting a request of its
own: the header needs it on every page, and that call already happens on every page. A failed
count degrades to zero and never costs anyone their sign-in state.

It renders on the display name itself rather than as a separate bell icon — the name is
already in the header at every width, and a second icon is one more thing to wrap onto a
second line on a phone. The name links to `/account#inbox` while anything is unread.

Clearing it from the inbox on `/account` reaches the header through `refreshSession()` in
`components/session-bar.tsx`, which re-reads the session and pushes it to every mounted
consumer. Without that broadcast the badge keeps claiming unread mail until a full page load,
which reads as the site being wrong rather than stale.

## Transactions

A reply writes the inbox message, stamps the request answered, moves its status, and records
the moderator action — in one transaction, the same rule the rest of moderation follows. An
answer the author never receives, and a request marked answered with nothing sent, are both
worse than the operation failing outright.

## Deleting

The recipient clearing a message soft-deletes it (`deleted_at`). The audit log names the
action; this is the text of it, and a recipient should not be able to erase the record that a
moderator sent something. Reads and deletes are scoped to the recipient **in the WHERE
clause** rather than checked first, so a caller passing somebody else's message id updates
nothing instead of racing a check.

## Checking it

```
ALLOW_DESTRUCTIVE_CHECKS=true pnpm check:feedback
```

36 assertions against a real database: the cap binds and is per-person, a reply reaches the
author's inbox and nobody else's, answering leaves the waiting count, the badge lights and
clears, one person can never read or delete another's mail, a deleted message leaves the
inbox but not the database, and every moderator action lands in the audit log.

## Known limits

- **No email or push.** The badge is the whole delivery mechanism, so somebody who never
  signs in again never sees the answer. That is the right trade while KCX stores no email
  address at all (see [auth-reference.md](auth-reference.md)).
- **No threading.** The author can't reply to a reply — they file another request. Worth
  revisiting the first time a moderator needs to ask a clarifying question and gets no way
  to receive the answer.
- **Requests are private.** Nobody can see anybody else's ideas or vote on them, so the same
  thing gets asked for five times and the queue can't show that it is popular. A public
  board is the obvious next step and deliberately not the first one: it needs moderation of
  its own before it is worth having.
