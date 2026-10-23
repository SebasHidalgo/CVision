# CVision

Paste a job post, upload your CV, and find out how well you fit before you
apply. Then rehearse the interview out loud with a voice interviewer built
from that posting and your analysis, and get scored on what you said.

A self-assessment and practice tool for job seekers, used by a person on
their own application: nobody else sees the results, and the interviewer is
software. Next.js 16 (App Router), TypeScript, Clerk, Prisma on Supabase
Postgres, Gemini for the text analysis, ElevenLabs Agents for the voice
interview, Paddle as merchant of record. The product's name lives in one
file, `lib/brand.ts`.

Reference material, once you are running: [docs/database.md](docs/database.md),
[docs/accounts.md](docs/accounts.md), [docs/billing.md](docs/billing.md),
[docs/storage.md](docs/storage.md), [docs/voice.md](docs/voice.md),
[docs/data-inventory.md](docs/data-inventory.md).

## Getting started from zero

Everything below takes an empty machine to CVision running locally with
every feature working: analyses, voice interviews, sandbox purchases, the
browser suite. Steps link to each service's documentation; anything that
could not be verified against it is marked "⚠️ verify". No real money is
involved: Paddle runs in its sandbox and ElevenLabs on its free plan.

### 1. Prerequisites

- **Node.js 24** (`.nvmrc` says `24`; `package.json` `engines` pins `>=22`).
  Next.js 16 needs 20.9 or newer; Vercel's default is 24.x.
  https://nodejs.org or `nvm use` / `fnm use`. **npm 10+** comes with it.
- **git**.
- **ngrok** with a free account and its static domain
  (https://ngrok.com/docs/pricing-limits/free-plan-limits: the free plan
  gives one fixed dev domain). The webhooks of three services need a
  public URL to reach your machine.
- **Windows notes** (the project is developed on Windows 10):
  - Use PowerShell or Git Bash; every `npm run` script works in both.
  - Stop the dev server before `npm run db:migrate`, `npm run db:deploy`
    or `npx prisma generate`: while it runs it holds Prisma's query engine
    open and the regeneration fails with `EPERM`.
  - Do not run `npm run build` while `npm run dev` is up: both write to
    `.next` and the dev server answers a bare 500 until restarted.
  - `taskkill //F //IM node.exe //T` (Git Bash) or `taskkill /F /IM node.exe /T`
    (PowerShell) is the blunt way to stop a dev server that lost its terminal.

### 2. Clone and configure

```bash
git clone https://github.com/SebasHidalgo/CVision.git
cd CVision
npm ci
cp .env.template .env
```

