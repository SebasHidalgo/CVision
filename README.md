# CVision

Paste a job post, upload your CV, and find out how well you fit before you
apply. Then rehearse the interview out loud with a voice interviewer built
from that posting and your analysis, and get scored on what you said.

Next.js 15 (App Router), TypeScript, Clerk, Prisma on Supabase Postgres,
Gemini for the text analysis, ElevenLabs Agents for the voice interview.

## Running it

```bash
npm install
cp .env.template .env   # then fill it in
npm run db:deploy       # applies prisma/migrations to the database
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The analysis works
from there; the voice interview needs the tunnel described below.

## The database schema

The schema is versioned: `prisma/migrations` is the history, and the
database is only ever changed by applying a migration file. There is no
`db push`.

- `npm run db:migrate -- --create-only --name <what_changed>` after editing
  `prisma/schema.prisma`: Prisma writes the SQL into a new folder under
  `prisma/migrations`. **Read that SQL before applying it**: a renamed
  column arrives as a drop and an add, and a required column on a non-empty
  table needs a default or a backfill you write by hand into the file.
- `npm run db:deploy` applies what is pending; `npm run db:status` shows the
  history against the database.
- Migrations run over `DIRECT_URL` (port 5432, session mode), never over
  the transaction pooler. `migrate dev` also creates a temporary shadow
  database there; the Supabase `postgres` role can.
- **Every new table gets `ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;`
  in its migration.** Prisma does not model row-level security, and a
  database rebuilt from the history would otherwise come back with it off.
  The app connects as the table owner and bypasses RLS; nothing else may
  reach the tables (no policies, Data API off). `npm run db:check-rls` fails
  when any table in `public` has it off, and belongs on the deploy list.
- A migration that touches `_prisma_migrations` must say `IF EXISTS`:
  Prisma never creates that table in the shadow database.

On Windows, run `npm run db:migrate`, `npm run db:deploy` and
`npx prisma generate` with the dev server stopped: while it runs it holds
the Prisma query engine open, and regenerating the client fails with
`EPERM` when it tries to replace the engine file.

## Database connections

`DATABASE_URL` points at Supabase's transaction pooler (Supavisor, port
6543) and carries three parameters that Prisma reads:

| Parameter | Local | Vercel | Why |
|---|---|---|---|
| `pgbouncer=true` | yes | yes | the transaction pooler cannot hold prepared statements |
| `connection_limit` | 5 | 3 | Prisma's own pool, per Node process (see below) |
| `pool_timeout` | 20 | 15 | seconds a query waits for a pooled connection before failing with `P2024` |

Why the numbers differ. Locally one long-lived dev server serves every
page, the status polls of every open tab, the `after()` feedback generator
and the webhooks at once; with `connection_limit=1` (the value Supabase's
Prisma guide suggests for serverless) they all queued behind a single
connection, and a `user.deleted` delivery once waited the full 10 s for one
and failed with `P2024`, with Clerk's retry completing it. Nothing holds a
connection across external I/O (every `$transaction` in the app is
database-only: the usage reservation, the interview creation, the analysis
deletion, the analysis write and the feedback completion), so the queue was
pure concurrency, and five connections for one process is nowhere near the
pooler's limits. On Vercel a Fluid Compute instance also handles several
requests at once, but many instances run in parallel and all of them draw
on Supavisor's pool, so each gets fewer. Both values are small against the
pooler's capacity (200 client connections on the smallest compute); raise
them only with a measurement in hand. The example in `.env.template`
carries the local values.

Besides Clerk and the database, `.env` needs `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API → the
`service_role` key marked secret). The service role is read on the server
only; the browser never holds a Supabase key of any kind. The Clerk webhook
below needs `CLERK_WEBHOOK_SIGNING_SECRET`.

