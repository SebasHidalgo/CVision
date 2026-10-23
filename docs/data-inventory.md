# Data inventory

What personal data the product handles, where each piece lives, how long
it stays, how it is deleted, who processes it and where. The legal pages
(`/terms`, `/privacy`, `/refunds`) must be written from this; the deploy
guide's legal section points here. Kept current with the code: when a
new store or processor appears, this file changes in the same commit.

Last reviewed: 2026-10-23.

## The data, by what the person does

| Data | Why it exists | Where it lives | How long | Deleted by |
|---|---|---|---|---|
| **Account identifier** (Clerk user id) | Every row of the account hangs from it | Clerk (identity); `User.id` in Postgres (Supabase) | Life of the account | Account deletion (Clerk `user.deleted` → `deleteAccountCascade`) |
| **Email, name, sign-in method, avatar** | Signing in | Clerk only. The app stores none of them: `User` holds the id, a manual comp flag and timestamps. The first name is read from Clerk at interview time and passed to the voice agent as a variable; the avatar is loaded from `img.clerk.com` in the header | Life of the account | Clerk, on account deletion |
| **The CV (PDF file)** | Reopening it next to its analysis | Supabase Storage, private bucket `files-bucket`, key `cv/{userId}/{uuid}.pdf`; served only through 10-minute signed URLs | Life of its analysis | Analysis deletion, account deletion, or the collector (`storage:gc`, cron) for a file left without a row for 24 h |
| **The CV's text** | The analysis | Sent to Google (Gemini) in the analysis prompt; not stored by the app as text (the file is the store). Google: see Processors | Google's paid-tier logging window; not stored by the app | n/a (not stored by the app) |
| **Job posting** (company, title, description pasted by the person) | The analysis and the interview | `ResumeAnalysis` in Postgres; sent to Gemini (analysis, feedback) and to ElevenLabs (as agent variables, with the analysis summary and requirement list) | Life of the analysis | Analysis deletion, account deletion |
| **The analysis** (scores, requirement matches, quotes from the CV, guardrail stats) | The product's output | `ResumeFeedback`, `ResumeAnalysis.guardStats` in Postgres | Life of the analysis | Analysis deletion, account deletion |
| **Interview audio** | The voice call | ElevenLabs processes the audio live (ASR, TTS). The agents are configured with `recordVoice: false`; the platform keeps conversation metadata and the transcript, not audio, for 30 days (`retentionDays: 30` in `lib/elevenlabs/agentConfig.ts`) | 30 days at ElevenLabs | Analysis or account deletion asks ElevenLabs to delete each conversation at once (`deleteConversation`), best effort; otherwise the platform's 30-day expiry |
| **Interview transcript** | Feedback | `Interview.transcript` in Postgres (verbatim turns from the post-call webhook); sent to Gemini for the feedback | Life of the analysis | Analysis deletion, account deletion |
| **Interview feedback** (scores, quotes from the candidate's answers, stats) | The product's output | `InterviewFeedback` in Postgres | Life of the analysis | Analysis deletion, account deletion |
| **Usage** (analyses and interviews counted, refunds, credits) | Plan limits | `UsageEvent` in Postgres | Life of the account | Account deletion (cascade) |
| **Rate-limit counters** | Abuse brake | `RateLimitCounter` in Postgres, keyed by user id and hour | Until the next hit prunes the old window | Account deletion does not touch them (no FK; keys are opaque and expire) |
| **Billing identifiers** | Subscription and credits | `BillingCustomer.providerCustomerId`, `Subscription` (provider ids, status, period), `BillingEvent` (provider event ids, types, times; **no payload**) in Postgres | Life of the account; `BillingEvent` outlives it (audit trail, no FK) | Account deletion (customer and subscription rows cascade; subscription cancelled at Paddle first) |
| **Payment details, billing email, country, invoices** | The purchase | Paddle only (merchant of record). The app never sees a card or an email from Paddle beyond the customer id | Paddle's statutory retention (tax records) | Not deletable by the app; Paddle keeps customer, transactions, invoices and the cancelled subscription |
| **Guardrail daily tallies** | Quality signal | `GuardStatDaily` in Postgres: day, kind, check, action, count. **No user id** | Indefinite | Never (anonymous by construction) |
| **Server logs** | Operations | Vercel runtime logs: ids, counts, outcomes, error names. By rule never the CV, the posting, a transcript, a prompt, a signed URL or a key (`CLAUDE.md`, "Datos sensibles") | Vercel's log retention for the plan (Pro: 1 day in the dashboard; longer only with a log drain, which is not configured) | Expiry |
| **Theme preference** | UI | `localStorage` key `cvision-theme` in the person's browser | Until cleared by the person | The person's browser |
| **Cookies** | Session | Clerk's session cookies (`__session`, `__client_uat`, …) on the app's domain; Paddle's checkout overlay sets its own inside its iframe | Clerk: session lifetime; Paddle: per its policy | Sign-out; the person's browser |

## Deletion paths, in code

- **One analysis** (its page, "Delete"): `deleteAnalysisAction` → `deleteAnalysisCascade` (`lib/deletion.ts`). A serializable transaction removes the `ResumeAnalysis` row, cascading to `ResumeFeedback`, `Interview` and `InterviewFeedback`; then, best effort and logged, the CV object is removed from the bucket and every issued ElevenLabs conversation is deleted. Refused with `ANALYSIS_BUSY` while a rehearsal is live or being scored.
- **The whole account** (Clerk → `user.deleted` webhook, or `<UserProfile />` if the owner enables self-service deletion in Clerk): `deleteAccountCascade`. First every open subscription is cancelled at Paddle (effective immediately; a failure is logged loudly and does not stop the deletion); then every analysis as above; then whatever is left under `cv/{userId}/` in the bucket; then the `User` row (cascading `UsageEvent`, `BillingCustomer`, `Subscription`). `BillingEvent` rows stay (audit, no personal data).
- **Orphans**: `npm run storage:gc` (a Vercel cron in production) deletes objects under `cv/` with no row older than 24 h and anything outside `cv/`.
- **ElevenLabs retention**: whatever the app fails to delete expires after 30 days on the platform.

## Processors and where they run

| Processor | What it receives | Role | Region / transfers | Terms |
|---|---|---|---|---|
| **Google (Gemini API)** | CV text, job posting, interview transcript; the analysis and feedback prompts | Generates the analysis and the feedback | Google's global infrastructure (US). **Must be the paid tier**: on the free tier Google may use prompts and responses to improve its products and human reviewers may read them; on the paid tier prompts are not used for improvement and are logged briefly for abuse detection only (Gemini API Additional Terms, "Paid Services") | https://ai.google.dev/gemini-api/terms |
| **ElevenLabs** | The candidate's voice during the call, the agent's variables (first name, role, company, posting, analysis summary, requirement list), the transcript | Runs the voice interview, returns the transcript by webhook | US (ElevenLabs' infrastructure; the WebRTC media goes to `livekit.rtc.elevenlabs.io`) | https://elevenlabs.io/terms-of-use, https://elevenlabs.io/privacy-policy |
| **Clerk** | Email, name, sign-in method, IP and device data of sign-ins | Authentication | US | https://clerk.com/legal/privacy |
| **Supabase** | Everything in Postgres and the bucket above | Database and file storage | The project's region (development: AWS us-east-1; production: chosen next to Vercel's `iad1`, see the deploy guide) | https://supabase.com/privacy |
| **Paddle** | Billing email, country, payment method, purchase history | Merchant of record: payments, invoices, taxes, refunds | UK/EU/US; Paddle is the seller to the buyer | https://www.paddle.com/legal/privacy |
| **Vercel** | HTTP traffic, server logs | Hosting | Functions pinned to `iad1` (US); the CDN is global | https://vercel.com/legal/privacy-policy |
| **ngrok** (development only) | Webhook traffic to the developer's machine | Tunnel | US | not used in production |

Cross-border: every processor above is outside Costa Rica; the data of
people anywhere is processed in the US (Google, ElevenLabs, Clerk,
Supabase, Vercel) and by Paddle in the UK/EU. The privacy page must say so
and name the mechanism the owner relies on; this file only records the
facts.

## What is never collected

- No card numbers, no bank details (Paddle holds them).
- No audio recordings by the app, and none kept by the agent (`recordVoice: false`).
- No analytics or advertising trackers; no third-party scripts beyond Clerk, Paddle.js (checkout pages only) and the ElevenLabs SDK (the interview room only).
- No email or name in the app's database.
