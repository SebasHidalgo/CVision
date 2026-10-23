# The voice interview (ElevenLabs Agents)

The mock interview runs on ElevenLabs Agents end to end: the server issues
a single-use conversation token (`POST /api/interview/[id]/session`), the
browser talks to the platform over WebRTC (`@elevenlabs/react`, loaded on
demand in the room), and the transcript comes back to the server by
webhook (`POST /api/webhooks/elevenlabs`), which is what triggers the
feedback. The local tunnel recipe is in the README; this is the reference.

## The agents are code

`lib/elevenlabs/agentConfig.ts` is the source of truth for both agents:
the full twelve-minute interviewer and the five-minute trial a Free account
gets once. They differ only in name, hard duration, daily call cap and
placeholders (a test pins that list). `npm run agent:sync` pushes both
(create when the tier's id is unset, update when it is), reads them back
and flags any difference that is not an intended one; a change made in the
dashboard is overwritten on the next sync. Hard limits 12 and 5 minutes,
daily caps 100 and 25 calls, silence cut at 60 s, auth required, the only
browser override is `agent.language`, no audio kept, 30-day transcript
retention on the platform, one system tool (`end_call`).

The platform ties the default TTS model to the agent's language: an
English agent must use `eleven_flash_v2` and Spanish goes as a language
preset with `eleven_flash_v2_5`.

## Webhooks: workspace objects, chosen per agent

From the API (`GET /v1/workspace/webhooks`, and each agent's
`platform_settings.workspace_overrides.webhooks.post_call_webhook_id`):
post-call webhooks are objects of the workspace, there can be several, and
each agent selects one by id. A workspace can therefore hold the agents of
two environments with two webhooks, and `agent:sync` finds the webhook by
URL for that reason. What cannot be shared is one agent or one webhook
between environments; and sharing a workspace shares its credits, minutes
and API key. The deploy guide recommends two accounts.

A webhook's URL cannot be edited once created: a new URL means
`agent:sync -- --webhook-url <new> --replace-webhook`, which deletes and
recreates it with a new secret. The platform auto-disables a webhook after
ten consecutive failures.

## What the server does with a call

- The session endpoint checks everything before the paid call: session,
  rate limit, ownership, state, the start cap (3 per interview), the
  analysis to brief the interviewer with, and the platform's balance
  (below the floor it refuses as `VOICE_UNAVAILABLE` before reserving
  anything). The first token reserves the plan's unit; a reconnect reuses
  what the first token set.
- The browser carries the agent's variables (the prompt treats each one
  as data); the server keeps its own copy (`issuedContext`) and the webhook
  marks `contextMismatch` if they differ. Nothing the browser sends is an
  input to the scoring.
- The room posts `POST /api/interview/[id]/ended` when the call ends
  (fire and forget). A call that ended within 30 s of its session is
  fetched from the platform at once: no webhook comes for a call the
  platform refused. Otherwise the webhook has a two-minute grace, after
  which the status poll fetches the conversation itself (at most once a
  minute per interview, however many tabs poll).
- Outcomes: candidate turns → feedback; none → the unit goes back
  (`NO_CANDIDATE_TURNS`, the start stays counted: it was the microphone);
  the platform has no record → `SESSION_LOST`, the unit goes back; the
  platform marks the call `failed` (the agent never joined, seen live when
  the account had no credits) → `CALL_FAILED`, the unit and the start go
  back, and the feedback page says it was the platform, not the microphone.

## The balance floor

`GET /v1/user/subscription` (the key needs `user_read`) gives the credits
used and the limit. The session endpoint reads it at most once a minute
and refuses every start while the reachable credits (the remainder plus
any usage-based extension) are below `VOICE_BALANCE_FLOOR_CREDITS` =
12,000: one full interview at the 800 credits per minute measured on the
owner's five real calls of 2026-10-13 (777 to 844 in total, about 660 the
platform's per-minute charge and the rest the LLM), times 1.25.
`ELEVENLABS_BALANCE_FLOOR_CREDITS` overrides it, 0 turns it off. A key
without the permission is warned about once and never blocks. One error
line per fresh read below the floor: `[CVision][voice] REFUSING voice
sessions`. Billing facts from the platform: Creator includes 275 agent
minutes and charges $0.08 per minute beyond, the LLM is billed separately
in credits, usage-based billing is a legacy feature and new subscriptions
buy Pay As You Go credits that last twelve months.

## The doctor

```bash
npm run voice:doctor -- --webhook-url https://<host>/api/webhooks/elevenlabs
```

Read-only: the key and its permissions (the one a refusal names is
printed, with the fix), the balance against the floor, both agents against
`agentConfig.ts` (the dashboard's placeholders excluded: the platform
answers them empty on read), the conversation read the reconcile needs,
and the webhook each agent points at (enabled, at the URL given, used by
both). The webhook's secret cannot be read back, so it is reported as set
or not. Exit code 1 when anything fails.