Before handing in a change: `npx tsc --noEmit`, `npm test`, `npm run build`.
`npm test` includes a smoke test of every `npm run` script that executes a
TypeScript entry (`scripts/scripts.test.ts`): each entry is loaded under its
own flags with `CVISION_SCRIPT_SMOKE=1` (which skips its `main()`) and the
network blocked, so a script whose import graph reaches something that
cannot load under `--conditions=react-server` (Next's client code, React,
Clerk, and so `lib/auth`) fails the suite rather than the terminal. A new
script needs that guard around its `main()` and its name in the test's list.
`npm run eval` scores the real analysis over fixed fixtures and
`npm run eval -- interview run <label>` does the same for the interview
feedback; both bill the model once per fixture (`npm run eval -- help`).

## Accounts and the Clerk webhook

Every row belongs to a `User` row keyed by the Clerk user id. The actions
that insert rows create it on the way (`ensureUser`), and Clerk's webhook
keeps it in step: `user.created` writes it, `user.deleted` cancels the
account's Paddle subscriptions (immediately, before anything else; a failure
is logged loudly with the user id and does not stop the deletion), then
removes the account's analyses, rehearsals, feedback, CVs in the bucket and
conversations on the voice platform, then the row. Paddle keeps the
customer, the transactions and the canceled subscription for its own
records.

Register the endpoint once per Clerk instance, in the Clerk dashboard under
Webhooks → Add Endpoint:

- URL: `https://<your host>/api/webhooks/clerk` (locally, the ngrok domain
  from the voice section). The route is public in the middleware; the
  delivery is authenticated by its Svix signature over the raw body.
- Events: `user.created` and `user.deleted`. Any other event is acknowledged
  and ignored.
- Copy the endpoint's Signing Secret into `.env` as
  `CLERK_WEBHOOK_SIGNING_SECRET` and restart the dev server.

A development instance and a production instance of Clerk are separate:
production needs its own keys in `.env` and its own endpoint with its own
secret.

Deleting one analysis is a control on its page: it takes the CV, the
analysis, every rehearsal and its feedback, and is refused while a rehearsal
is in a call or being scored.

## Plans, quotas and rate limits

Every number the app enforces or shows lives in `lib/plans.ts`, and the
prices in `lib/billing/catalog.ts`:

| | Free | Pro ($15 a month) |
|---|---|---|
| Analyses | 3 a month, counted down on the upload page | 50 a month as a fair-use cap; sold as unlimited, the UI never shows the number, only the refusal when it is hit |
| Voice interviews | one 5-minute trial, once, for an account that never had voice | 4 per billing period, 12 minutes each, then pack credits |
| Interview pack | — | $9 one-time, 4 credits, bought while Pro is in force; each credit is a full 12-minute interview, usable on any plan, never expires |
| History | the last 3 analyses; older ones are hidden, never deleted | everything |
| Period | calendar month, UTC | the subscription's billing period (calendar month for a comped Pro) |

The plan is derived, never stored: a subscription whose status grants
access (`active`, `trialing`, `past_due`; not `paused` or `canceled`; a
scheduled cancellation keeps Pro until it takes effect), else a manual comp,
else Free. The comp is for the owner's own account and testers:

```bash
npm run user:set-plan -- <clerkUserId> pro    # sets User.compPlan; never overrides or cancels a subscription
npm run user:set-plan -- <clerkUserId> free   # clears it
```

Usage is a ledger (`UsageEvent`). An analysis reserves its unit before the
CV is downloaded and the model is called, and only a stored analysis keeps
it: every failure gives the unit back, the user's own file included (a
scan, a renamed file, a damaged PDF never reach the model, so they cost
nothing; the hourly limit below is what bounds abuse). Once the key is
known to be the caller's, a refused analysis also removes the uploaded
object, so a losing tab at the last analysis of the month leaves nothing in
the bucket. An interview reserves on its first session token, which is the
moment it costs, and gets the unit back if the token is not issued, if the
call produces no candidate turns, the platform has no record of the
session, or the platform reports it could not run the call at all (at
once, whatever paid for it: a period interview, a credit or the trial;
while starts remain the interview forgets the reservation and the next
start reserves again), or if nobody comes back to it: an
interview still in progress with no session issued for two hours is
expired, with the unit refunded, the next time its owner's interviews or
quotas are read (no cron). Refunds mark the event; nothing is deleted.
Which interview a start gets (a Pro's period interview, a credit on the
main agent for twelve minutes, the five-minute trial, or nothing) is
decided in one place, `lib/interviewEntitlement.ts`, read by the pages,
the create action and the session endpoint alike.

