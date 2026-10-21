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
`npm run eval` scores the real analysis over fixed fixtures and
`npm run eval -- interview run <label>` does the same for the interview
feedback; both bill the model once per fixture (`npm run eval -- help`).

## Accounts and the Clerk webhook

Every row belongs to a `User` row keyed by the Clerk user id. The actions
that insert rows create it on the way (`ensureUser`), and Clerk's webhook
keeps it in step: `user.created` writes it, `user.deleted` removes the
account's analyses, rehearsals, feedback, CVs in the bucket and
conversations on the voice platform, then the row.

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

Every account has a plan (`User.plan`), and every number the app enforces
or shows lives in `lib/plans.ts`:

| | Free | Pro |
|---|---|---|
| Analyses | 3 a month, counted down on the upload page | 50 a month as a fair-use cap; the UI never shows the number, only the refusal when it is hit |
| Voice interviews | one 5-minute trial, once per account, on its own agent | 4 a month, 12 minutes each |
| Period | calendar month, UTC | calendar month, UTC, until billing replaces it with the billing period |

Billing is not built yet: every account is Free until it is set by hand.

```bash
npm run user:set-plan -- <clerkUserId> pro
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
call produces no candidate turns, if the session is lost with no reconnects
left, or if nobody comes back to it: an interview still in progress with
starts left and no session issued for two hours is expired, with the unit
refunded, the next time its owner's interviews or quotas are read (no
cron). Refunds mark the event; nothing is deleted.

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
`ELEVENLABS_TRIAL_AGENT_ID` in the production environment.

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
