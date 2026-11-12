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
would use:

    floor = minutes of the agent's hard limit x credits a minute x 1.25

- **Credits a minute** is measured, not assumed: `VOICE_CREDITS_PER_MINUTE`
  in `lib/voice/balance.ts`, 451 on the owner's Starter plan
  (`npm run voice:cost`, 2026-11-12: 398 for the call, 53 for the LLM).
  The rate belongs to the plan (the Free plan charged about 790), so a
  workspace on another plan sets its own measured number in
  `ELEVENLABS_CREDITS_PER_MINUTE`.
- **The margin** is for the LLM share, the only part that moves: 47 to 74
  a minute across the measured calls, against a call share of 397 to 398
  in every one. A quarter on top covers an LLM share three times the
  measured one.
- **Values on Starter:** 6,765 for the 12-minute interview (it costs about
  5,412) and 2,819 for the 5-minute trial (about 2,255). A reconnect uses
  its interview's tier; a first start reads the entitlement, read-only,
  before reserving.
- **Bursting is not in the floor.** A call past the plan's concurrency
  limit is charged twice the rate (10,824 for a full interview). A call
  bursts only while more calls than the plan allows run at once, each
  drawing on the same balance, so near the floor it is the number of
  calls that empties it; a floor for one start cannot hold that. Size the
  plan for the concurrency you expect instead.

`ELEVENLABS_BALANCE_FLOOR_CREDITS` overrides the floor of both agents, 0
turns the check off. `voice:doctor` prints each floor with its formula and
how many full and trial interviews the balance pays for. A key without the
permission is warned about once and never blocks. One error line per fresh
read below the floor: `[CVision][voice] REFUSING voice sessions`. Billing
facts from the platform: Creator includes 275 agent minutes and charges
$0.08 per minute beyond, the LLM is billed separately in credits,
usage-based billing is a legacy feature and new subscriptions buy Pay As
You Go credits that last twelve months.

## The doctor

```bash
npm run voice:doctor -- --webhook-url https://<host>/api/webhooks/elevenlabs
```

Read-only: the key and its permissions (the one a refusal names is
printed, with the fix), the balance against each floor and how many
interviews it pays for, both agents against `agentConfig.ts` (the
dashboard's placeholders excluded: the platform answers them empty on
read), every voice the agents speak with (below), the conversation read
the reconcile needs, and the webhook each agent points at (enabled, at the
URL given, and how many of the agents read point at it). The webhook's
secret cannot be read back, so it is reported as set or not. Exit code 1
when anything fails.

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