On top of the quotas, hourly rate limits per user (the same for both
plans): 10 analyses, 20 upload URLs, 6 interview starts, 3 interview
creations, and 60 status polls a minute. A refusal answers
`RATE_LIMITED` with `Retry-After`. Webhooks are not limited.

Both guardrails record what they did beside the row they guarded
(`guardStats`) and, in the same transaction, add it to an anonymous daily
aggregate (`GuardStatDaily`: day, guardrail, check, action, count; no user,
no text). The per-row stats go when their account goes; the aggregate
stays, and it is what `npm run report:guards [-- --from YYYY-MM-DD --to
YYYY-MM-DD]` reads: rows with stats, rows where something fired, and the
counts per action and per check. A Gemini 429 writes one structured log
line (`[CVision][ai] rate limited:` with the quota id, metric, value and
the suggested wait) before it reaches the user as "The analysis service is
busy".

## Billing (Paddle)

Payments go through Paddle Billing as merchant of record, behind
`lib/billing/` (the app's own contract) and `lib/billing/paddle/` (the only
code that imports the Paddle SDK). Everything in this repo runs against the
**sandbox**; production is the deploy phase.

1. Create a sandbox account at `https://sandbox-vendors.paddle.com/signup`
   (separate from the live one). Under Developer tools → Authentication,
   create an API key with every permission CVision uses, and a client-side
   token. The permissions, by what needs them:

   | Permission | Needed by |
   |---|---|
   | `product.read`, `product.write`, `price.read`, `price.write` | `billing:sync` (the catalog as code) |
   | `transaction.read`, `transaction.write` | every checkout (the server creates the transaction); the reconcile lists the completed ones |
   | `subscription.read`, `subscription.write` | the reconcile; cancelling at account deletion |
   | `customer.read` | the reconcile and the doctor |
   | `customer_portal_session.write` | "Manage subscription" (without it the portal answers `forbidden`) |
   | `notification_setting.read`, `notification_setting.write` | `billing:sync` (the webhook destination) |
   | `checkout_settings.read` | `billing:doctor` (verifies the default payment link) |

   A missing permission surfaces as `forbidden`, and the server log names
   the one the call needed. An existing key's permissions are edited from
   the same page (open the key, tick, save).
2. In `.env`: `PADDLE_ENV=sandbox`, `PADDLE_API_KEY=pdl_sdbx_…`,
   `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_…`. `PADDLE_ENV` has no default;
   the key and the token must belong to the environment it names.
3. Set the **default payment link** (Paddle → Checkout → Checkout
   settings → Default payment link). Paddle refuses to create any
   transaction without it (`transaction_default_checkout_url_not_set`),
   so every checkout fails until it is set. In the sandbox any https URL of
   yours works, the tunnel's `/pricing` included; in production only a
   domain approved under Checkout → Website approval, so the production
   link can be set only after the domain review.
4. Push the catalog as code and the webhook destination, with the tunnel
   from the voice section running:

   ```bash
   npm run billing:sync -- --webhook-url https://<tunnel-host>/api/webhooks/paddle
   ```

   Idempotent: products and prices are found by their key and created or
   updated to match `lib/billing/catalog.ts`; the destination is found by
   its description ("CVision") or, failing that, by its URL, so one made by
   hand in the dashboard is recognised and kept under its own name, and its
   events are completed in place. It prints `PADDLE_PRICE_PRO_MONTHLY`,
   `PADDLE_PRICE_INTERVIEW_PACK` and `PADDLE_WEBHOOK_SECRET` to paste into
   `.env`, then restart the dev server. If the key may not create or update
   destinations, the sync says so (exit code 2) and lists what to do by
   hand in Paddle → Developer tools → Notifications: that URL, the eleven
   events in `SUBSCRIBED_EVENTS` (`lib/billing/paddle/catalog.ts`) and
   traffic source "all" (so the simulator reaches it too); copy its secret.
   Never keep two destinations for the route: every event would arrive
   twice.
