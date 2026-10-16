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

Besides Clerk and the database, `.env` needs `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API → the
`service_role` key marked secret). The service role is read on the server
only; the browser never holds a Supabase key of any kind.

Before handing in a change: `npx tsc --noEmit`, `npm test`, `npm run build`.
`npm run eval` scores the real analysis over fixed fixtures and
`npm run eval -- interview run <label>` does the same for the interview
feedback; both bill the model once per fixture (`npm run eval -- help`).

## File storage

CVs live in one private Supabase Storage bucket, `files-bucket`, under
`cv/{userId}/{uuid}.pdf`. Every storage call goes through
`lib/supabase/server.ts` with the service role.

The upload never passes through a server function:

1. `createResumeUploadAction` mints a key under the caller's prefix and a
   single-use signed upload URL.
2. The browser PUTs the PDF to that URL with the file and its type, nothing
   else. The bucket refuses anything that is not `application/pdf` or is
   over the limit in `lib/uploadLimits.ts`.
3. `analyzeResumeAction` receives the key, checks it is the caller's,
   downloads the object, checks the PDF header and the size, parses the
   text and runs the analysis as before.

The CV drawer reads through a signed URL minted when the analysis page
renders, valid for ten minutes.

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

## Voice interview: local development

The mock interview runs on ElevenLabs Agents. The browser gets a single-use
conversation token from `POST /api/interview/[id]/session` and talks to
ElevenLabs over WebRTC; the transcript comes back to the server by webhook
(`POST /api/webhooks/elevenlabs`), which is what triggers the feedback. The
webhook needs a public URL, so local development needs a tunnel. (If the
webhook never arrives, the server fetches the conversation itself once the
call must be over, so a lost delivery costs time, not the interview.)

1. Put the key in `.env` (see `.env.template`): `ELEVENLABS_API_KEY`. Leave
   `ELEVENLABS_AGENT_ID` and `ELEVENLABS_WEBHOOK_SECRET` empty the first time.

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

3. Push the agent (defined in `lib/elevenlabs/agentConfig.ts`) and create the
   post-call webhook, once:

   ```bash
   npm run agent:sync -- --webhook-url https://<tunnel-host>/api/webhooks/elevenlabs
   ```

   It prints the agent id and, when it creates the webhook, the webhook
   secret. Put both in `.env` as `ELEVENLABS_AGENT_ID` and
   `ELEVENLABS_WEBHOOK_SECRET`, then restart the dev server so it reads
   them. Re-run the same command after any change to `agentConfig.ts` or the
   interviewer prompt: the dashboard mirrors the code, not the other way
   round. With a changed tunnel URL:

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

5. To check the agent as the platform holds it (limits, auth, webhook, the
   `end_call` tool), run the sync again: it prints the effective settings.
