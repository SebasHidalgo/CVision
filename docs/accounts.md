# Accounts, the Clerk webhook and deletion

Every row belongs to a `User` row keyed by the Clerk user id. The actions
that insert rows create it on the way (`ensureUser`, session-scoped, in
`lib/database/user.ts`), and Clerk's webhook keeps it in step through the
no-session functions in `lib/database/userById.ts`: `user.created` writes
it, `user.deleted` runs the account deletion below. The app stores the id
and nothing else about the person; email, name and avatar stay in Clerk.

## Who reaches what (the proxy)

`proxy.ts` reads one table, `APP_ROUTES` in `lib/routeAccess.ts`: every
page and route handler under `app/` by its URL, `public` or `signed-in`.
Public: the landing, pricing, the three legal pages, `robots.txt`, the
three webhooks and the two crons, each by exact path. A signed-out visit
to a signed-in page goes to Clerk's sign-in; a signed-out `/api/*` call
that is not public gets `401 { ok: false, code: "UNAUTHORIZED" }`. A path
that no page could serve goes on to Next's not-found instead of the sign-in
wall, decided on a deliberately loose reading of the path (decoded,
lower-cased, cut at a dot such as `.rsc`): anything that might reach a page
stays protected. `lib/routeAccess.test.ts` walks `app/` and fails when a
file has no row or a row has no file, and pins the list of public URLs.
`app/robots.ts` builds its allow and disallow lists from the same table.

## The webhook

Registered once per Clerk instance (development and production are
separate instances with separate endpoints and secrets), under Webhooks →
Add Endpoint:

- URL: `https://<host>/api/webhooks/clerk` (locally, the ngrok domain). The
  route is public in the middleware; the delivery is authenticated by its
  Svix signature over the raw body (`verifyWebhook` from
  `@clerk/nextjs/webhooks`).
- Events: `user.created` and `user.deleted`. Any other event is
  acknowledged and ignored.
- The endpoint's Signing Secret goes in `CLERK_WEBHOOK_SIGNING_SECRET`.

Answers: 500 without the secret (an operator error), 400 on a bad
signature, 500 on a failed write (Clerk retries), 200 for everything else,
duplicates included.

## Deleting an analysis

A control on the analysis page. `deleteAnalysisCascade` (`lib/deletion.ts`)
removes the row in a serializable transaction, cascading to the feedback,
every rehearsal and their feedback, and is refused with `ANALYSIS_BUSY`
while a rehearsal is in a call or being scored. Then, best effort and
logged with ids: the CV object is removed from the bucket and every
conversation the interviews issued is deleted at ElevenLabs. An external
failure never resurrects rows: the collector removes a CV without a row
within a day, and the platform expires a conversation after 30 days.

## Deleting the account

`user.deleted` → `deleteAccountCascade`: first every open subscription is
cancelled at Paddle, effective immediately (a failure is logged in capitals
with the user id and does not stop the deletion); then every analysis as
above; then whatever is left under `cv/{userId}/` in the bucket; then the
`User` row, which cascades the usage ledger, the billing customer and the
subscription mirrors. `BillingEvent` rows stay: they are the audit trail
and hold no personal data. Paddle keeps the customer, the transactions,
the invoices and the cancelled subscription for its own records.

If the owner enables "Allow users to delete their accounts" in Clerk, the
profile's delete button fires the same webhook. The browser suite's
accounts are deleted the same way, and `npm run e2e:cleanup` removes any
it left behind.

## When the webhook was lost

A `user.deleted` delivery that never arrives (the endpoint down past
Clerk's retries, a local tunnel closed) would keep the account's CV,
analyses and conversation ids forever. The reconcile is the net
(`lib/accountReconcile.ts`): it walks the `User` table in pages of 100,
asks Clerk's Backend API which ids still exist (`GET /v1/users?user_id=…`,
one call per page, plain `fetch` with `CLERK_SECRET_KEY`), confirms every
missing one by its own `GET /v1/users/{id}` (only a 404 that Clerk labels
`resource_not_found` counts as gone), then runs `deleteAccountCascade` for
each, exactly as the webhook would.

```
npm run users:reconcile                       # dry run: what would go
npm run users:reconcile -- --apply            # delete them
npm run users:reconcile -- --max-delete 17    # raise the guard's ceiling for this run
```

It fails closed:

- Every lookup happens before any delete. A 5xx, a 401/403, a timeout, a
  body of the wrong shape, a list naming an account that was not asked
  about (a filter Clerk ignored), or a 429 still there after three waits
  (by `Retry-After`, never more than 30 s) stops the run with nothing
  deleted (exit 1).
- **Blast-radius guard**: a run may delete at most a fifth of the accounts
  it checked, rounded down, and never more than 25. A key from another
  Clerk instance makes every account look gone; so does a Clerk list that
  drops rows. Over the limit, nothing is confirmed or deleted and the run
  says so (exit 2). An operator who has read the dry run passes the number
  they expect with `--max-delete`. A table under five accounts never
  deletes without it.
- Accounts whose row is younger than 24 hours are not looked up: their
  webhook may still be on its way.
- One audit line per deletion, with the Clerk id and counts only:
  `[CVision][reconcile-users] deleted user=<id> analyses=… objects=…
  conversations=… …`.

In production it runs daily as a Vercel cron (`vercel.json` →
`GET /api/cron/users-reconcile` at 03:47 UTC, before the storage collector
at 04:17, which sweeps anything a deletion left in the bucket),
authenticated by the same `CRON_SECRET` bearer and public in the proxy as
that exact path. The cron applies with every guard and no override: a
refusal answers 500 with `RECONCILE_REFUSED` and logs in capitals for a
human to look; a failed deletion or an unreadable Clerk answers
`RECONCILE_FAILED`. It starts no deletion after 40 s (`maxDuration` 60 s);
what is left goes the next day. The response carries counts only.

What each piece of data is, where it lives and how it goes: see
[data-inventory.md](data-inventory.md).
