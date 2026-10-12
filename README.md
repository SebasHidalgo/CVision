This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Voice interview: local development

The mock interview runs on ElevenLabs Agents. The browser gets a single-use
conversation token from `POST /api/interview/[id]/session` and talks to
ElevenLabs over WebRTC; the transcript comes back to the server by webhook
(`POST /api/webhooks/elevenlabs`), which is what triggers the feedback. The
webhook needs a public URL, so local development needs a tunnel.

1. Put the key in `.env` (see `.env.template`): `ELEVENLABS_API_KEY`. Leave
   `ELEVENLABS_AGENT_ID` and `ELEVENLABS_WEBHOOK_SECRET` empty the first time.

2. Start the tunnel to the dev server's port. With ngrok's free static domain
   (one per account, reserved in the ngrok dashboard) the URL survives restarts:

   ```bash
   ngrok http --url=<your-domain>.ngrok-free.app 3000
   ```

   Without a static domain, `ngrok http 3000` gives a URL that changes on
   every restart; every change means re-running the sync below with the new
   URL and updating the webhook URL in the ElevenLabs dashboard
   (Settings > Webhooks), because the sync script does not overwrite an
   existing webhook's URL.

3. Push the agent (defined in `lib/elevenlabs/agentConfig.ts`) and create the
   post-call webhook, once:

   ```bash
   npm run agent:sync -- --webhook-url https://<tunnel-host>/api/webhooks/elevenlabs
   ```

   It prints the agent id and, the first time only, the webhook secret. Put
   both in `.env` as `ELEVENLABS_AGENT_ID` and `ELEVENLABS_WEBHOOK_SECRET`.
   Re-run the same command (without `--webhook-url`, or with the same one)
   after any change to `agentConfig.ts` or the interviewer prompt: the
   dashboard mirrors the code, not the other way round.

4. Run the app and open it **through the tunnel URL**, not localhost, so the
   same origin serves the page, the session endpoint and the webhook:

   ```bash
   npm run dev
   ```

   The microphone requires a secure context; the tunnel is https, and so is
   the phone test. Interviews work on a phone over the same URL.

5. To check the agent as the platform holds it (limits, auth, webhook), run
   the sync again: it prints the effective settings at the end.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
