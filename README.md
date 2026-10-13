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
npx prisma db push      # the schema has no migrations folder yet
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The analysis works
from there; the voice interview needs the tunnel described below.

Before handing in a change: `npx tsc --noEmit`, `npm test`, `npm run build`.
`npm run eval` scores the real analysis over fixed fixtures and
`npm run eval -- interview run <label>` does the same for the interview
feedback; both bill the model once per fixture (`npm run eval -- help`).

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
