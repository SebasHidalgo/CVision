# Analysis quality: the M8 record

For whoever changes the CV analysis next. The M8 series (2026-11-03 to
2026-11-09) moved the analysis from "the model's list of requirements" to
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

Every change to the prompt, the schema or a requirement rule runs against
its control in the same session (the model behind the alias moves within
hours), seed 7 plus five unseeded runs, never across UTC midnight:

```
git worktree add --detach <dir> <control-sha>   # node_modules junction, .env, copy fixtures/ and fixtures.local/ in
npm run eval -- run ctl-s7                       # in the worktree
AI_SEED=none npm run eval -- run ctl-u1 --only <ids>   # u1..u5
npm run eval -- run new-s7; AI_SEED=none npm run eval -- run new-u1 --only <ids>   # in the checkout
npm run eval -- gold ctl-s7 ctl-u1 … ; npm run eval -- gold new-s7 new-u1 …
```

A seed-7 run of all 18 fixtures costs about USD 0.21; five unseeded runs
of the two real postings and the six fixtures with the most past errors
cost about USD 0.45 per arm. `gold` reports recall, precision
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

## The guards, in the order they run

1. **Coverage** (M8-F): every qualification line of the posting is covered
   by an entry; otherwise one repair call for those lines.
2. **Posting rules**: the quote must be in the posting; descriptions and
   plain responsibilities drop; kind from the posting's heading and
   softening words; a softened clause of a required item becomes its own
   preferred item; a preferred item is the clause its softening word is in
   (M8-F); the requirement keeps the posting's spelling and language; key
   terms must be in the quote.
3. **CV quotes**: every quote is checked against the CV text; an invented
   figure in a suggested bullet becomes a placeholder.
4. **Statuses**, in order: key-term coverage caps; years (the CV's stated
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
   their own figures; ATS problems need a CV quote; the headline is written
   from the statuses; prose in another language is asked for again once;
   control characters go.

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
| M8-F | coverage detector and repair, the preferred-clause rule, read fixes | below |

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

## Open

- **A requirement in prose outside a qualifications heading** is invisible
  to the detector: the whole `long-boilerplate` posting is prose.
- **A restating line becomes its own item.** The repair ignores "copy the
  listed requirement" for Microsoft's background check (6 of 6), so the
  headline counts 3 required items not shown instead of 2. No code rule was
  found that tells a detail of a listed condition from a second condition.
- **The model chooses the key terms that cap a status.** When it leaves out
  the alternative the CV has ("data or business analyst", only "business
  analyst" listed, for a CV that says "Analista de datos"), the cap is wrong:
  1 of 6 runs here, 2 of 6 in the control. Gold key terms named fell from
  12/17 to 7/17 in this measurement without a status error.
- **Prose is written before code corrects the statuses.** A recommendation
  can still argue a status the code changed (the telecom item), call a "not
  shown" item a gap (Python on Encora), or offer "willingness to learn" for
  a skill the posting does not accept it for (Ruby). The field comment did
  not reduce it (3 → 4 of 20). Writing those sentences in code, like the
  headline, is the structural fix.
- **The contested work-authorization item** of `long-boilerplate` is missed
  in every run of both arms.
- **The model behind the alias moves.** The interview fixture
  `dodges-two-of-three` scores 70 against its cap of 69 with M8-D and M8-F
  code alike; the canary is the check, and its reference (`m8f-final-s7`)
  was built from a replay because the key ran out of balance before a live
  capture.
