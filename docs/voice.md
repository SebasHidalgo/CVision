# The voice interview (ElevenLabs Agents)

The mock interview runs on ElevenLabs Agents end to end: the server issues
a single-use conversation token (`POST /api/interview/[id]/session`), the
browser talks to the platform over WebRTC (`@elevenlabs/react`, loaded on
demand in the room), and the transcript comes back to the server by
webhook (`POST /api/webhooks/elevenlabs`), which is what triggers the
feedback. The local tunnel recipe is in the README; this is the reference.

## The provider interface

Like billing: the app talks to `lib/voice/`, and only the adapter knows ElevenLabs.

| Where | What |
|---|---|
| `lib/voice/index.ts` | The runtime facade (server-only): `startVoiceSession({ tier, variables })` (token, conversation id, the variables as issued), `verifyAndParseWebhook(rawBody, headers)` (a `call-ended` record, `ignored` or `unreadable`), `fetchConversation(id)` (reconcile), `deleteConversation(id)`, `readVoiceBalance()`. |
| `lib/voice/admin.ts` | The operator facade, for scripts: `syncAgents`, `runVoiceDoctor`, `readConversationCost`, `listConversationIds`. |
| `lib/voice/postCall.ts`, `reconcile.ts`, `balance.ts`, `health.ts` | Provider-neutral logic over a `CallRecord` (conversation id, turns, start, duration, failed, the variables the browser passed). |
| `lib/voice/elevenlabs/` | The adapter: `client.ts` (the SDK calls), `wire.ts` (the webhook and API shapes and their translation into a `CallRecord`), `agentConfig.ts`, `sync.ts`, `doctor.ts`, `cost.ts`, `worklets.ts`, `webhookSignature.ts` (test helper). The only importer of `@elevenlabs/elevenlabs-js`. |
| `screens/Interview/components/elevenlabs/VoiceCall.tsx` | The browser adapter: `useVoiceCall` (start, end, who speaks, how it ended). The only importer of `@elevenlabs/react`. |

`lib/voice/providerIsolation.test.ts` enforces it: the two SDK imports, the adapter reached only through the facades, and the provider field and header names kept inside. Two things keep the provider name on purpose: the stored turn shape (`role`, `message`, `time_in_call_secs`, what every saved transcript already has) and `Interview.transcriptSource` (`elevenlabs` / `elevenlabs-api`). A second provider maps its turns into that shape.

## The agents are code

`lib/voice/elevenlabs/agentConfig.ts` is the source of truth for both agents:
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
any usage-based extension) are below the floor of the agent that start
would use: its hard duration at the 800 credits per minute measured on the
owner's five real calls of 2026-10-13 (777 to 844 in total, about 660 the
platform's per-minute charge and the rest the LLM), times 1.25. That is
12,000 for the full 12-minute interview (`VOICE_BALANCE_FLOOR_CREDITS`)
and 5,000 for the 5-minute trial, so a free plan's 10,000 credits carry
trials and never a full interview. A reconnect uses its interview's tier;
a first start reads the entitlement, read-only, before reserving.
`ELEVENLABS_BALANCE_FLOOR_CREDITS` overrides both, 0 turns it off;
`voice:doctor` checks both floors. A key
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

## Concurrency: bursting, the queue, a full house

Both agents carry `callLimits.burstingEnabled: true` and `queueingConfig: { enabled: true, waitTimeoutSeconds: 60 }` (`agentConfig.ts`; the Starter plan accepted both, read back on 2026-11-11). Bursting lets calls past the plan's concurrency run, up to three times it, at twice the per-minute rate. Past that, the platform holds the caller in a queue; queue time is not billed and is not part of the call's duration.

What the platform does at the limit, measured on the trial agent with its own limit set to one:

| Queue | What the second caller gets |
|---|---|
| off | The connection closes with code 4300, "This AI agent is currently at max capacity". The token is still issued: the refusal comes at connect time. The conversation is recorded as `failed`, `call_initialization_error`, not charged. |
| on | A `queue_status` event, `waiting`, then `admitted` when a seat frees, with hold audio in between. The record carries `queue_wait_secs`. |

In the app:

- The browser SDK has no callback for `queue_status`; it reaches `onDebug`. `VoiceCall.tsx` reads it there and the room shows "Waiting in line" with the clock stopped until `admitted`.
- A call refused for capacity, or a wait that runs out, is `AT_CAPACITY` (`refusedForCapacity`): the start and the unit go back, exactly as for `CALL_FAILED`, and the copy is "All interviewers are busy right now. Try again in a minute. Nothing was charged." (`VOICE_BUSY` in the room, `notScored.busy` on the feedback page).
- The plan's concurrency limit is not in the API; `voice:doctor` prints bursting, the queue and the daily cap per agent.

The daily cap (`callLimits.dailyLimit`) is our own cost brake, not a platform limit: 100 for the full agent and 25 for the trial unless `ELEVENLABS_DAILY_CALL_LIMIT` / `ELEVENLABS_TRIAL_DAILY_CALL_LIMIT` hold a positive integer when `agent:sync` runs. Production sets them; development leaves them unset.

