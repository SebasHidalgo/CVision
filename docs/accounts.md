# Accounts, the Clerk webhook and deletion

Every row belongs to a `User` row keyed by the Clerk user id. The actions
that insert rows create it on the way (`ensureUser`, session-scoped, in
`lib/database/user.ts`), and Clerk's webhook keeps it in step through the
no-session functions in `lib/database/userById.ts`: `user.created` writes
it, `user.deleted` runs the account deletion below. The app stores the id
and nothing else about the person; email, name and avatar stay in Clerk.

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

What each piece of data is, where it lives and how it goes: see
[data-inventory.md](data-inventory.md).