5. Open the app through the tunnel URL and buy from `/pricing` with a
   sandbox test card: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002`
   is declined, `4000 0027 6000 3184` succeeds once and then fails (for
   dunning), any future expiry and any CVC. Real cards do not work in the
   sandbox.

Before every billing test, and before going live, check the account:

```bash
npm run billing:doctor -- --webhook-url https://<tunnel-host>/api/webhooks/paddle
```

Read-only. One line per check, PASS, FAIL or SKIP, each failure with the
exact fix: the environment and both tokens; every read permission (by a
list of one item); the portal permission (by minting a session that
stores nothing); the default payment link (through the checkout settings
endpoint, which needs `checkout_settings.read`); the webhook destination,
its events, its traffic source and whether `PADDLE_WEBHOOK_SECRET` is
that destination's secret; and the price ids in `.env` against the
catalog. The write permissions that only a real write could prove are
listed as such. Exit code 1 when anything fails.

The sandbox retries a failed webhook delivery only twice within about two
minutes (production, for two days), and the SDK rejects a signature older
than five seconds. If a delivery is lost, the subscription mirror repairs
itself the next time the plan is read while stale (once per ten minutes
per subscription), and the account page offers "Check again" when a
checkout's confirmation is late, which pulls the same records for the
signed-in user. By hand:

```bash
npm run billing:reconcile                 # every user with a Paddle customer
npm run billing:reconcile -- <clerkUserId>
```

Both pull the subscriptions through the mirror and the completed
transactions through the same grant the webhook makes, so a pack that was
paid but whose event never arrived is credited then, once, by its
transaction id.

There is no time travel in the sandbox. To end a subscription at once, use
"Manage subscription" (the portal) and cancel, or `PATCH /subscriptions/{id}`
with `scheduled_change: null` to undo a scheduled cancellation; refunds made
from the Paddle dashboard are approved automatically every ten minutes in
the sandbox and arrive as `adjustment.updated`.

## File storage

CVs live in one private Supabase Storage bucket, `files-bucket`, under
`cv/{userId}/{uuid}.pdf`. Every storage call goes through
`lib/supabase/server.ts` with the service role.

The upload never passes through a server function:

1. `createResumeUploadAction` mints a key under the caller's prefix and a
   single-use signed upload URL.
2. The browser PUTs the PDF to that URL with the file, its type and
   `cache-control: max-age=0` (stored with the object, so a deleted CV
   stops being served from the CDN within seconds rather than an hour),
   nothing else. The bucket refuses anything that is not `application/pdf`
   or is over the limit in `lib/uploadLimits.ts`.
3. `analyzeResumeAction` receives the key, checks it is the caller's,
   downloads the object, checks the PDF header and the size, parses the
   text and runs the analysis as before.

The CV drawer reads through a signed URL minted when the drawer opens,
valid for ten minutes.

`npm run storage:bucket` applies the bucket settings from code (private,
PDF only, size cap) and verifies them: the old public URL must answer 400
and a signed URL must serve the PDF. It also lists the row-level policies
on `storage.objects`, which the Storage API cannot change. **No policy
should exist for the `anon` or `public` roles**: the service role bypasses
policies, and nothing else should reach the bucket. If the listing shows
any (a Supabase project created with the "give anon full access" template
has four), drop them in the dashboard under Storage → Policies.

`npm run storage:gc` lists every object with a verdict and deletes nothing;
`npm run storage:gc -- --delete` removes the orphans: objects under `cv/`
that no analysis references and that are older than a day (an upload in
progress has no row yet), and anything outside `cv/`. Run it by hand until
deploy, then as a Vercel cron.

## Before a deploy

`npx tsc --noEmit`, `npm test`, `npm run build`, `npm run db:status` (no
pending migration), `npm run db:check-rls`, `npm run storage:gc` (dry run,
nothing unexpected), `npm run eval -- canary <label>` (the model has not
drifted). Then, for the limits: email verification required at sign-up in
Clerk (Dashboard → Configure → User & authentication → Email address →
"Verify at sign-up"; without it a throwaway account is a free 5-minute
interview each), and `npm run agent:sync` run against the production
webhook so **both** agents exist, with `ELEVENLABS_AGENT_ID` and
`ELEVENLABS_TRIAL_AGENT_ID` in the production environment. For billing: a
production Paddle account, its domain review passed (it needs `/terms`,
`/privacy` and `/refunds` with real text, not the drafts; replace
`LEGAL_ENTITY_NAME` and `LEGAL_CONTACT_EMAIL` in `lib/legal.ts`), the
production **default payment link** set once the domain is approved, a
production API key with every permission in the table above (the portal's
included), `npm run billing:sync -- --webhook-url
https://<domain>/api/webhooks/paddle --production` run with
`PADDLE_ENV=production`, which must exist **only** in the deployed
environment, the price ids, the webhook secret, the live API key and the
`live_` client token in Vercel's env, and `npm run billing:doctor --
--webhook-url https://<domain>/api/webhooks/paddle --production` passing
against production before the first real checkout.

