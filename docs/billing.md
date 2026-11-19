# Plans, quotas, rate limits and billing

The reference for everything a user can be charged or refused. The
numbers live in `lib/plans.ts`, the prices in `lib/billing/catalog.ts`,
and nothing else hard-codes one.

## Plans

| | Free | Pro ($15 a month) |
|---|---|---|
| Analyses | 3 a month, counted down on the upload page | up to 50 a month, said that way on the landing, pricing, account, terms and the Paddle catalog; the upload page counts down only Free, so Pro sees the number again only in the refusal when it is hit |
| Voice interviews | one 5-minute trial, once, for an account that never had voice | 4 per billing period, 12 minutes each, then pack credits |
| Interview pack | — | $9 one-time, 4 credits, bought while Pro is in force; each credit is a full 12-minute interview, usable on any plan, never expires |
| History | everything | everything (the limits apply to what you create, never to what you see) |
| Period | calendar month, UTC | the subscription's billing period (calendar month for a comped Pro) |

The plan is derived, never stored (`lib/billing/access.ts`): a subscription
whose status grants access (`active`, `trialing`, `past_due`; not `paused`
or `canceled`; a scheduled cancellation keeps Pro until it takes effect),
else a manual comp, else Free. The comp is for the owner's own account and
testers:

```bash
npm run user:set-plan -- <clerkUserId> pro    # sets User.compPlan; never overrides or cancels a subscription
npm run user:set-plan -- <clerkUserId> free   # clears it
```

## The usage ledger

Usage is a ledger (`UsageEvent`). An analysis reserves its unit before the
CV is downloaded and the model is called, and only a stored analysis keeps
it: every failure gives the unit back, the user's own file included. Once
the key is known to be the caller's, a refused analysis also removes the
uploaded object.

A request killed by its `maxDuration` never runs its own refund, so the
unit is spent for good (`settledAt`) only in the transaction that saves the
analysis row, and only while it is still held: no request can die between
the charge and the row. A held unit older than any request
can live, never settled, belonged to a dead request: a retry of the same
submission gives it back before it reserves, and the daily cron
(`/api/cron/storage-gc`, `refundAbandonedAnalyses`) gives back the rest
after an hour, when no analysis row exists under it. A request that comes
back after its unit was given back cannot settle it and saves nothing: it
answers with the analysis the retry saved, or `ANALYSIS_IN_PROGRESS`, and
removes its own upload. A
settled unit (its analysis deleted since) is never given back.

An interview reserves on its first session token, which is the moment it
costs, and gets the unit back if the token is not issued, if the call
produces no candidate turns, if the platform has no record of the session,
if the platform reports it could not run the call at all (`CALL_FAILED`,
which also gives the start back: the cap of three starts is for the
candidate's microphone and connection, not for the platform's outages), or
if nobody comes back to it: an interview still in progress with no session
issued for two hours is expired, with the unit refunded, the next time its
owner's interviews or quotas are read (no cron). Refunds mark the event;
nothing is deleted, and the refund and the forgotten reservation are one
transaction. Which interview a start gets (a Pro's period interview, a
credit on the main agent for twelve minutes, the five-minute trial, or
nothing) is decided in one place, `lib/interviewEntitlement.ts`, read by
the pages, the create action and the session endpoint alike.

The trial is also one per email, across deleted and re-created accounts.
When it would otherwise be offered, the account's verified emails are read
from Clerk, normalized (`lib/trialClaim.ts`: lowercase, `+tag` cut on every
domain, `-tag` on Yahoo's, Gmail dots removed, googlemail.com read as
gmail.com) and hashed with HMAC-SHA256 keyed by the server-only
`TRIAL_CLAIM_PEPPER`; any hash in `TrialClaim` means no trial (reason
`trial-claimed`: the room, the analysis page, `/account` and `/pricing` say
the email already used it, with the Pro offer). Spending the trial inserts
one `TrialClaim` per hash in the reservation's transaction and keeps the
hashes on the unit (`trialClaimHashes`); a claim another account took first
is the quota refusal. A refund of that unit deletes them in its
transaction; account deletion never does (no FK). Fail closed: no pepper
(or under 32 characters; one loud log line per ten minutes), no verified
email, or Clerk not answering means no trial (reason `trial-unavailable`,
shown as the generic Pro line), never a failed Pro or credit start. Set the
pepper once per environment and never rotate it: a new value forgets every
claim.

## Rate limits

Hourly, per user, the same for both plans: 10 analyses, 20 upload URLs, 6
interview starts, 3 interview creations, 10 checkouts, 10 portal links, 6
"Check again"; and 60 status polls a minute. A refusal answers
`RATE_LIMITED` with `Retry-After`. Webhooks are not limited.

## Guardrail statistics