`npm ci` also generates the Prisma client (the `postinstall` script runs
`prisma generate`; on a clean clone nothing else does, and without it
every script, the unit suite and the build fail with "@prisma/client did
not initialize yet") and installs Playwright's package; the browser
itself comes in step 10. Every variable in `.env`, what it is, where it comes from and
which step fills it:

| Variable | What | Where it comes from | Step |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | public base URL of this instance (metadata base); `http://localhost:3000` locally | you | 2 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | the Clerk development instance's keys (`pk_test_`, `sk_test_`) | Clerk Dashboard → API Keys | 5 |
| `CLERK_WEBHOOK_SIGNING_SECRET` | the Clerk webhook endpoint's secret | Clerk Dashboard → Webhooks → the endpoint | 5 |
| `DATABASE_URL` | Supabase transaction pooler, port 6543, with `pgbouncer=true&connection_limit=5&pool_timeout=20` | Supabase → Connect | 3 |
| `DIRECT_URL` | Supabase session pooler / direct, port 5432 (Prisma CLI and scripts only) | Supabase → Connect | 3 |
| `NEXT_PUBLIC_SUPABASE_URL` | the project URL (read on the server only) | Supabase → Project Settings → API | 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | the service role key (server only; bypasses storage policies) | Supabase → Project Settings → API | 3 |
| `ELEVENLABS_API_KEY` | an API key with the permissions in step 6 | ElevenLabs → Developers → API keys | 6 |
| `ELEVENLABS_AGENT_ID`, `ELEVENLABS_TRIAL_AGENT_ID` | the two agents `agent:sync` creates | printed by `npm run agent:sync` | 6 |
| `ELEVENLABS_WEBHOOK_SECRET` | the post-call webhook's secret | printed once by `npm run agent:sync` | 6 |
| `ELEVENLABS_BALANCE_FLOOR_CREDITS` | optional: credits below which starts are refused (default 12,000; 0 disables) | you | 6 |
| `AI_PROVIDER`, `AI_MODEL` | `google`, `gemini-3.5-flash-lite` | the template | 7 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | a Google AI Studio key | https://aistudio.google.com | 7 |
| `AI_TEMPERATURE`, `AI_SEED` | eval harness only; leave unset | — | 10 |
| `PADDLE_ENV` | `sandbox` (never anything else locally) | the template | 8 |
| `PADDLE_API_KEY`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | a sandbox API key (`pdl_sdbx_`) and client token (`test_`) | Paddle sandbox → Developer tools → Authentication | 8 |
| `PADDLE_PRICE_PRO_MONTHLY`, `PADDLE_PRICE_INTERVIEW_PACK`, `PADDLE_WEBHOOK_SECRET` | the catalog's price ids and the webhook destination's secret | printed by `npm run billing:sync` | 8 |
| `E2E_BASE_URL`, `E2E_PUBLIC_URL` | optional: where the browser suite goes (default localhost) and the tunnel the webhooks reach | you | 10 |
| `CSP_MODE` | optional: `report-only` to try a Content-Security-Policy change without enforcing it | you | — |
| `CRON_SECRET` | production only: the bearer Vercel sends to the collector's cron route | — | — |

### 3. Database (a Supabase development project)

Docs: https://supabase.com/docs/guides/database/connecting-to-postgres and
https://supabase.com/docs/guides/database/hardening-data-api

1. Create a project at https://supabase.com/dashboard (the free plan is
   fine for development). Region: pick one close to you; production will
   pin its own next to Vercel's region (see `vercel.json`). Keep the
   database password.