## Voice interview: local development

The mock interview runs on ElevenLabs Agents. The browser gets a single-use
conversation token from `POST /api/interview/[id]/session` and talks to
ElevenLabs over WebRTC; the transcript comes back to the server by webhook
(`POST /api/webhooks/elevenlabs`), which is what triggers the feedback. The
webhook needs a public URL, so local development needs a tunnel. (If the
webhook never arrives, the server fetches the conversation itself once the
call must be over, so a lost delivery costs time, not the interview.)

1. Put the key in `.env` (see `.env.template`): `ELEVENLABS_API_KEY`. Leave
   `ELEVENLABS_AGENT_ID`, `ELEVENLABS_TRIAL_AGENT_ID` and
   `ELEVENLABS_WEBHOOK_SECRET` empty the first time.

2. Start the tunnel to the dev server's port. Use ngrok's free static domain
   (one per account, reserved once in the ngrok dashboard under Domains), so
   the URL survives restarts and the webhook never has to be recreated:

   ```bash
   ngrok http --url=<your-domain>.ngrok-free.app 3000
   ```

   A plain `ngrok http 3000` also works, but its URL changes on every
   restart, and a webhook's URL cannot be edited once created: each new URL
   means re-running the sync below with `--replace-webhook`, which deletes
   and recreates the webhook and prints a new secret to put in `.env`.

3. Push the two agents (the 12-minute interviewer and the 5-minute trial,
   both defined in `lib/elevenlabs/agentConfig.ts`) and create the post-call
   webhook they share, once:

   ```bash
   npm run agent:sync -- --webhook-url https://<tunnel-host>/api/webhooks/elevenlabs
   ```

   It prints each agent's id and, when it creates the webhook, the webhook
   secret. Put them in `.env` as `ELEVENLABS_AGENT_ID`,
   `ELEVENLABS_TRIAL_AGENT_ID` and `ELEVENLABS_WEBHOOK_SECRET`, then restart
   the dev server so it reads them. Re-run the same command after any change
   to `agentConfig.ts` or the interviewer prompt: the dashboard mirrors the
   code, not the other way round. With a changed tunnel URL:

   ```bash
   npm run agent:sync -- --webhook-url https://<new-host>/api/webhooks/elevenlabs --replace-webhook
   ```

4. Run the app and open it **through the tunnel URL**, not localhost, so the
   same origin serves the page, the session endpoint and the webhook:

   ```bash
   npm run dev
   ```

   The microphone requires a secure context; the tunnel is https, and so is
   the phone test. Interviews work on a phone over the same URL. ngrok's
   free tier shows an interstitial page the first time a browser opens the
   URL; it does not affect the webhook.

5. To check the agents as the platform holds them (limits, auth, webhook,
   the `end_call` tool), run the sync again: it prints the effective
   settings of both and every field in which they differ, and flags any
   difference that is not one of the intended ones (name, tags, duration,
   daily cap, placeholders).