## A rejected key

A 401/403 on the key itself (not a missing permission, which stays `VOICE_MISCONFIGURED` and names the permission) is `VOICE_KEY_REJECTED`: one `[CVision][voice] KEY REJECTED` line at error level per ten minutes, the user sees the "voice unavailable" copy, and the balance check refuses the start before anything is reserved. `voice:doctor` says "key rejected: expired, revoked, or from another workspace" once and stops. The API does not let a key read its own expiry.

## The language of the call

The room proposes the posting's language (`detectPostingLanguage`) and the candidate can change it before starting; the choice travels in the session request, is stored in `Interview.language`, and a later start of the same interview keeps it. The interface language does not decide it. The session's `language` goes to the one override the agents accept (`agent.language`), which selects the `es` preset: the multilingual TTS model, a Spanish cutoff line (`maxConversationDurationMessage`, so the platform's hard stop is never heard in English) and, once chosen, a Spanish voice (`INTERVIEW_AGENT_PRESET_VOICE_IDS`; presets can set a voice, read back). Speech recognition follows the same override: in the live run a Spanish answer on an English posting came back transcribed in Spanish.

The prompt speaks `{{language_name}}` for everything it says and names requirements written in another language naturally, keeping technologies, products, companies and certifications as written. The interviewer has no clock, so the room sends it one line the candidate never hears (`[time] About one minute remains…`, a contextual update) with 75 seconds left; the prompt tells it to close and call `end_call`.

The feedback is still generated in English (the canonical version), quotes stay verbatim in the language spoken, and the M9 translation shows it in the interface language.

`npm run voice:samples -- --out <folder>` writes the same Spanish greeting in three voices (the current one and two native Latin American ones) for the owner to choose from. It needs `text_to_speech` on the key.

## One interview, several calls

A call that drops after the candidate spoke does not end the interview.

| How the call ended | What happens |
|---|---|
| The interviewer's `end_call`, or the hard time limit | Final: scored. |
| End in the room, or "Finish and get feedback" after a drop | Final: scored (at once when the call's record is stored, on its arrival otherwise). |
| A lost connection, a closed tab, anything else | Resumable for ten minutes (`resumableUntil`). |
| Resumable and nobody came back | A lazy sweep (`finalizeLapsedInterviews`, run where interviews are read: the status poll, the analysis page, the lists, the room and the feedback page) scores it with what exists. |
| The interview's length used up across calls (under 30 s left), or the last of the three starts | Final. |

The platform's record decides: its termination reason is mapped to `endedBy` ("end_call tool was called." → agent; "Client disconnected: 1005" → client, the same for End, a closed tab and a lost connection, which is why the room also reports `finish` or `drop` to `POST /api/interview/[id]/ended`).

Storage: `Interview.transcript` holds the latest call until the interview is final. A reconnect moves that call into `Interview.segments` in the same guarded write that issues the session. When final, every call is merged in order (`mergeSegments`): each later call's offsets continue where the previous ended, with a marker turn between two calls (`role: "system"`, `[call resumed]`). The feedback prompt shows the marker as a neutral line and explains it only when one is present, so a single-call prompt is byte for byte what it was; the stats sum every call and do not count the marker. A call in which nobody spoke, before any counted, is still the old silent path (the unit goes back). A resumed call the platform could not run gives its start back and leaves the interview resumable.

The resumed call: no new unit; `maxDurationSeconds` in the session answer is what is left of the tier's length; the interviewer gets `call_context` (it continues, how many minutes remain, the questions it already asked verbatim, the gaps those raised) and an opening line that says it is picking up. The room shows "Your call dropped at 3:12. You have 8:48 left." with Reconnect and Finish, also after a reload.

The time cap is not enforced by the platform per session. The only per-session length is a client override (`conversation.max_duration_seconds`), which the agents keep locked: a browser allowed to shorten a call could lengthen one. So: the room hangs up when a call passes its length, the interviewer is told the remaining time, and the server refuses a start when under 30 s are left by the platform's own measured durations. A modified browser can still let each call run to the agent's hard limit: worst case just under two full lengths per interview (about 23.5 minutes on the full agent, 9.5 on the trial), never more than three calls.

## What a minute costs

`npm run voice:cost [-- --since YYYY-MM-DD] [--plan-usd N]` reads recent conversations of both agents from the platform: duration, credits charged (call and LLM apart), credits per minute, and the cost of a 12-minute and a 5-minute interview at the plan's price (the next invoice over the plan's credits). Calls are grouped by the plan they were charged on. Measured on 2026-11-11: the free plan charged about 790 credits a minute (666 call + 124 LLM); Starter charges about 400 for the call plus the LLM (47 a minute over short test calls, 74 in the one 91-second call), so the advertised "75 minutes for 30,000 credits" is the call alone. A conversation deleted with its analysis or account is gone from the platform and is not counted.
