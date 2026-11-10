# Analysis quality: the M8 record

For whoever changes the CV analysis next. The M8 series (2026-11-03 to
2026-11-10) moved the analysis from "the model's list of requirements" to
"the model's list, checked in code against the posting and the CV". This
page says what holds that in place, how to measure a change, what was tried
and rejected, and what is still open. The rules themselves, one by one, are
in [analysis.md](analysis.md).

## The gold standard

- `scripts/eval/fixtures/GOLD-RULES.md`: sixteen rules for what counts as a
  requirement, how many a sentence holds, its kind, which items a CV cannot
  show, how years are counted, and the owner's language-level decision.
- One `gold.json` per fixture: verbatim spans (the loader refuses a span
  that is not in `job.txt`), kind, status where the CV decides it,
  `statusAlso`, `assessable`, `contested`, `hidden`, `splitAllowed`,
  `keyTerms`, `years`, `preferredEvidence`, `unshowableAlternative`, and the
  `notRequirements` a model is likely to over-extract.
- 17 synthetic fixtures in `scripts/eval/fixtures/` (tracked) and two real
  postings against the owner's CV in `scripts/eval/fixtures.local/`
  (gitignored): Microsoft and Encora. The real ones weigh more: the
  synthetic gold read kind at 100% while the first outside posting had 2
  kind errors in 10.

Extending it:

1. Write the gold before looking at any model output, by the rules; where
   no rule decides, say so in `why` and mark the item `contested`.
2. One span per place the posting states an item (rule 10): M8-F found the
   Microsoft screening item missing its second span, the background-check
   sentence, and the repair then scored as a split.
3. A real posting's gold is `draft` until the owner approves
   `fixtures.local/gold-review.md`.
4. When a run disagrees with the gold, decide by the rules which one is
   wrong and say so. M8-F's telecom item was a model error, not a gold
   error.
5. Nothing from `fixtures.local/` goes into a tracked file:
   `scripts/eval/realDataGuard.test.ts` fails `npm test` on six consecutive
   words of a real CV or posting, compared without accents, case or
   punctuation. Tests use invented text.

## Measuring a change

A change to code after the model is measured by replaying stored answers
(`npm run eval -- replay`, or `quick <label> --control <label> --replay`),
at no cost. A change to the prompt or the schema runs against its control
in the same session (the model behind the alias moves within hours), seed
7 plus unseeded runs, never across UTC midnight:

```
git worktree add --detach <dir> <control-sha>   # node_modules junction, .env, copy fixtures/ and fixtures.local/ in
export EVAL_SPEND_LEDGER=<checkout>/scripts/eval/runs/spend.jsonl   # one ledger for both arms
npm run eval -- full ctl-s7 --confirm-cost                  # in the worktree
AI_SEED=none npm run eval -- run ctl-u1 --only <ids>        # u1..u5
npm run eval -- full new-s7 --confirm-cost; AI_SEED=none npm run eval -- run new-u1 --only <ids>   # in the checkout
npm run eval -- gold ctl-s7 ctl-u1 … ; npm run eval -- gold new-s7 new-u1 …
```

With the free key, a seed-7 run of all 19 fixtures costs about USD 0.013
(the two real postings at Flex), and each unseeded run of the two real
postings about USD 0.013 more: seed 7 plus five unseeded runs, about USD
0.08 per arm. Before M8-G, on the paid key at standard, the same arm cost
about USD 0.66. `gold` reports recall, precision
(inventions, over-extraction by reason, splits, merges), kind, status
(met/missing swaps, false met, not-shown called missing), key terms, years
and preferred evidence, real postings apart. A drop in recall or
precision, or a new false met, is a regression.

Since M8-F every record keeps the model's raw answers, so a change to code
after the model (any rule below) is measured without a call:
`npm run eval -- replay <label> <newLabel>` runs the stored answers through
the checkout's `finishAnalysis`, and `gold` scores the result. Replaying a
run on its own commit reproduces it byte for byte.