The room proposes the posting's language (`detectPostingLanguage`) and the candidate can change it before starting; the choice travels in the session request, is stored in `Interview.language`, and a later start of the same interview keeps it. The interface language does not decide it. The session's `language` goes to the one override the agents accept (`agent.language`), which selects the `es` preset: the multilingual TTS model, a Spanish cutoff line (`maxConversationDurationMessage`, so the platform's hard stop is never heard in English) and its own voice (below). Speech recognition follows the same override: in the live run a Spanish answer on an English posting came back transcribed in Spanish.

### The voices

| Language | Voice | Model | Whose it is |
|---|---|---|---|
| English (the default) | Sarah, `EXAVITQu4vr4xnSDxMaL` | `eleven_flash_v2` | A default voice of the platform. |
| Spanish (the `es` preset) | Norah, `kcQkGnn0HAT2JRDQ4Ljp` | `eleven_flash_v2_5` | A Voice Library voice (Latin American), chosen by the owner from the samples on 2026-11-12. |

Both agents carry both (`INTERVIEW_AGENT_VOICE_ID`, `INTERVIEW_AGENT_PRESET_VOICE_IDS`); the browser cannot change the voice.

A library voice belongs to someone else. What that means, read from the API on 2026-11-12 (`GET /v1/voices/{id}`, `sharing`):

- **Surcharge:** none for Norah (`rate` 1, `fiat_rate` null). A voice with a rate above 1 is charged on top of the call; `voice:cost` prints the surcharge of each call (`voice_surcharge_charge`).
- **Withdrawal:** its owner can take it out of the library. Norah's `notice_period` is 730 days: it keeps working that long after a withdrawal, and `disable_at_unix` then holds the date.
- **It has to be in the workspace:** a library voice is added once (it then counts as one of the plan's voice slots); an id that is not in the workspace answers `voice_not_found`.

`voice:doctor` reads every configured voice and fails when one is not in the workspace, is not ready on the model its language uses, or is being withdrawn within 30 days; a withdrawal further away passes and prints the date. To change the Spanish voice: `npm run voice:samples`, set the id in `INTERVIEW_AGENT_PRESET_VOICE_IDS`, `npm run agent:sync`.

### What the interviewer says

The prompt speaks `{{language_name}}` for everything it says and names requirements written in another language naturally, keeping technologies, products, companies and certifications as written. It frames the call as practice with a realistic interviewer for the role (M10-D replaced "a hiring-side interviewer").

**It uses the whole time (M10-D).** The owner's 5-minute trial of 2026-11-12 ended at 2:58, the interviewer saying its planned questions were done: the trial tier was briefed on two gaps (`gapsToCover: 2`, which also left no room for strengths), and the prompt said to close "when the gaps and the strengths that fit are covered". There is no question count any more:

- **One pool for every tier**, sized for the longest interview: up to 30 requirement lines (`MAX_CONTEXT_REQUIREMENTS`), gaps first, then met requirements, then not-shown topics; past the byte budget, not-shown lines go first, then met, then gaps. The prompt adds two sources that never run dry: the job description's responsibilities as situational questions, and follow-ups on the candidate's own answers. Short answers mean more questions, never an earlier end; it never says the planned questions are done.
- **Closing rule.** The interviewer may end only after the room's wrap-up line or when the candidate clearly asks to stop; otherwise it never calls `end_call`, and the platform's hard limit ends the call.
- **Pacing** (`lib/voice/timeNotes.ts`): the agent has no clock, so the room sends silent `[time]` lines as contextual updates (they never make it speak): at half time (calls of 4 minutes or more), with two minutes left (keep follow-ups short, open nothing large) and the wrap-up with 75 s left (finish the exchange, close, `end_call`). A line that would land within 15 s of the next is skipped. 75 s was checked against the owner's M10-C trial: answers ran 15–43 s and interviewer turns 15–25 s.
- **Safety net.** An interviewer hang-up before the wrap-up line is not the end: on the server (`decidePostCallOutcome`) an `end_call` with more than `INTERVIEW_WRAP_UP_SECONDS` (75) of the interview left keeps it resumable instead of scoring it, and the room, which knows whether it sent the line, shows "The interview ended early. You still have 2:03." with **Continue** (a reconnect: no unit, and the start the early call used is given back, so even the last one can be continued) and **Finish and get feedback**. A candidate who asked to stop presses Finish. It cannot loop: each call still uses interview time, and once 75 s or less remain an interviewer end is final.
- **Checked** with agent tests on both agents in both languages (`npm run voice:simulate -- --fixture closing-es|closing-en --case covered|signal|stop|contact [--tier trial]`, fixtures in `scripts/voice/fixtures/`): every topic answered briefly and no signal, the next turn is a question (8/8); after the wrap-up line it closes saying the feedback appears on screen (4/4); the candidate asks to stop, it closes (4/4); asked when they will hear back, it says it is practice (1/1). 646 credits. The feedback harness scores a nine-question trial with brief answers (`long-trial-many-questions`) without calling it short, 8/8 assertions.

**Closing honestly.** It is practice: no company, team or person reviews the call or contacts the candidate, and there is no next stage. The prompt says so and forbids implying otherwise (no "we'll be in touch", no "we'll analyze the information", no stages or next steps); the goodbye thanks the candidate and says the feedback appears on their screen in a moment, and a candidate who asks when they will hear back gets that answer. The platform's cutoff line says the same in both languages. Checked with agent tests on an end-of-interview history (M10-C): the agent before the change said "El equipo de selección se pondrá en contacto contigo" (0/1); after it, 9/9 runs closed honestly; re-run in M10-D after the new opening. In Spanish the goodbye uses the app's word, "feedback", not "retroalimentación".

The feedback is still generated in English (the canonical version), quotes stay verbatim in the language spoken, and the M9 translation shows it in the interface language.

The role is said aloud, so the interviewer gets a spoken title (`lib/ai/spokenTitle.ts`): inclusive written forms keep the form before the slash or the parenthesis ("Desarrollador/a" → "Desarrollador", "Ingeniero(a)" → "Ingeniero", "Analista de datos (m/f)" → "Analista de datos"), and seniority abbreviations are said in full, as whole words only: "SR"/"Sr."/"Sr" → "Senior", "JR"/"Jr." → "Junior", "SSR"/"Ssr"/"Semi-Sr" → "Semi Senior" (the voice spells an all-caps "SR" out, "ese erre"). Acronyms said letter by letter (QA, TI, SQL, AWS, UX) stay as written; the stored titles held only "SR" and "AI", and "AI" is said "IA" in a Spanish call. The pages keep showing the posting's title. The time left is said in half minutes, rounded down (`spokenTimeLeft`): 4:44 is "unos 4 minutos y medio", never "unos 5 minutos".

`npm run voice:samples -- --out <folder>` writes the same Spanish greeting in three voices (Sarah and two native Latin American ones) to choose from. It needs `text_to_speech` on the key.

## The room on entry

The room decides what it offers before any button is pressed (`lib/interviewEntry.ts`, `decideRoomEntry`), from the same entitlement the session endpoint runs and the voice health check (`voiceEntryStatus`, the balance read and a refused key both cached for a minute). Start stays the authority: the endpoint still refuses at Start, so a stale page or a second tab cannot get around it.

| entry | when | the room shows |
|---|---|---|
| `start-cap` | every start of the interview used | the start-limit copy and the way back to the analysis |
| `voice-down` | rejected key, or balance under the floor | "temporarily unavailable" and Check again; never a purchase |
| `continue` | the interview holds its unit, or a dropped call can be resumed | Start or Reconnect, whatever the counts |
| `start` | a fresh start the entitlement pays | what it uses: "This interview uses your free 5-minute trial", "3 of 4 interviews left this period. This one uses one of them.", "This interview uses 1 pack credit. You have 2." |
| `needs-pro` | Free with the trial used (or never offered) and no credits | no Start; what Pro gives (from `lib/plans.ts`) and a Pro checkout; with a subscription still open but granting nothing (paused, or a cancellation already due), its state and the billing portal instead, since a new Pro checkout would refuse |
| `needs-pack` | Pro with the period used and no credits | no Start; the renewal date and the pack (count and price from the catalog); with the last payment failed (`past_due`), also the portal |

A purchase from the room stays in the room: the checkout button takes `onPaid`, the room polls the billing status for that transaction (`useTransactionLanding`, shared with the account page) and, once applied, re-reads itself with `router.refresh()`; Start appears without a reload. Still blocked 20 s after the checkout completed, it says the purchase is being confirmed and offers **Check again**, which runs the billing reconcile for that transaction (a lost webhook) and re-reads the room; past two minutes it also links to the account page. The e2e of the voice-down state uses a dev-only cookie (`cvision-dev-voice-down`, read only with dev tools on and the sandbox). The analysis page's CTA and both interview lists read a waiting interview through the same function (`waitingInterviewEntry`): a waiting interview the plan cannot start says "Needs Pro to start" or "No interviews left this period", never "Ready".

`npm run dev:usage -- --email <e> [--interviews-used <n>] [--trial-used] [--credits <n>] [--plan free|pro]` puts an account in any of these states without a call (rows tagged `dev-usage:`, removed on the next run; the app's own rows are never touched). It refuses unless `ALLOW_DEV_TOOLS=1` and `PADDLE_ENV=sandbox`, against a Clerk development instance.

### The live transcript

On a desktop the room is exactly the viewport under the site header: the transcript box fills its column and ends above the controls, and the left column scrolls on its own on a short screen. On a phone the box is sized to fit above the sticky control bar once the page is scrolled to it, and a swipe at its end carries on to the page. Before M10-D the box was sized from the viewport alone: at 1366×768 (and 1440×900, 1536×864 zoomed) its last line sat under the control bar, and so did the jump button, which is why the owner never saw it.

It follows the newest line while the reader is at the bottom. Only the reader's own input (wheel, touch, keys) leaves the bottom: the room's smooth follow never does. Away from the bottom, a button shows: "New messages ↓" once lines arrived meanwhile, a plain "↓" otherwise ("Back to the newest message" to a screen reader); it jumps back and follows again. Smooth scrolling, instant with reduced motion; `role="log"` with polite announcements. Speaker labels are never cut: the label column is as wide as the longest label in the language (CSS subgrid), and the feedback page's transcript uses the same layout with the time under the label. `e2e/transcript.spec.ts` drives it with a real mouse wheel on the dev-only room preview (`/dev/room-preview?drip=1`, lines arriving every 1.5 s).

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

The resumed call: no new unit; `maxDurationSeconds` in the session answer is what is left of the tier's length; the interviewer gets `call_context` and an opening line that says it is picking up and how much time is left. The room shows "Your call dropped at 3:12. You have 8:48 left." with Reconnect and Finish, also after a reload.

### The continuity record

`continuityRecord` (`lib/voice/segments.ts`) cuts it from the stored turns in code, with no model call:

- **Exchanges:** each thing the interviewer asked (the end of its turn, from a sentence start, up to 320 characters) with the gist of the candidate's answer (its start on one line, hesitations removed, up to 240 characters).
- **The pending question:** the interviewer's last question when the call dropped before any answer to it. Only where the interview stopped: a question an earlier call left pending shows up as an exchange of the next call once it was asked again.
- A later call's opening line and the reply to it are not an exchange.

The prompt builder keeps the ten most recent exchanges. When the variables pass the byte budget it drops met lines, then not-shown lines, then the oldest exchanges; the latest exchange and the pending question stay.

What the interviewer is told for a resumed call (in `call_context`, so no agent sync is needed to change it): ask the pending question first, briefly, as a repeat; never ask again something that has an answer in the record, in the same or other words; a gap already answered counts as covered.

Why it changed (M10-B): the first record listed questions without answers and did not say which one was pending. In the owner's live interview of 2026-11-12 the interviewer asked again a question that already had an answer, and never came back to the one the drop cut off: the record had listed that one as asked and its gap as "do not raise again", and its word match had missed the gap the answered question was about.

`npm run voice:simulate [-- --repeat N]` (the default fixture) checks this in text, with no call: it builds the variables of a resumed call for the invented case in `scripts/voice/fixtures/pending-question.json` (one question answered, one pending) and has the agent write its next turn through the platform's agent tests; a judge model says whether it asked the pending question. About 40 credits a run. Measured on 2026-11-12: 0 of 8 runs with the old record, 8 of 8 with the new one. The platform's older simulate-conversation endpoint was removed on 2026-10-31; a full simulated conversation is now a "simulation" test, and the one that was run cost about 600 credits.

### A call nobody spoke in, and a record that has not arrived

A call that drops before the candidate said anything uses no interview time: the next start is a fresh one with the full length (and reserves the unit again, which the silent call gave back). The room says so ("Your call dropped before you answered. You can start again with the full 5 minutes.") and offers no "Finish and get feedback"; on the last start it goes to the feedback page instead.

Before a new start, and before the room is drawn, the server asks the platform for the previous call's record when it has not arrived (`settlePreviousCall`, the reconcile path): when the room reported the end, or when the session is more than 15 seconds old (a page-leave report can be lost). So the time left, the continuity record and whether the candidate spoke at all come from what the platform measured. The platform closes a call's record a few seconds after the call ends (`processing`, then `done`), so a start that comes that fast asks again every 1.5 seconds for up to 8 (`SETTLE_PATIENCE_MS`); it does not wait for a call that is still live in another tab. Only when the record is still not there, or the platform does not answer, does the server fall back to its own clock, counted from the session to the room's report or to now. The session endpoint does this before it reads the interview, and a start that reserves nothing goes through only on a row that still holds its unit.

### The time cap and overruns

The time cap is not enforced by the platform per session. The only per-session length is a client override (`conversation.max_duration_seconds`), which the agents keep locked: a browser allowed to shorten a call could lengthen one. So: the room hangs up when a call passes its length, the interviewer is told the remaining time, and the server refuses a start when under 30 s are left by the platform's own measured durations. A modified browser can still let each call run to the agent's hard limit: worst case just under two full lengths per interview (about 23.5 minutes on the full agent, 9.5 on the trial), never more than three calls.

That worst case is accepted for now, and detected: the session stores what each call is allowed (`Interview.callAllowedSeconds`: the tier's length, or what was left of it), and when a call's record says it ran more than 15 seconds past that, the server writes one error line, `[CVision][voice] CALL OVERRUN user=… interview=… conversation=… allowed=…s recorded=…s over=…s`, and adds one to `User.callOverruns`. Nobody is blocked. Only the latest call's allowance is on the row, so an earlier call's late record is not judged.

A call is stored once. The webhook and the API fetch can arrive together (seen in the voice e2e run of 2026-11-12: both stored the same silent call); the write goes through only on a row whose latest call has no transcript yet, and the other delivery is answered as a duplicate. Before that guard a failed call stored twice gave back two starts, and an overrun would have been counted twice.

## What a minute costs

`npm run voice:cost [-- --since YYYY-MM-DD] [--plan-usd N]` reads recent conversations of both agents from the platform: duration, credits charged (call and LLM apart), credits per minute, and the cost of a 12-minute and a 5-minute interview at the plan's price (the next invoice over the plan's credits). Calls are grouped by the plan they were charged on. Measured: the free plan charged about 790 credits a minute (666 call + 124 LLM); Starter charges 451 (398 call + 53 LLM, the owner's interviews of 2026-11-12), so a 12-minute interview is about 5,412 credits (USD 1.08) and a 5-minute one 2,255, and the plan's 30,000 credits hold about five full interviews. The advertised "75 minutes for 30,000 credits" is the call alone. That rate is what the balance floor is built on (`VOICE_CREDITS_PER_MINUTE`): measure again and update it when the plan changes. A conversation deleted with its analysis or account is gone from the platform and is not counted.
