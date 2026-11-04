# The CV analysis

One model call per analysis, then code that checks what the model said
before anything is stored. This page is the reference for the output shape,
the rules applied in code, and how a change to any of it is measured.

## The path of one analysis

1. `analyzeResumeAction` reserves the unit, downloads the PDF and checks it
   (`%PDF-` header, size).
2. `lib/pdfParse.ts` extracts the text layer. Three refusals, each with its
   own code and copy; all three give the unit back and delete the uploaded
   object, and none reaches the model:

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
   and every number in the suggested bullets.
6. `enforceRequirementStatuses` applies the status rules below, after the
   CV quotes were checked, so a quote the guardrail dropped counts as none.
7. The row is stored with `guardStats`; `GuardStatDaily` gets the same
   counts, anonymously.

## A requirement

What the model fills for each entry of `jobFit.requirements`:

| field | meaning | stored |
|---|---|---|
| `sourceQuote` | the posting text it comes from, verbatim | yes |
| `heading` | the posting heading that text sits under, verbatim, or "" | no (anchors `section`) |
| `section` | `requirements`, `preferred`, `responsibilities`, `description`, `other` | yes |
| `demandsCapability` | whether the sentence asks the candidate to already have it | no |
| `requirement` | the requirement in one line | yes |
| `kind` | `required` or `preferred`, by the posting's framing | yes |
| `softenedClause` | `{ quote, status, evidence, note }`: the softened part of a required bullet ("ideally in e-commerce"), judged as its own preferred item; `quote` "" when there is none | no (becomes an entry) |
| `assessable` | `false` when no CV could show it (an attitude, a trait judged by its manner, availability, a hiring condition) | yes |
| `status` | `met`, `partial`, `missing`, `not_evident` | yes |
| `evidence` | one CV line, verbatim, or "" | yes |
| `note` | one sentence on the status | yes |

## The rules applied in code

Posting rules, before the CV quotes are checked:

- **Posting quote.** `sourceQuote` is compared with the posting the way CV
  quotes are compared with the CV (whitespace normalized; a difference only
  in case or punctuation is rewritten to the posting's text). An entry
  whose quote is not in the posting is dropped (`posting-source /
  requirement-dropped`).
- **Section.** An entry from `description` is dropped; one from
  `responsibilities` is dropped unless `demandsCapability` is true
  (`posting-section / requirement-dropped`). A heading that is not in the
  posting is recorded, not acted on.
- **Softened clause.** On a required entry, a `softenedClause.quote` that is
  in the posting and carries a softening word ("plus", "ideally",
  "preferably", "bonus", "nice to have", "preferiblemente", "deseable",
  "valorable", …) becomes its own `preferred` entry right after its parent,
  with the clause's status, evidence and note, and is cut from the parent's
  text and quote (`softened-clause / requirement-split`). A clause that is
  the whole entry turns the entry `preferred` (`kind-changed`). A clause
  without a softening word (an example, an alternative, a remark), not in
  the posting, or already listed as a preferred entry is recorded and adds
  nothing.

Status rules, after the CV quotes are checked:

- **met and partial need evidence.** Empty evidence (none given, or dropped
  by the guardrail as not in the CV) downgrades the status to `missing`, or
  to `not_evident` for an item a CV cannot show, and the note is replaced
  by "No line in your CV could be quoted for this, so it isn't counted as
  met." (`met-without-evidence / status-downgraded`). This catches a "met"
  with nothing behind it; it cannot catch a "met" backed by a real but
  irrelevant line.
- **not_evident only where a CV cannot show the thing.** `not_evident` on an
  assessable item becomes `missing`; `missing` on an item that is not
  assessable becomes `not_evident` (`not-evident / status-coerced`). An item
  that is not assessable can still be `met` when the CV states it ("Irish
  citizen" for a work authorization).

Every rule that fires is an intervention in `guardStats` (check, action,
path, the text it acted on) and a count in `GuardStatDaily`; `npm run
report:guards` reads the counts.

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
leave them out.

The interviewer gets them as `{{requirements_not_evident}}`, a list apart
from the gaps that the agent may ask about once the gaps are covered; they
take question slots after the gaps and before the strengths. The interview
feedback prompt, when the analysis has any, says that what the candidate
says about one is evidence for it.

## Analyses stored before these fields

`sourceQuote`, `section` and `assessable` are optional in the stored schema,
so older rows parse as before; `assessable` absent reads as true. Those rows
never carry `not_evident`, so the page renders them exactly as it did (no
extra group, same counts) and the interviewer gets "(none)" for the new
list. Nothing is migrated.

## Measuring a change

The extraction has a gold standard: `scripts/eval/fixtures/GOLD-RULES.md`
(what counts as a requirement, its kind, which items a CV cannot show) and
a `gold.json` per fixture with verbatim spans and expected statuses. A
change to the prompt, the schema or these rules is run against its control
in the same session, seed 7 plus unseeded runs, and scored:

```
npm run eval -- run change-s7
AI_SEED=none npm run eval -- run change-u1     # and u2..u5
npm run eval -- gold control-s7 control-u1 … ; npm run eval -- gold change-s7 change-u1 …
```

`gold` reports recall, precision (inventions, over-extraction by reason,
splits, merges), kind and status accuracy (with met/missing swaps, false
"met" and not-shown items called missing). `--by-source` locates items by
their `sourceQuote` instead of their text. A drop in recall or precision,
or a false "met", is a regression. After an intended change of the output,
capture a new seed-7 reference and point `npm run eval -- canary` at it.