2. **Connect** (top of the dashboard): copy the **transaction pooler**
   string (port 6543) into `DATABASE_URL` and append
   `?pgbouncer=true&connection_limit=5&pool_timeout=20` (why those values:
   [docs/database.md](docs/database.md#connections)); copy the **session
   pooler / direct** string (port 5432) into `DIRECT_URL`. Put the
   password in both, URL-encoded.
3. Project Settings → API: the project URL into `NEXT_PUBLIC_SUPABASE_URL`,
   the `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`.
4. Turn the **Data API off**: Integrations → Data API → "Enable Data API"
   off (older dashboards: Project Settings → API → Data API Settings).
   The app reaches Postgres through Prisma only.
5. Build the database:

   ```bash
   npm run db:bootstrap
   ```

   It applies the migrations, runs `prisma/sql/bootstrap.sql` (row-level
   security on every table, revokes for `anon`/`authenticated`, the
   private CV bucket), then `db:check-rls` and `storage:setup --check`,
   and prints the report: every line PASS, every "must be empty" list
   empty. Idempotent; run it again after any failure.
6. Verify: `npm run db:status` says the schema is up to date;
   `npm run db:check-rls -- --report` shows `current_user=postgres`,
   `bypassrls=true` and `rls=true` on every table; in the dashboard,
   Storage → `files-bucket` is private with **zero policies**.

### 4. The tunnel

Clerk, ElevenLabs and Paddle deliver webhooks to your machine, and the
voice interview needs the page, the session endpoint and the webhook on
one public https origin. Reserve a static domain once in the ngrok
dashboard (Domains), then:

```bash
ngrok http --url=<your-static-domain> 3000
```

Keep it running whenever you develop. A static domain means a webhook's
URL never changes; ElevenLabs cannot edit a webhook's URL once created,
so a changing URL means recreating it with a new secret. ngrok's free
tier shows an interstitial page the first time a browser opens the URL;
webhooks are not affected. Put the domain in `.env` as
`E2E_PUBLIC_URL=https://<your-static-domain>` for the browser suite and
so the dev server allows the tunnel as an origin (`allowedDevOrigins` in
`next.config.ts` reads it).

### 5. Clerk (development instance)

Docs: https://clerk.com/docs/quickstarts/nextjs, https://clerk.com/docs/testing/playwright/overview

1. Create an application at https://dashboard.clerk.com; the development
   instance exists from the start. API Keys → `pk_test_…` and `sk_test_…`
   into `.env`.
2. User & authentication → Email: keep **"Verify at sign-up"** on
   (without it a throwaway account is a free interview). Protect → Rules
   (older dashboards: Attack protection): **Bot sign-up protection on**.
   It stays on: the browser suite works through Clerk's Testing Tokens.
3. Webhooks → Add Endpoint: URL `https://<your-static-domain>/api/webhooks/clerk`,
   events `user.created` and `user.deleted`; the Signing Secret into
   `CLERK_WEBHOOK_SIGNING_SECRET`. Details in [docs/accounts.md](docs/accounts.md).
4. Optional: User model → "Allow users to delete their accounts", so the
   profile's delete button runs the full deletion.
5. The browser suite needs nothing more: `@clerk/testing` fetches a
   Testing Token with `CLERK_SECRET_KEY` at the start of a run, creates
   accounts with `+clerk_test` addresses through the Backend API (no email
   is sent, the code is always 424242) and deletes them afterwards.

### 6. ElevenLabs (free plan)

Docs: https://elevenlabs.io/docs/eleven-agents, https://elevenlabs.io/pricing/agents

1. Create an account. The free plan allows 15 minutes of agent calls a
   month and **no commercial use**; enough to develop. When the minutes
   or credits run out, the app refuses a start honestly ("Voice interviews
   are temporarily unavailable. Nothing was charged.") or, if the key
   cannot read the balance, the platform drops the call and the app gives
   the start and the unit back.
2. Developers → API keys → Create, restricted, with these permissions
   (⚠️ verify the checkbox names in the dashboard; the API names them in
   its errors): **Conversational AI / Agents read and write** (session
   tokens, conversations, agents), **Webhooks read and write**
   (`agent:sync`), **User read** (`user_read`: the balance check before
   each start). Into `ELEVENLABS_API_KEY`.
3. With the tunnel up and the three ids/secret variables empty:

   ```bash
   npm run agent:sync -- --webhook-url https://<your-static-domain>/api/webhooks/elevenlabs
   ```

   It creates the two agents (12-minute interviewer, 5-minute trial) and
   the post-call webhook, and prints `ELEVENLABS_AGENT_ID`,
   `ELEVENLABS_TRIAL_AGENT_ID` and, once, `ELEVENLABS_WEBHOOK_SECRET`:
   into `.env`. Re-run the same command after any change to
   `lib/elevenlabs/agentConfig.ts` or the interviewer prompt; with a new
   tunnel URL add `--replace-webhook`.
4. Verify:

   ```bash
   npm run voice:doctor -- --webhook-url https://<your-static-domain>/api/webhooks/elevenlabs
   ```

   Every line PASS except the SKIPs it explains (the webhook's secret
   cannot be read back; write permissions are not proven without
   writing). How the voice side works: [docs/voice.md](docs/voice.md).

### 7. Gemini

Docs: https://ai.google.dev/gemini-api/docs/api-key, https://ai.google.dev/gemini-api/terms

Create a key at https://aistudio.google.com → API keys, into
`GOOGLE_GENERATIVE_AI_API_KEY`. For development with synthetic CVs the
free tier is fine. **For any real CV, the key's project must be on the
paid tier**: on the free tier Google may use prompts and responses to
improve its products and human reviewers may read them; on the paid tier
it does not (the terms, "Paid Services"). AI Studio's API keys page shows
the plan per project ("Paid"); "Set up billing" upgrades it.

### 8. Paddle (sandbox)

Docs: https://developer.paddle.com/build/onboarding/set-up-checklist,
https://developer.paddle.com/concepts/payment-methods/test-cards

1. Create a **sandbox** account at https://sandbox-vendors.paddle.com/signup
   (separate from any live account).
2. Developer tools → Authentication: an API key with every permission in
   the table in [docs/billing.md](docs/billing.md#the-api-keys-permissions)
   (thirteen; `customer_portal_session.write` and `checkout_settings.read`
   are the ones people forget) into `PADDLE_API_KEY`, and a client-side
   token into `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`. `PADDLE_ENV=sandbox`.
3. Checkout → Checkout settings → **Default payment link**:
   `https://<your-static-domain>/pricing`. Paddle refuses every
   transaction until it is set.
4. With the tunnel up:

   ```bash
   npm run billing:sync -- --webhook-url https://<your-static-domain>/api/webhooks/paddle
   ```

   It creates the products, the prices and the webhook destination from
   `lib/billing/catalog.ts` and prints `PADDLE_PRICE_PRO_MONTHLY`,
   `PADDLE_PRICE_INTERVIEW_PACK` and `PADDLE_WEBHOOK_SECRET`: into `.env`.
5. Verify:

   ```bash
   npm run billing:doctor -- --webhook-url https://<your-static-domain>/api/webhooks/paddle
   ```

   Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is
   declined; any future expiry, any CVC.

### 9. Run it

```bash
npm run dev
```

Open the app **through the tunnel URL** (`https://<your-static-domain>`),
not localhost, so the page, the session endpoint and the webhooks share
one https origin; `localhost:3000` works for everything except the voice
call's webhook round trip. Then:

1. Sign up (the code arrives by email). A `User` row appears.
2. **A first analysis**: New analysis → company, title, the posting's
   text, a PDF CV → about seven seconds → the analysis page.
3. **A first interview**: on the analysis page, "Try a 5-minute
   interview, free" → the room → Start. Speak; End. The feedback page
   shows "saving" while the transcript travels (about a minute), then the
   report.
4. **A sandbox purchase**: `/pricing` → Get Pro → the overlay → the test
   card → the account page says "Pro is active." once the webhook lands.
   Then a pack. Then cancel from "Manage subscription".

### 10. Tests

| Command | What |
|---|---|
| `npm test` | the unit suite (Vitest): contracts, schemas, routes, components in jsdom, the script smoke test (every `tsx` script loaded under its own flags with the network blocked), the brand and wording rules. No network. |
| `npx tsc --noEmit` and `npm run build` | type-check and production build; run both before handing in a change |
| `npm run e2e` | the browser suite (Playwright, Chromium; `npx playwright install chromium` once): sign-up with bot protection on, a Free account's trial labels, Pro from the account page and from pricing, a pack, a cancellation that keeps the credits usable, a closed overlay. Needs the tunnel up and `E2E_PUBLIC_URL`; creates and deletes its own accounts; starts the dev server if none is running. Screenshots, traces and the HTML report go to `e2e/.artifacts/` (ignored). |
| `npm run e2e:voice` | opt-in: one real Start on a trial with fake media devices, ended after three seconds, which spends seconds of platform time; it prints the outcome and the cost. |
| `npm run e2e:cleanup` | deletes every `+clerk_test` account a dead run left behind (`-- --dry-run` lists them) |
| `npm run eval` | the analysis over fixed fixtures, one paid model call per fixture; `npm run eval -- interview run <label>` for the feedback; `npm run eval -- canary <label>` compares one call byte for byte against a reference run, the drift detector for the model alias (`npm run eval -- help`) |

### 11. Script reference

| Script | One line |
|---|---|
| `npm run dev` | the dev server (Turbopack) on :3000 |
| `npm run build`, `npm start` | production build and server |
| `npm test` | Vitest, the unit suite |
| `npm run db:migrate -- --create-only --name <x>` | write a migration from `schema.prisma`; read its SQL before applying |
| `npm run db:deploy` | apply pending migrations over `DIRECT_URL` |
| `npm run db:status` | the migration history against the database |
| `npm run db:check-rls [-- --report]` | fail if any `public` table has RLS off; `--report` prints owners, policies, the connection role |
| `npm run db:bootstrap [-- --url … --yes-i-mean-this-database] [--skip-storage]` | migrations + `bootstrap.sql` + the checks + the report, for a new or rebuilt database |
| `npm run storage:setup [-- --check]` | create or correct the private CV bucket and verify it (`--check`: verify only) |
| `npm run storage:gc [-- --delete]` | the orphan collector: report, or delete |
| `npm run user:set-plan -- <clerkUserId> <free\|pro>` | a manual comp, outside billing |
| `npm run report:guards [-- --from … --to …]` | the guardrails' daily tallies |
| `npm run agent:sync [-- --webhook-url … --replace-webhook --dry-run]` | push both ElevenLabs agents and the post-call webhook from code |
| `npm run voice:doctor [-- --webhook-url …]` | check the ElevenLabs key, balance, agents and webhook, read-only |
| `npm run billing:sync [-- --webhook-url … --production]` | push the Paddle catalog and the webhook destination from code |
| `npm run billing:doctor [-- --webhook-url … --production]` | check the Paddle account, read-only |
| `npm run billing:reconcile [-- <clerkUserId>]` | repair subscription mirrors and lost pack grants from the provider |
| `npm run eval [-- …]` | the evaluation harness |
| `npm run e2e`, `npm run e2e:voice`, `npm run e2e:cleanup` | the browser suite |

### 12. Troubleshooting

- **`EPERM` from Prisma on Windows**: the dev server holds the query
  engine. Stop it, run the Prisma command (`npm install` included: its
  `postinstall` regenerates the client), start it again.
- **`@prisma/client did not initialize yet`**: the client was never
  generated (an install with `--ignore-scripts`, or a cached
  `node_modules`). `npx prisma generate`.
- **`P2024` (timed out fetching a connection from the pool)**: the
  process exhausted its own `connection_limit`. Locally it is 5; the
  value in `.env.template` is right, `1` is not. Raise it only with a
  measurement. See [docs/database.md](docs/database.md#connections).
- **A Paddle purchase never reaches the account page**: the sandbox
  retries a failed delivery only twice within about two minutes, and
  Paddle's signature expires after five seconds; a cold
  `api/webhooks/paddle` route (first compile under Turbopack) can miss
  the first delivery. "Check again" on the account page and
  `npm run billing:reconcile` repair it; the browser suite warms the
  routes first.
- **`transaction_default_checkout_url_not_set`**: the default payment
  link is missing in Paddle (step 8.3).
- **`forbidden` from Paddle, or `BILLING_PORTAL_UNAVAILABLE`**: the API
  key lacks a permission; the server log names it. The doctor lists the
  thirteen.
- **ElevenLabs `missing_permissions`**: the key lacks what the error
  names (`user_read` is the one the balance check needs); edit the key.
- **The interviewer never joins, the room goes straight to the feedback
  page, which says "The interviewer couldn't join the call"**: the
  ElevenLabs account is out of credits or minutes; nothing was charged
  and no start was used. With `user_read` on the key the room refuses
  before trying.
- **A script fails to load with `createContext is not a function`**: its
  import graph reached React or Next's client code (through `lib/auth`,
  usually) under `--conditions=react-server`. The smoke test names the
  chain; keep session wrappers out of modules scripts import.
- **Clerk's bot protection blocks Playwright**: the suite does not go
  through the sign-up form for its accounts (it creates them with the
  Backend API and signs in by token), and the one spec that does carries
  the Testing Token. If a run fails on Clerk, check `CLERK_SECRET_KEY`
  is the development instance's.
- **Webhooks never arrive**: the tunnel is down, or points at another
  port, or the webhook was registered against another URL. `curl -I
  https://<your-static-domain>/pricing` must answer 200;
  `voice:doctor` and `billing:doctor` print the URL each provider has.
- **"Refused to load …" in the browser console**: a third-party origin
  missing from the Content-Security-Policy in `lib/securityHeaders.ts`.
  Try a change with `CSP_MODE=report-only` and the browser suite, which
  records every CSP message in `e2e/.artifacts/csp.log`.
- **A dev server that survived its terminal**: `taskkill //F //IM node.exe //T`.
