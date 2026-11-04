# The CV analysis

One model call per analysis, then code that checks what the model said
before anything is stored. This page is the reference for the output shape,
the rules applied in code, and how a change to any of it is measured.

## The path of one analysis

1. `analyzeResumeAction` reserves the unit, downloads the PDF and checks it
   (`%PDF-` header, size).
2. `lib/pdfParse.ts` extracts the text layer. Three refusals, each with its
   own code and copy; all three give the unit back and delete the uploaded
   object, none reaches the model, and each copy says "This didn't use any
   of your analyses.":

   | code | when |
   |---|---|
   | `PDF_UNREADABLE` | pdf.js cannot open the file (corrupt, truncated, password) |
   | `PDF_SCANNED` | fewer than 200 non-blank characters, and at least one page paints an image while holding under 40 characters of text (a scan; a scanner watermark fits under 40) |
   | `PDF_NO_TEXT` | fewer than 200 non-blank characters and no such page |

   The image check (pdf.js operator list) only runs on the refusal path, so
   a normal CV never pays for it. A CV with a photo has plenty of text and
   passes (the `marketing-match` fixture is that case, tested).
3. `lib/ai/resumeAnalysis.ts` sends the prompt (`lib/ai/prompts/cv-analysis.prompt.ts`)
   with `analysisResponseSchema` as the constrained-decoding schema.
4. `structureRequirements` (`lib/ai/requirementGuardrails.ts`) applies the
   posting rules below.
5. `guardAnalysis` (`lib/ai/analysisGuardrails.ts`) checks every CV quote
   and every number in the suggested bullets; `guardMatchedSkills` drops a
   matched skill with no quote, or one the CV never names.
6. `enforceRequirementStatuses` applies the status rules below, after the
   CV quotes were checked, so a quote the guardrail dropped counts as none.
7. `withEvidenceSources` places each quote in its CV section.
8. `requirementHeadline` writes the first sentence of `overall.summaryText`
   from the final statuses.
9. The row is stored with `guardStats`; `GuardStatDaily` gets the same
   counts, anonymously.

## Generation order

Gemini 3.5 Flash-Lite generates the JSON in the order the schema declares
its properties (measured in M8-C from raw responses; Gemini's documentation
says the default is alphabetical, so `lib/ai/client.ts` also sends
`propertyOrdering`, which `@ai-sdk/google` drops, to pin it). The order is
therefore the order of decision: `jobFit` first, its `requirements` before
its `description`, and inside a requirement the posting quote, heading,
section, the requirement and its key terms before `kind` and `assessable`,
the years quotes and the evidence before `status`, and `note` last. The
summary is written after the requirements. Measured against the old order
(status before evidence, summary first) the old order lost the last three
Encora requirements in every run.

## A requirement

What the model fills for each entry of `jobFit.requirements`, in order:

| field | meaning | stored |
|---|---|---|
| `sourceQuote` | the posting text it comes from, verbatim | yes |
| `heading` | the posting heading that text sits under, verbatim, or "" | no (anchors `section` and `kind`) |
| `section` | `requirements`, `preferred`, `responsibilities`, `description`, `other` | yes |
| `demandsCapability` | whether the sentence asks the candidate to already have it | no |
| `requirement` | the requirement in one line | yes |
| `softenedClause` | `{ quote, status, evidence, note }`: the softened part of a required bullet ("ideally in e-commerce"), judged as its own preferred item; `quote` "" when there is none | no (becomes an entry) |
| `keyTerms` | `{ mode: "all" \| "any", terms: [{ term, cvMatch }] }`: the named technologies, tools, industries, certifications and languages, each verbatim from `sourceQuote`, with the CV word that shows it (a synonym or another language counts) or "" | yes |
| `kind` | `required` or `preferred`, by the posting's framing | yes |
| `assessable` | `false` when no CV could show it (an attitude, a trait judged by its manner, availability, a hiring condition) | yes |
| `yearsEvidence` | for a years requirement, the CV lines that state the years or date the relevant roles | no (becomes `years`) |
| `evidence` | one CV line, verbatim, or ""; the strongest one, an experience bullet before the skills list | yes |
| `status` | `met`, `partial`, `missing`, `not_evident` | yes |
| `note` | one sentence on the status | yes |

Stored besides, computed in code: `evidenceSource` (`experience`,
`projects`, `skills`, `summary`, `education`, `other`), `skillsOnly` (met
or partial with its terms only on the skills list) and `years` (`{ min,
candidate, source: "statement" | "dates" }`).

## The rules applied in code

Posting rules, before the CV quotes are checked:

- **Posting quote.** `sourceQuote` is compared with the posting the way CV
  quotes are compared with the CV (whitespace normalized; a difference only
  in case or punctuation is rewritten to the posting's text). An entry
  whose quote is not in the posting is dropped (`posting-source /
  requirement-dropped`).
- **Section.** An entry from `description` is dropped; one from
  `responsibilities` is dropped unless `demandsCapability` is true
  (`posting-section / requirement-dropped`).
- **Kind, from the posting's own wording.** The heading counts only when it
  is in the posting and sits before the quote. A heading with a preference
  word ("Preferred", "Nice to have", "Bonus", "Valoramos") states
  `preferred`; one with a requirement word ("Required", "Minimum",
  "Requisitos") or a plain qualifications heading ("Qualifications and
  Skills") states `required`; one with both ("Job Requirements: Other &
  Additional") states nothing. A `preferred` entry whose quote has no
  softening word, under a heading that states `required` (or under none, in
  the `requirements` section), becomes `required`; a `required` entry under
  a heading that states `preferred` becomes `preferred` (`posting-kind /
  kind-changed`).
- **Softened clause.** On a required entry, a `softenedClause.quote` that is
  in the posting and carries a softening word ("plus", "ideally",
  "preferably", "bonus", "nice to have", "preferiblemente", "deseable",
  "valorable", …) becomes its own `preferred` entry right after its parent,
  and is cut from the parent's text and quote (`softened-clause /
  requirement-split`). A clause that is the whole entry turns the entry
  `preferred`. A clause without a softening word is recorded and adds
  nothing.
- **The requirement keeps the posting's spelling and language.** A word that
  differs from the posting's only in accents is respelled ("Português" →
  "Portugués"); a requirement written in another language than its quote is
  replaced by the quote (`requirement-text / text-replaced`).
- **Key terms.** A term not in its `sourceQuote` is dropped, and so is a
  number of years (`key-term / term-dropped`); a term in the softened clause
  moves to the derived preferred entry. Mode `any` where the quote offers no
  choice (no "or", "such as", "e.g.", no parenthesised list) becomes `all`
  ("dbt and data contracts") (`key-term / mode-changed`).

Status rules, after the CV quotes are checked, in this order:

1. **Key-term coverage.** A `cvMatch` that is not in the CV is emptied
   (`key-term / match-dropped`). Terms joined by "or" in the posting, or
   listed in one parenthesis, form a group that one shown term satisfies;
   the alternatives not needed are removed from the stored list. Mode
   `all`: every group shown allows the model's status, some caps it at
   `partial`, none forces `missing` and clears the quote. Mode `any`: one
   shown term allows the model's status, none forces `missing`. The note is
   rewritten ("Your CV shows MySQL but not Ruby on Rails.") (`key-term /
   status-capped`). A requirement without key terms keeps the model's status.
2. **Years.** The posting's minimum is parsed from `sourceQuote` ("5+",
   "3-5" takes 3, "at least 3", "two or more", "mínimo 4", "más de 2"; never
   "every two years"). The candidate's years are an explicit statement in
   the quoted lines ("2+ years of experience", "cuatro años") or else the
   sum of their date ranges, overlapping months counted once. `met` at or
   above the minimum, `partial` from 75% of it, `missing` below; key-term
   coverage still caps it. The status is lowered to that, or raised to it
   from `partial` only: a `missing` may be the model ruling the quoted roles
   irrelevant (a pastry chef's eight years for a backend role). The note
   states both numbers ("The posting asks for 5+ years; your CV shows about
   2.") unless the model's status is lower than the numbers allow
   (`years / status-capped`, `status-coerced`, `recorded` when undetermined).
3. **A verified match is evidence.** met or partial with no quote left but a
   CV match on file quotes the CV line that holds it (`evidence-source /
   evidence-replaced`).
4. **met and partial need evidence.** Otherwise empty evidence downgrades to
   `missing`, or to `not_evident` for an item a CV cannot show, with a fixed
   note (`met-without-evidence / status-downgraded`).
5. **An alternative a CV cannot show.** A `sourceQuote` matching the pattern
   list ("or willingness to learn", "or a clear appetite to learn it fast",
   "or eagerness to pick it up", "o disposición para aprenderlo", "o ganas
   de aprender", … in `UNSHOWABLE_ALTERNATIVE`) makes the item `assessable:
   false`; `missing` becomes `not_evident`, and a `not_evident` item gets
   the note "Python isn't in your CV; the posting accepts willingness to
   learn and work with it — say so in your cover letter." and no quote
   (`unshowable-alternative`). M8-C measured a model field beside the
   pattern: the same 18 hits and 13 false alarms in 108 analyses, so the
   field was removed.
6. **not_evident only where a CV cannot show the thing**, as in M8-B
   (`not-evident / status-coerced`).
7. **The CV's own language.** A requirement that names one language, the one
   the CV is written in ("Fluency to read, write and speak in English" on an
   English CV), judged `missing` or `not_evident`, is `met`: "Your CV is
   written in English, which shows it." (`cv-language / status-coerced`).

After the statuses:

- **Evidence source.** Each quote is placed in the CV section of the last
  heading above it (`sectionsDetected`, or a known heading). A met or
  partial quoted from the skills list gives way to an experience or project
  line that shows its term in use (every group, for `all`) (`evidence-source
  / evidence-replaced`); when no such line exists it is `skillsOnly`, and
  the page says "Only listed in your skills — show it in an experience
  bullet."
- **Matched skills.** One with no quote after the guardrail, or whose name is
  neither in its quote nor in the CV, is dropped (`matched-skill /
  skill-dropped`). The cost: a synonym ("Postgres" for "PostgreSQL") named
  nowhere else in the CV goes too.

Every rule that fires is an intervention in `guardStats` (check, action,
path, the text it acted on) and a count in `GuardStatDaily`; `npm run
report:guards` reads the counts. The posting rules' paths index the
model's own list; the others index the stored list.

## The headline and the language

The first sentence of `overall.summaryText` is written in code from the
final statuses of the required items: "You meet every required
qualification.", or "Core gaps: 5+ years of experience; Ruby on Rails;
Redis, Elasticsearch or Sidekiq." (absent key terms, the years label, or the
requirement's own text cut at 60 characters), and "Partly met: …" for a
partial that names no absent term. The model's summary follows; its field
comment, and `jobFit.description`'s, say not to restate statuses. Read on 20
analyses each, 6 of the control's contradicted the statuses and none of the
new ones did.

The model writes the analysis in the posting's language once the
requirements come first (6 of 6 Spanish-posting runs; the old order wrote
English). Every sentence code writes (headline, notes) follows the language
the model used (`lib/ai/analysisWording.ts`, English and Spanish), detected
from its own text, so an analysis is in one language. The page's own labels
stay English.

## The four statuses and the verdict

`deriveFitVerdict` (`lib/schemas/resumeSchema.ts`) counts `met` and
`partial` per kind; `not_evident` is in neither count. The bar is cleared
when no required item is missing and at most one is partial; two preferred
items met (a partial counts half) make it strong. A posting whose required
items are all `not_evident` clears the bar; one with no required items at
all is an extraction failure and reads as weak. `describeTally` adds "N not
shown in your CV" when there are any.

The analysis page lists `not_evident` items in their own group, "Not shown
in your CV", with "Mention it in your cover letter or be ready to talk about
it in the interview." The required and preferred groups and their counts
leave them out. Under each requirement it lists the key terms with ✓ or ✗
and the CV word when it differs ("PostgreSQL ✓ (Postgres)"); for an `any`
requirement with a match, only the shown terms. Quotes are shown without a
leading bullet marker; the stored quote stays verbatim.

The interviewer gets `not_evident` items as `{{requirements_not_evident}}`,
a list apart from the gaps that the agent may ask about once the gaps are
covered. The interview feedback prompt, when the analysis has any, says
that what the candidate says about one is evidence for it.

## Analyses stored before these fields

`sourceQuote`, `section`, `assessable`, `keyTerms`, `evidenceSource`,
`skillsOnly` and `years` are optional in the stored schema, so older rows
parse as before; `assessable` absent reads as true. Those rows render as
before: no term list, no skills-only advice. Nothing is migrated.

## Measuring a change

The extraction has a gold standard: `scripts/eval/fixtures/GOLD-RULES.md`
(what counts as a requirement, its kind, which items a CV cannot show, how
years are counted) and a `gold.json` per fixture with verbatim spans,
expected statuses, key terms, years and preferred evidence. Two real
postings are in the gold (`fixtures.local/`: the Microsoft posting and the
Encora one, both against the owner's CV); real postings are the test that
matters, since the synthetic gold read kind at 100% while the first real
posting outside it had 2 kind errors in 10. A change to the prompt, the
schema or these rules is run against its control in the same session, seed
7 plus unseeded runs, and scored:

```
npm run eval -- run change-s7
AI_SEED=none npm run eval -- run change-u1     # and u2..u5
npm run eval -- gold control-s7 control-u1 … ; npm run eval -- gold change-s7 change-u1 …
```

`gold` reports recall, precision (inventions, over-extraction by reason,
splits, merges), kind and status accuracy (with met/missing swaps, false
"met" and not-shown items called missing), key terms named and judged
right, years determined, and evidence quoting the preferred line, synthetic
and real apart. `--by-source` locates items by their `sourceQuote` instead
of their text. A drop in recall or precision, or a false "met", is a
regression. A control runs from a git worktree of the commit it measures,
with the same fixtures copied in. `compare` and `stability` refuse runs
captured on both sides of UTC midnight (the prompt states the date). After
an intended change of the output, capture a new seed-7 reference and point
`npm run eval -- canary` at it; the canary replays its reference's date, so
a difference means the model behind the alias moved.