After an intended change of the output, capture a new seed-7 reference
and point `npm run eval -- canary` at it (it replays its reference's date).

## What a measurement may spend

The M8 series spent USD 11.86 on measurements (the ledger's backfill of
every stored run, priced at standard: M8-A 2.17, M8-B 2.29, M8-C 3.10,
M8-D 1.35, M8-E 1.56, M8-F 1.38; with the earlier phases, USD 14.60 over
1,649 recorded analyses). Since M8-G the limit is in code
(`scripts/eval/spend.ts`, prices in `scripts/eval/pricing.ts`):

- Every call is priced from the tokens the API reports and appended to
  `scripts/eval/runs/spend.jsonl`. `npm run eval -- spend [--since <date>]`
  prints it by UTC day, phase and tier.
- A command prints its estimate (each fixture's largest past run), refuses
  to start when the estimate crosses a cap, and stops between fixtures:
  `EVAL_BUDGET_PER_RUN_USD` (0.50) and `EVAL_BUDGET_PER_DAY_USD` (1.00, all
  processes of the UTC day; a control worktree writes to the same ledger
  through `EVAL_SPEND_LEDGER`).
- Invented data runs free: the committed fixtures go to
  `GOOGLE_GENERATIVE_AI_API_KEY_FREE` (Google may use free-tier content, so
  `fixtures.local/` never does). Real data runs on the paid key at Flex,
  half the standard price, synchronous. Both arms of a comparison use the
  same tier per fixture; the record keeps it and the gate refuses a mix.
- `quick` (seed 7, the two real postings and four synthetic fixtures) is
  the default check; `--replay` measures a rule change at no cost. `full`
  needs `--confirm-cost`. A live control is needed only when the prompt or
  the schema changes.

On 2026-11-10 the canary fixture's seed-7 analysis was byte-identical on
standard, Flex and the free key. A typical phase now costs: rule changes,
nothing (replay); a prompt or schema change, seed 7 on everything plus
unseeded runs of the real postings, about USD 0.25 for both arms (the 17
synthetic fixtures free, about USD 0.0075 per real analysis at Flex).

## The guards, in the order they run

1. **Coverage** (M8-F): every qualification line of the posting is covered
   by an entry; otherwise one repair call for those lines. A line a colon
   announces belongs to that item, and a repaired line that details or
   restates a listed item merges into it instead of becoming a new one
   (M8-G).
2. **Posting rules**: the quote must be in the posting; descriptions and
   plain responsibilities drop; kind from the posting's heading and
   softening words; a softened clause of a required item becomes its own
   preferred item; a preferred item is the clause its softening word is in
   (M8-F); the requirement keeps the posting's spelling and language; key
   terms must be in the quote.
3. **CV quotes**: every quote is checked against the CV text; an invented
   figure in a suggested bullet becomes a placeholder.
4. **Statuses**, in order: key-term coverage caps, after the quote's own
   alternatives are added and with no cap while one cannot be looked up
   (M8-G), and with a degree's match moved to the posting's "related field";
   years (the CV's stated
   total for a role, the quoted roles for a skill, never raising a
   `missing`); a verified match is evidence; met and partial need a quote;
   an alternative no CV can show is `not_evident`; `not_evident` only where
   a CV cannot show the thing; a language level only when the CV states it;
   "Not shown in your CV" quotes nothing.
5. **Evidence placement**: skills-list and summary quotes give way to an
   experience line that shows the terms; otherwise "only listed in your
   skills" or "only claimed in your summary".
6. **The rest of the output**: matched skills must be in the CV and quoted
   by a line that names them; suggested bullets keep a real role and only
   their own figures; ATS problems need a CV quote; the headline and the
   outcome sentences of the job-fit paragraph are written from the
   statuses, and a recommendation that argues another status is dropped
   (M8-G); prose in another language is asked for again once; control
   characters go.

## Tried and rejected

- **Sending the PDF to the model** (M8-A). Same requirement metrics, but the
  model "corrected" the CV's accents in its quotes (29 of 129 failed the
  text check) and invented artifacts the text layer did not have. The
  scanned CV is refused instead (`PDF_SCANNED`).
- **Two calls, extraction then judgement** (M8-A). Recall 100% but precision
  94% (stack and condition lines extracted, years clauses split), less
  stable between runs, and 51% more expensive. Removed in M8-C.
- **A model field for "an alternative no CV can show"** (M8-C). The same 18
  hits as a pattern list in code, plus 13 false alarms in 108 analyses.
- **Dropping every responsibility** (M8-B). Lost hidden requirements (6/6 to
  4/6); `demandsCapability` stayed.
- **Asking the model to leave dropped entries empty** (M8-D). 2.5% cheaper,
  but Encora lost four requirements in one run. Reverted.
- **A text rule for LaTeX split accents** (M8-E). It broke "it´s" and
  "D´Angelo"; the parser composes them by geometry instead.
- **A field comment for what the model judges** (M8-F, M8-G). "Describe
  only what the requirements list shows" left prose contradicting the
  statuses at 3 → 4 of 20; writing the outcome sentences in code took it to
  0 of 20. "cvMatch is never a related concept" left stretched matches
  outside degrees at 32 → 38; the comment stays because its other half,
  "every alternative the posting offers", took gold key terms named from
  14/17 to 17/17.
- **Asking the repair to copy the listed requirement** for a restating line
  (M8-F): ignored 6 of 6. The detector reads a colon-announced line as part
  of its item, and the repair says `detailOf` instead (M8-G).
- **`propertyOrdering`** (M8-C). Gemini already generates in declaration
  order; the field changes nothing but is still sent.

## Where it stands

Each phase was measured against its own control in the same session, on
the fixtures of that day, so the rows are not one series; they say what
each step bought.

| phase | what it added | measured against its control |
|---|---|---|
| M8-A | the gold standard; PDF and two-call arms | baseline: recall 99%, precision 99%, kind 97%, status 96% |
| M8-B | requirement fields checked in code, `not_evident` | kind 97 → 100%, merges 12 → 4, met/partial without evidence 5 → 0; USD 0.0075 → 0.0099 |
| M8-C | key terms, kind from headings, years, evidence placement, generation order | synthetic status 94 → 98%, false met 13 → 4, real status 77 → 100%; USD 0.0100 → 0.0120 |
| M8-D | English only, stated language levels, no certifications | synthetic status 344/349 → 358/361, real 33/36 → 36/36; USD 0.0121 → 0.0117 |
| M8-E | LaTeX accents at extraction, ATS quotes, skill years | artifacts on the owner's CV 2 → 0; real recall 100 → 97% (the Encora degree) |
| M8-F | coverage detector and repair, the preferred-clause rule, read fixes | real recall 97 → 100%, telecom false met 5/6 → 0/6; real precision 100 → 94% |
| M8-G | spend caps; restatements merged; quote alternatives and related fields; outcome prose in code | below |

M8-F, control `a730eb1` against the final code, 2026-11-09: seed 7 on all
18 fixtures plus five unseeded runs of the two real postings and the six
synthetic fixtures with the most past errors (`long-boilerplate`,
`mid-missing-required`, `es-cv-en-job`, `es-posting`,
`hidden-in-responsibilities`, `weak-match`); 58 analyses per arm. The new
arm's rules are scored on a replay of its own answers through the final
code (`npm run eval -- replay`).

| | control | M8-F |
|---|---|---|
| synthetic recall (uncontested) | 97% (99%) | 98% (100%) |
| hidden items | 11/12 | 12/12 |
| precision | 100%, 0 merges | 100%, 4 merges (Kubernetes and Go 3, es-posting 1) |
| kind | 360/360 | 363/364 |
| status | 331/338 | 339/341 |
| swaps / false met, telecom apart | 2 / 0 | 1 / 0 |
| the telecom item | false met in 5 of 6 | missing (right) in 6 of 6 |
| years determined / within half a year | 44/51 / 33 | 44/51 / 33 |
| real recall | 97% (the Encora degree missing 2/6, Microsoft screening 1/6) | 100% |
| real precision | 100% | 94%: the repair adds Microsoft's background-check line as its own item, 6 of 6 |
| real kind / status / preferred evidence | 99/99 / 69/69 / 12/12 | 102/102 / 72/72 / 12/12 |
| "Not shown" items quoting the CV | 6 | 0 |
| summary-only hints | (none) | 1 in 58 |
| prose contradicting the statuses (20 read per arm) | 3 | 4 |
| cost / latency | USD 0.0112 / 8.8 s | USD 0.0115 / 9.0 s; with a repair 0.0133 / 10.1 s |

The detector fired in 8 of 58 analyses on 9 lines; the repair covered all
9: three real omissions (Microsoft's screening requirement once, the
es-posting SQL and warehouse line twice) and six restatements it added as
items. Without the repair, recall would have been 99% synthetic and 99%
real.

M8-G, 2026-11-10, in two steps. First every rule after the model was
replayed over M8-F's 58 stored answers (no calls): real precision 94 →
100% (the background check no longer added), Microsoft's "Not shown" 3 →
2 in 6 of 6, detector firings 8 → 3 (the three real omissions, all still
recovered), synthetic status 339 → 340/341 (the `es-cv-en-job` false
missing gone), stretched matches 31 → 18. Then live, because the prompt
and the repair schema changed: control `3862167` (M8-F's code with the
spend harness) against the final code, seed 7 on all 19 fixtures plus
unseeded runs (five of the six synthetic fixtures above, seven of the two
real postings), 62 analyses per arm; synthetic on the free key, real on
Flex. The new arm's rules are scored on a replay of its live answers
through the final commit, whose prompt is the same.

| | control | M8-G |
|---|---|---|
| synthetic recall (uncontested) | 97% (98%) | 98% (99%) |
| hidden items | 6/12 | 10/12 |
| precision by posting quote | 100%, 3 merges | 100%, 6 merges (Kubernetes and Go 4, analyst years with its softened clause 1, es-posting 1) |
| kind | 357/358 | 363/364 |
| status | 333/335 | 339/341 |
| swaps / false met, telecom apart | 1 / 0 | 0 / 0 |
| the telecom item | right in 6 of 6 | right in 6 of 6 |
| years determined / within half a year | 44/51 / 33 | 45/51 / 33 |
| gold key terms named | 14/17 | 17/17 |
| false "missing" from a key-term cap | 1 | 0 |
| stretched ✓ (read one by one) | 44, 12 of them degrees | 38, no degree |
| real recall / precision | 100% / 94% (8 splits) | 100% / 100% |
| real kind / status / preferred evidence | 136/136 / 96/96 / 14/16 | 136/136 / 96/96 / 14/16 |
| Encora degree present | 8 of 8 | 8 of 8 |
| Microsoft "Not shown" items per run | 3 in 8 of 8 | 2 in 8 of 8 |
| detector firings (lines) / false alarms | 8 (9) / 8 | 1 (1) / 0 |
| repaired lines added / merged | 9 / 0 | 1 / 0 |
| prose contradicting the statuses (20 read per arm) | 5 | 0 |
| cost at standard prices / latency | USD 0.0112 / 9.1 s | USD 0.0117 / 10.1 s |

By requirement text the new arm reads 98% precision with 7 splits: the
model rewrote ";" as "and" in a requirement line, and the scorer's text
anchor then spans the neighbouring bullets (the known scorer artifact);
located by the posting quote they are clean matches. Latency mixes the
free and Flex tiers. The live run found one regression of the new code,
fixed before the replay: "or a related field" was not read as one list
with the disciplines before it, so the moved degree match capped Encora's
degree at partial in 2 of 8. The `cvMatch` field comment removed no
stretch: outside degrees they went 32 → 38, the model now naming every
alternative and finding loose matches for some ("distributed systems ✓
(a line about remote teams)", "large-scale system design ✓
(scalable)"). The live phase spent USD 0.25 (Flex 0.23, standard 0.03 for
the canary, 107 free calls).

## Open

- **A requirement in prose outside a qualifications heading** is invisible
  to the detector: the whole `long-boilerplate` posting is prose.
- **Stretched matches outside degrees.** "large-scale system design ✓
  (scalable)", "security fundamentals ✓ (authentication)", "distributed
  systems ✓ (a line about remote teams)", "modelado dimensional ✓
  (modelado de datos)": 38 in 62 analyses, mostly on preferred items with no
  gold status, so the totals do not show them; the user does. Words cannot
  tell them apart (a stretch usually shares a word with its term), and the
  field comment did not move them. A per-term field saying how the CV word
  relates (same, synonym, translation, instance, related) with code
  dropping "related" is the next thing to measure.
- **The job-fit paragraph can shrink to one sentence** when every sentence
  the model wrote states an outcome (`es-cv-en-job`: "Your CV fully shows 6
  of the 6 required qualifications a CV can show.").
- **Merges.** Kubernetes and Go in one item in 4 of 6 runs; one run kept a
  softened clause inside the required years item beside its own preferred
  item.
- **The contested work-authorization item** of `long-boilerplate` is missed
  in every run of both arms.
- **The model behind the alias moves.** The interview fixture
  `dodges-two-of-three` scores 70 against its cap of 69 with M8-D, M8-F and
  M8-G code alike. The canary reference is `m8g-final-s7`, captured live on
  the standard tier on 2026-11-10 and confirmed unchanged by a second call.