Both guardrails record what they did beside the row they guarded
(`guardStats`) and, in the same transaction, add it to an anonymous daily
aggregate (`GuardStatDaily`). The per-row stats go when their account goes;
the aggregate stays, and `npm run report:guards [-- --from YYYY-MM-DD --to
YYYY-MM-DD]` reads it. A Gemini 429 writes one structured log line
(`[CVision][ai] rate limited:`) before reaching the user as "The analysis
service is busy".

## Billing (Paddle)

Payments go through Paddle Billing as merchant of record, behind
`lib/billing/` (the app's own contract) and `lib/billing/paddle/` (the only
code that imports the Paddle SDK; a test keeps it that way). Everything in
this repo runs against the **sandbox**; production is the deploy phase.
`PADDLE_ENV` has no default; the key and the token must belong to the
environment it names.

### The API key's permissions

| Permission | Needed by |
|---|---|
| `product.read`, `product.write`, `price.read`, `price.write` | `billing:sync` (the catalog as code) |
| `transaction.read`, `transaction.write` | every checkout (the server creates the transaction); the reconcile lists the completed ones |
| `subscription.read`, `subscription.write` | the reconcile; cancelling at account deletion |
| `customer.read` | the reconcile and the doctor |
| `customer_portal_session.write` | "Manage subscription" (without it the portal answers `forbidden`) |
| `notification_setting.read`, `notification_setting.write` | `billing:sync` (the webhook destination) |
| `checkout_settings.read` | `billing:doctor` (verifies the default payment link) |

A missing permission surfaces as `forbidden`, and the server log names the
one the call needed.

### The default payment link

Paddle refuses to create any transaction without it
(`transaction_default_checkout_url_not_set`). Paddle → Checkout → Checkout
settings → Default payment link. In the sandbox any https URL of yours
works, the tunnel's `/pricing` included; in production only a domain
approved under Checkout → Website approval.

### The catalog and the webhook as code

```bash
npm run billing:sync -- --webhook-url https://<host>/api/webhooks/paddle
```

Idempotent: products and prices are found by their key and created or
updated to match `lib/billing/catalog.ts`; the destination is found by its
description (the brand name) or by its URL, so one made by hand is
recognised and kept. It prints `PADDLE_PRICE_PRO_MONTHLY`,
`PADDLE_PRICE_INTERVIEW_PACK` and `PADDLE_WEBHOOK_SECRET`. If the key may
not create or update destinations, the sync says so (exit code 2) and
lists what to do by hand: that URL, the eleven events in
`SUBSCRIBED_EVENTS`, traffic source "all". Never keep two destinations for
the route: every event would arrive twice. Against production it requires
`--production` and `PADDLE_ENV=production` in the command's environment.

### The doctor

```bash
npm run billing:doctor -- --webhook-url https://<host>/api/webhooks/paddle
```

Read-only. One line per check, PASS, FAIL or SKIP, each failure with the
exact fix: the environment and both tokens; every read permission; the
portal permission (by minting a session that stores nothing); the default
payment link; the webhook destination, its events, its traffic source and
whether `PADDLE_WEBHOOK_SECRET` is that destination's secret; the price ids
in `.env` against the catalog. The write permissions that only a real write
could prove are listed as such. Exit code 1 when anything fails.

### Deliveries, retries and the reconcile

The sandbox retries a failed webhook delivery only twice within about two
minutes (production, for two days), and the SDK rejects a signature older
than five seconds: a cold route in development can lose the first
delivery (the browser suite warms the routes first). If a delivery is
lost, the subscription mirror repairs itself the next time the plan is
read while stale (once per ten minutes per subscription), and the account
page offers "Check again" when a checkout's confirmation is late. By hand:

```bash
npm run billing:reconcile                 # every user with a Paddle customer
npm run billing:reconcile -- <clerkUserId>
```

Both pull the subscriptions through the mirror and the completed
transactions through the same grant the webhook makes, so a pack that was
paid but whose event never arrived is credited then, once, by its
transaction id.

### Sandbox test cards

`4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined,
`4000 0027 6000 3184` succeeds once and then fails (for dunning), any
future expiry and any CVC. Real cards do not work in the sandbox. There is
no time travel in the sandbox: to end a subscription at once, cancel from
"Manage subscription" (the portal), or `POST /subscriptions/{id}/cancel`
with `effective_from: immediately` (what the browser suite does); refunds
made from the Paddle dashboard are approved automatically every ten
minutes in the sandbox and arrive as `adjustment.updated`.

### Paddle.js in the browser

Only `components/billing/paddle/` imports it. `Checkout.close()` emits
`checkout.closed` synchronously from inside `close()`: the outcome is
settled and the listener removed before the overlay is closed, and a test
replays that sequence. The button says "Opening checkout…" only until
`checkout.loaded`, then sits disabled under its own label while the
overlay is up.
