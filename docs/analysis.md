# The CV analysis

One model call per analysis (and a small second one when the analysis
skipped a qualification line of the posting), then code that checks what
the model said before anything is stored. This page is the reference for the output shape,
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

   Split accents are composed here (see "Extraction and accents" below), and
   the count goes to `guardStats` as one `pdf-text / accent-composed`
   intervention per document (the daily tally counts documents; it is not
   the guardrail firing).
3. `lib/ai/resumeAnalysis.ts` sends the prompt (`lib/ai/prompts/cv-analysis.prompt.ts`)
   with `analysisResponseSchema` as the constrained-decoding schema. When a
   qualification line of the posting is covered by no entry, one repair
   call asks for entries for those lines only, and they join the list in
   posting order before any rule below runs (see "Coverage").
   Everything after the calls is `finishAnalysis`, pure apart from
   count-only log lines, so the eval can replay stored answers through it.
4. `structureRequirements` (`lib/ai/requirementGuardrails.ts`) applies the
   posting rules below.
5. `guardAnalysis` (`lib/ai/analysisGuardrails.ts`) checks every CV quote
   and every number in the suggested bullets.
6. `enforceRequirementStatuses` applies the status rules below, after the
   CV quotes were checked, so a quote the guardrail dropped counts as none.
   It gets the CV's own statement of its total years (`statedTotalYears`).
7. `withEvidenceSources` places each quote in its CV section.
8. `guardMatchedSkills` and `guardBulletRoles` check the skills and the
   suggested bullets' role labels against the CV (below).
9. `requirementHeadline` writes the first sentence of `overall.summaryText`
   from the final statuses; `withOutcomeProse` and `guardRecommendations`
   (`lib/ai/requirementProse.ts`) write the outcome sentences of
   `jobFit.description` and drop recommendations that argue another status.
10. `withoutControlCharacters` strips control characters (U+0000–U+001F
    except tab and line breaks, U+007F–U+009F) from every string the model
    wrote; one was seen in a role label ("Asociaci\u0003on").
11. The row is stored with `guardStats`; `GuardStatDaily` gets the same
    counts, anonymously.

## Extraction and accents

pdfTeX with the default OT1 font encoding (Computer Modern, the usual
LaTeX résumé templates without `\usepackage[T1]{fontenc}`) has no "é": it
draws the accent, moves back, and draws the "e" under it. pdf.js reads the
stream in order and gives "Jos´e", "Asociaci´on", "Ingenier´ıa" (with a
dotless ı). `lib/pdfAccents.ts` puts them back, from where pdf.js says each
piece was drawn: the accent ends one text item ("Jos´") and the next item
starts with the letter, to the left of where the accent's item ended. A
typed "´" ("don´t", "D´Angelo") advances like any glyph and is never drawn
over, so it is left alone. Covered: acute, grave, circumflex, tilde,
diaeresis, ring, cedilla, caron, macron (and breve, dot above, double
acute, ogonek), spacing or combining, accent before or after the letter,
dotless ı/ȷ as bases, upper and lower case; only a letter Unicode has as
one code point is produced.

One more step: pdf.js turns a forward move above about 0.1 em into a space,
and the accent's centering shift over a wide capital is that big, so
"GESTIÓN" came out "GESTI ÓN". When a composed accent has a space right
before it, the page's operator list is read (glyph widths and moves) and
the space is removed only if the letter touches the glyph before the
accent (under 0.1 em apart); "Informatique, Être" keeps its real space.
The two lists are matched in stream order and nothing is touched when they
do not line up one to one.

A text-only rule was measured beside geometry and rejected: composing any
accent followed by a letter breaks "it´s" (ś) and "I´m" (ḿ); restricted to
vowels it still breaks "D´Angelo" and "L´Oréal", and it cannot see the
spurious spaces. Geometry: every expected word in every engine and no
false positive. The corpus is `scripts/eval/accents/` (one Jake's-resume
style CV compiled with pdfLaTeX OT1 with and without `\pdfgentounicode=1`,
pdfLaTeX T1, XeLaTeX and LuaLaTeX, plus a Chromium page; `build.mjs`
rebuilds it with MiKTeX), tested in `lib/pdfParse.accents.test.ts`. The
text layer of every non-LaTeX fixture is byte-identical before and after.

What extraction cannot fix is still the model's to report in
`atsCompatibility.encodingArtifacts`: mojibake ("JosÃ©", "Ã±"), the
replacement character (U+FFFD), letters missing from a word (the
`mojibake-cv` fixture). A correctly accented letter is never an artifact,
and the only advice for an artifact is to re-export the PDF.

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
| `keyTerms` | `{ mode: "all" \| "any", terms: [{ term, cvMatch, relation }] }`: the subjects, the category a list of examples illustrates, the examples, the alternatives, technologies, tools, industries, certifications and languages, each verbatim from `sourceQuote`; the CV word that shows it or ""; and how that word relates to the term (`same` (or an instance of the kind named), `synonym`, `abbreviation`, `translation`, `related`, `none`; M8-H) | yes |
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

## Coverage: no qualification line left out

An omitted requirement is the worst failure the analysis has: the verdict
is computed from an incomplete list and nothing says so. In M8-E the Encora
degree was missing from 3 of 8 analyses and one run lost the posting's last
four qualifications at once. `lib/ai/requirementCoverage.ts` checks the
list in code:

- **Qualification lines.** The posting is read line by line. A heading is
  a short line (60 characters, 8 words at most) that is not a list item and
  does not end like a sentence; markdown `#` and `**…**` and a closing
  colon are ignored. It introduces qualifications when it carries the
  words that decide `kind` ("Requirements", "Qualifications", "What you
  bring", "What we are looking for", "Nice to have", "Bonus", "Requisitos",
  "Valoramos", "Perfil", "Job Requirements: Other & Additional"…) and is not
  "Additional information", benefits, salary or process. Under it, the items
  are the marked lines (`-`, `*`, `•`, numbers) with their wrapped
  continuations, or, in a list without markers, each line up to the next
  heading (a line of more than 300 characters is a paragraph, not an item).
  Prose after a marked list ends the block. An item ending in a colon takes
  in what it announces, across a blank line (M8-G): the screening paragraph
  that ends "…the following screenings: … Background Check:" and the
  background-check sentence after it are one item, so a quote of either
  covers both.
- **Covered.** A line is covered when the `sourceQuote` or the softened
  clause of any entry the model returned overlaps it (12 characters, or half
  of a shorter line), including an entry the section rule later drops: the
  model read that line and classified it. A quote the posting does not
  have covers nothing, so a misquoted entry that `posting-source` drops
  leaves its line uncovered.
- **Counted and logged.** Each uncovered line is a `requirement-coverage /
  requirement-uncovered` intervention, and the server logs
  `[CVision][ai] requirement lines uncovered: N (<analysis id>)`.
- **One repair, only then.** `lib/ai/prompts/requirement-repair.prompt.ts`
  sends the posting, the CV, the uncovered lines numbered and the
  requirements already listed, with the same entry fields and rules as the
  analysis (dates, one requirement per requirement, quoted fields), and
  `requirementRepairSchema` (`{ requirements: [...] }`). It is told to
  answer the skipped lines only: the first version re-emitted all eight
  Microsoft lines (1.3k output tokens) for one skipped line. Each entry
  starts with `detailOf` (M8-G): 0 for a requirement of its own, N when the
  line only details listed requirement N. An entry counts only when its
  quote covers a skipped line. It merges into an item already listed,
  without being added (`requirement-merged`), when it says `detailOf` N,
  or when its quote restates that item's quote: a run of 3 consecutive
  content words in common, or 60% of its content words, boilerplate
  ("including, but not limited to", "years of experience") left out, and
  only into an item whose quote is in the posting, since one the source
  rule drops would take the line with it. One whose requirement copies a
  listed requirement's text also covers its line without adding an entry,
  and one with section `description` covers it and is dropped by the
  section rule as usual. The kept entries go in posting order, before every
  rule below, so all of them apply (`requirement-recovered`, with
  "requirement added", "detail of requirement N", "restates a listed
  requirement" or "not a requirement"). The repair's notes get the same
  English check as the analysis, asked again once inside the same 20 s
  (`REPAIR_TIMEOUT_MS`); a failed repair keeps the analysis and is recorded
  (`requirement-coverage / recorded`, "repair failed: <code>") and logged.
  At most one repair per analysis; an analysis that covers every line
  makes no second call.
- **What it cannot see.** A requirement stated only in prose, outside a
  qualifications heading (the `long-boilerplate` posting is all prose), and a
  line covered by an entry about something else in the same span.

## The rules applied in code

Posting rules, before the CV quotes are checked:

- **Posting quote.** `sourceQuote` is compared with the posting the way CV
  quotes are compared with the CV (whitespace normalized; a difference only
  in case or punctuation is rewritten to the posting's text). An entry
  whose quote is not in the posting is dropped (`posting-source /
  requirement-dropped`).
- **Section.** An entry from `description` is dropped; one from
  `responsibilities` is dropped unless `demandsCapability` is true
  (`posting-section / requirement-dropped`). When that would leave no
  required entry, the entries are kept and recorded instead
  (`posting-section / recorded`, "kept: nothing required survived"): on
  2026-11-05 the M8-C code labelled every entry of the `long-boilerplate`
  posting a description in all three runs, and in M8-F one run labelled
  its four required items a description while the preferred one survived,
  which left an analysis with no required item. An analysis without its
  requirements is worse than an over-extracted one. Every time it fires the
  server logs `[CVision][ai] requirements kept: the section rule would have
  left none required` with the analysis id (the fixture id in the eval).
- **Kind, from the posting's own wording.** The heading counts only when it
  is in the posting and sits before the quote. A heading with a preference
  word ("Preferred", "Nice to have", "Bonus", "Valoramos") states
  `preferred`; one with a requirement word ("Required", "Minimum",
  "Requisitos") or a plain qualifications heading ("Skills and
  Qualifications") states `required`; one with both ("Other & Additional
  Requirements") states nothing. A `preferred` entry whose quote has no
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
- **The requirement is the posting's own line** (M8-H). The row's title is
  the part of `sourceQuote` the model's line covers, as the posting writes
  it ("You should have 1+ years testing web apps" → "1+ years testing web
  apps"), or the whole quote when the model rewrote it ("Strong SQL; …" for
  "Strong SQL and …", a translation, another discipline's name). A part of
  under three words that is neither half the quote nor a whole clause is a
  label ("TypeScript" of "TypeScript experience is a plus") and the quote
  wins. A softened clause split off below never reaches the parent's title,
  even when it sits mid-line. No closing punctuation; the first letter as
  the model wrote that word, otherwise as the posting does
  (`requirement-text / text-replaced`). The model's text is used only when
  no quote survived, which since M8-B means never for a new analysis.
- **A preferred item is the clause its softening word is in** (M8-F). For a
  `preferred` entry whose kind comes from its own words (not from a
  preference heading), a quote that runs over a ";" or a sentence break
  into a clause without a softening word keeps only the softened clause,
  and the requirement becomes that clause's text, when the model named key
  terms outside it (`softened-clause / text-replaced`). Those terms then
  drop like any term outside the quote; if they were the only shown terms,
  a `met` or `partial` resting on them becomes `missing`, with the
  note "Your CV shows utilities and retail, but the posting mentions them
  only as context, not as this requirement." (`softened-clause /
  status-capped`). The case: "A background in telecommunications would
  help but is not essential; most of our best leads came from retail,
  hospitality or utilities." The posting prefers telecom; the industries
  after the semicolon describe past hires.
- **Key terms.** A term not in its `sourceQuote` is dropped, and so is a
  number of years (`key-term / term-dropped`); a term in the softened clause
  moves to the derived preferred entry. Mode `any` where the quote offers no
  choice (no "or", "such as", "e.g.", no parenthesised list) becomes `all`
  ("dbt and data contracts"), and so does `any` over subjects the quote
  joins with "and" or "including" and never "or" outside its examples
  ("data pipelines and message queues (e.g., Kafka), including alerting")
  (`key-term / mode-changed`, M8-H).

Status rules, after the CV quotes are checked, in this order:

1. **Key-term coverage.** A `cvMatch` that is not in the CV is emptied
   (`key-term / match-dropped`). So is one whose `relation` is `related` or
   `none` (M8-H): an AI-powered product does not show "AI development
   tools", a line about remote teams does not show "distributed systems",
   unless the CV word contains the term itself (`key-term / match-dropped`,
   the relation as replacement). A missing or unknown relation parses as
   `none`; answers recorded before M8-H have none at all and replay as
   before. A group whose only match was `related` is adjacent: it caps the
   status at `partial`, never `missing`, the status's own definition
   ("something adjacent but not the thing asked for"). Terms joined by "or" in the posting, or listed in one
   parenthesis, form a group that one shown term satisfies. **Examples are
   not the requirement** (M8-H): terms in a list after "e.g.", "for
   example", "such as", "like" or "como" before a name, "including" before
   a comma list or "including, but not limited to", "por ejemplo", "tales
   como", or a parenthesised list of two or more, join the group of the
   category they illustrate when the category is a term (the term ending
   right where the list starts); without one they form a group that caps
   nothing unless one of them is shown, which shows the category. Mode
   `all`: every counted group shown allows the model's status, some caps it
   at `partial`, none forces `missing` and clears the quote. Mode `any`: one
   shown term allows the model's status, none forces `missing` when a
   non-example term exists. Terms are matched as whole tokens: "C" is never
   the "c" of "technical". The note is rewritten ("Your CV shows MySQL but
   not Ruby on Rails."), never naming an example (an item named only by
   examples is labelled by the examples it lacks: "Redis, Elasticsearch or
   Sidekiq"), and names related experience without counting it ("… It shows "an AI-powered product",
   which is related but not the same.") (`key-term / status-capped`). Every
   term stays in the stored list, alternatives not needed and examples
   included, for the page. A requirement without key terms keeps the
   model's status.
   Before the cap (M8-G, `lib/ai/requirementAlternatives.ts`): the
   alternatives the quote itself offers are read in code (items joined by
   "or"/"o"/"u" with the comma-listed items before them, a parenthesised
   list, an examples list after "such as", "e.g.", "like", "including",
   "tales como", "por ejemplo"; never a bare "como", which is usually "as").
   An alternative of a list the model's terms belong to and that the terms
   left out is added: as shown when the CV has it verbatim, as absent when
   it does not (`key-term / alternative-added`). Two kinds cannot be looked
   up: an item that borrows its noun from the next one ("data" in "a data or
   business analyst"), and any item when the CV and the posting are in
   different languages (a function-word count on each). While such an item
   is left, no key-term cap applies, the years rule's included
   (`key-term / cap-skipped`): a CV that says "Analista de datos" is not told
   it lacks "data or business analyst". Open alternatives ("equivalent
   experience", "related field", "afín") are never added. For a degree that
   accepts a related field, a term "shown" by a different discipline
   ("Computer Science ✓ (… Engineering)") gives its match to the quote's
   own "related field" phrase and reads as absent itself
   (`key-term / match-dropped`, with the phrase as replacement).
2. **Years.** The posting's minimum is parsed from `sourceQuote` ("5+",
   "3-5" takes 3, "at least 3", "two or more", "mínimo 4", "más de 2"; never
   "every two years"). The CV's total is read only from an explicit
   total-experience phrase in the summary or above the first heading ("2+
   years of experience", "cuatro años de experiencia"); "eight years on JVM
   services" or "3 years in fintech" is not one, and a parenthesised
   "Python (6 years)" is one skill's. Then it depends on what the years
   are of:
   - **A role** ("5+ years of experience building full stack web
     products", "5+ years in infrastructure, platform or SRE roles"):
     the CV's total first, otherwise an explicit statement in the quoted
     lines ("cuatro años") or the sum of their date ranges, overlapping
     months counted once. One number per CV whatever lines the model
     quotes.
   - **One skill or domain** (a key term in the years clause that names no
     role and is not an example, M8-H: "3+ years writing production
     Python", never "1+ years of engineering experience coding in languages
     such as …"): the quoted lines' years,
     capped by the total. With no quoted years, a total below the minimum
     caps the status (75% rule; note "…your CV shows about 2 in total."),
     and a total at or above it says nothing: the item is undetermined and
     the model's status stands. The total never raises a status.
   `met` at or above the minimum, `partial` from 75% of it, `missing`
   below; key-term coverage still caps it. The status is lowered to that,
   or raised to it from `partial` only: a `missing` may be the model ruling
   the quoted roles irrelevant (a pastry chef's eight years for a backend
   role). The note states both numbers only when the years decided the
   status, never under a key-term cap (`years / status-capped`,
   `status-coerced`, `recorded` when undetermined).
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
   learn it on the job — say so in your cover letter." and no quote
   (`unshowable-alternative`). M8-C measured a model field beside the
   pattern: the same 18 hits and 13 false alarms in 108 analyses, so the
   field was removed.
6. **not_evident only where a CV cannot show the thing**, as in M8-B
   (`not-evident / status-coerced`).
7. **A language level counts only when the CV states it** (owner decision,
   M8-D; `lib/ai/requirementLanguages.ts`). A requirement that asks for a
   level of a language (it names English, Spanish, German, French,
   Portuguese, Italian, Dutch, Chinese or Japanese, in English or Spanish,
   and is the bare language with at most one other word, "Portugués." or
   "Inglés profesional", or uses a proficiency word: fluent, fluency,
   proficient, level, native, bilingual, a CEFR level, conversational,
   intermediate, advanced, "nivel", "dominio", "avanzado"; since M8-E,
   "writes clearly in English" or "good written English" is the model's
   call)
   is `not_evident`, with no quote and the note "Your CV doesn't state your
   English level. Add a Languages line, e.g. 'Spanish (native), English
   (C1)'.", unless the CV states a level for that language: a CEFR level,
   native, fluent, bilingual, advanced, intermediate, basic, proficient,
   conversational, or a test (TOEFL, IELTS, TOEIC, Cambridge, FCE, CAE, CPE,
   DELE), in English or Spanish, in the language's own clause ("English (B2,
   written and spoken)") or in the four words before it ("Fluent English").
   A CV written in English does not show the candidate's English. This is
   the one `not_evident` that is not `assessable: false`, and it runs last,
   so no other rule overrides it (`language-level / status-coerced`). The
   rule does not judge whether the stated level is enough (B1 against
   "C1 required" stays the model's call).
8. **"Not shown in your CV" quotes nothing.** A `not_evident` item's CV
   quote is cleared (`not-evident / evidence-cleared`); the page also hides
   the quote of a stored row that still has one.

After the statuses:

- **Evidence source.** Each quote is placed in the CV section of the last
  heading above it (`sectionsDetected`, or a known heading). A met or
  partial quoted from the skills list gives way to an experience or project
  line that shows its term in use (every group, for `all`) (`evidence-source
  / evidence-replaced`); when no such line exists it is `skillsOnly`, and
  the page says "Only listed in your skills — show it in an experience
  bullet." A quote from the summary gets the same search; without a line
  that shows the terms (or with no key terms to look for) it is
  `summaryOnly`, and the page says "Only claimed in your summary — show it
  in an experience bullet." The status does not change.
- **Matched skills.** Its
  name must be in the CV, or a requirement's verified key term must have
  that name and a CV match ("Postgres" for "PostgreSQL"; `matched-skill /
  recorded`, "synonym: …"); otherwise it is dropped (`matched-skill /
  skill-dropped`). Its quote must name it (or the synonym): a quote that does
  not, or one the guardrail dropped, becomes the CV line that does, an
  experience or project line first (`matched-skill / evidence-replaced`),
  and a skill no line names is dropped.
- **Suggested bullets: role and figures.** The CV's experience and project
  sections are read as entries: a title line and a company line, then
  bullets with their wrapped lines (`cvEntries`). A `suggestedBullets[].role`
  is kept when each of its parts (split on commas, "|", "·", spaced dashes,
  "at", "en", "@") is in the CV, letters only; otherwise it becomes the
  nearest entry's title and company lines, dates removed (`bullet-role /
  text-replaced`). A figure in an example must be in the CV bullet the
  example rewrites (three or more shared words), or, with no such bullet,
  in its role's text; otherwise it becomes the placeholder (`bullet-figure
  / number-placeheld`). That is what stops "reducing downtime by 40%" from
  moving onto another bullet of the same role.
- **ATS problems need a quote.** The model answers `issues: [{ quote,
  problem, fix }]`, quote first; an issue whose quote is not in the CV text
  (exactly or but for case and punctuation) is dropped with its fix
  (`ats-problem / problem-dropped`). The stored shape is still `problems`
  and `fixes`. The field comment also says en dashes, • bullets, accented
  letters and the absence of icons are not problems.

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
partial that names no absent term. With no gap but required items under
"Not shown in your CV", it says "No core gaps; 2 required items aren't
shown in your CV." instead of claiming every one is met. The model's
summary follows; its field comment, and `jobFit.description`'s, say not to
restate statuses. Read on 20 analyses each, 6 of the control's contradicted
the statuses and none of the new ones did.

Since M8-G the outcome sentences of `jobFit.description` are written the
same way (`lib/ai/requirementProse.ts`): how many required items a CV can
show are fully shown, one sentence per gap (the years, "Your CV shows MySQL
but not Ruby on Rails.", "Your CV doesn't show any of …"; four at most,
then "N more gaps are in the list below."), the posting's own alternative
for a "not shown" item ("Python isn't in your CV; the posting accepts
willingness to learn …"), the Languages advice for an unstated level, a
count of the items no CV can show, and the preferred items not shown. Of
the model's paragraph only the sentences that state no outcome stay: a
sentence with an outcome word (gap, lacks, missing, meets, aligns, covers,
years…) that names a requirement's key term, a number of years or the fit
as a whole is dropped (`prose / sentence-dropped`), and a connective left
dangling ("Furthermore, …") goes with it. **Advice stays** (M8-H): a
sentence that opens with what to do ("To better align with this role,
emphasize…", "Consider…", "Bringing… forward") is dropped only when it
contradicts the statuses, with the reason as replacement: it calls a met
or partial requirement absent ("…since Ruby on Rails is absent" for a
skills-only Rails), calls a requirement whose every named term is met a
gap, calls an item under "Not shown in your CV" a gap (Python on the Encora
posting), claims a strong fit when a required item is missing or two are
partial, or offers willingness to learn where the posting accepts none.
The field comment asks the model for document commentary only. A
strategic recommendation is dropped (`prose / recommendation-dropped`) when
it treats a met requirement as a gap ("gain experience with Docker" for a
CV that shows it), calls a requirement under "Not shown in your CV" a gap,
or offers willingness to learn for a requirement whose posting accepts no
such alternative.
 A requirement is named in prose by one
of its key terms in full: since M8-H "Ruby" alone no longer names "Ruby on
Rails".

The analysis is written in English, whatever the language of the CV or the
posting (owner decision, M8-D; one line of the prompt). Quotes stay
verbatim, and a requirement's text stays in the posting's words, so a
Spanish posting gives English prose around Spanish requirement lines.
Measured: prose in English on the Spanish posting in 3 of 3 runs (the M8-C
code, 0 of 3). The sentences code writes (`lib/ai/analysisWording.ts`) are
English; the Spanish set stays for when the user picks the analysis
language.

Since M8-E the language is also checked in code: every prose field of 60
characters or more (notes, descriptions, advice; never quotes, requirement
lines or role labels) is read with a function-word count
(`proseLanguage`, which ignores accents so English prose quoting
"Asociación" stays English). If any field reads as Spanish, the model is
asked once more with one extra line ("Your previous answer was not written
in English…"), recorded as `language / regenerated`; if that call fails,
the first answer stands. The interview debrief gets the same check and
retry. A retry is a second paid call and up to 30 s more (45 s for a
debrief), so the upload route's `maxDuration` is 100 s (with the 20 s
repair) and the feedback page's and the ElevenLabs webhook's 105 s.

## Certifications

The analysis recommends no certifications (owner decision, M8-D: the model
named ones that do not exist, "Ruby on Rails Certified Developer", and
recommended AWS for postings that never mention it). The field is gone
from the prompt, the schema and the page; `educationAndCertifications`
still reads the certifications the CV has. A stored row that carries
`recommendedCerts` parses and the field is dropped on read.

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
leave them out. Under each requirement it lists every key term with ✓ or ✗
and the CV word when it differs ("PostgreSQL ✓ (Postgres)"), alternatives
joined by "or" ("C# ✓ or Python ✗") and the rest by "·"; the posting's
examples go on a line of their own after "e.g." ("e.g. Kafka ✗ · SQS ✓"),
where they cannot read as the requirement (M8-H). A row under "Not shown in
your CV" lists no terms: no CV can show those, and "English ✓" there
contradicted the group (M8-H); its note stays. Quotes are shown without a
leading bullet marker; the stored quote stays verbatim.


The interviewer gets `not_evident` items as `{{requirements_not_evident}}`,
a list apart from the gaps that the agent may ask about once the gaps are
covered. The interview feedback prompt, when the analysis has any, says
that what the candidate says about one is evidence for it.

## Analyses stored before these fields

`sourceQuote`, `section`, `assessable`, `keyTerms`, `evidenceSource`,
`skillsOnly` and `years` are optional in the stored schema, so older rows
parse as before; `assessable` absent reads as true. Those rows render as
before: no term list, no skills-only advice. Nothing is migrated: a row
stored before M8-D keeps its English "met" from the old "your CV is written
in English" rule, and its prose in Spanish if the posting was.

## When the provider fails

`generateJson` throws one of six typed errors, and the analysis gives the
unit back for each: `AI_UNAVAILABLE`, `AI_RATE_LIMITED` (429, with a
structured log line), `AI_BILLING` (402: the Gemini key's prepaid balance
or billing is exhausted; a log line `[CVision][ai] billing exhausted:
http=402 status=… reason=… model=…`, no content; the copy says "The
analysis service is temporarily unavailable. Nothing was charged."; 503 on
a route), `AI_MISCONFIGURED`, `AI_CONTENT_BLOCKED`, `AI_BAD_FORMAT`.

`npm run ai:doctor` makes one minimal call (a few tokens) and prints PASS
or FAIL with the outcome (ok, rate limited, billing exhausted,
misconfigured, unavailable, …), the fix, the provider, the model, the
version the response names and the build the models listing names. It
exits 1 unless the call answered.

For the interview debrief an `AI_BILLING` failure does not spend one of
its two attempts: the row goes back to `FEEDBACK_PENDING` with the attempt
given back, the lazy path tries again, and the log says `deferred: AI
billing exhausted, attempt not counted`.

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
npm run eval -- full change-s7 --confirm-cost
AI_SEED=none npm run eval -- run change-u1 --only <ids>     # and u2..u5
npm run eval -- gold control-s7 control-u1 … ; npm run eval -- gold change-s7 change-u1 …
```

What a measurement may spend is enforced in code (M8-G,
`scripts/eval/spend.ts`). Every call is priced from the tokens the API
reports (`scripts/eval/pricing.ts`: standard, Flex at half, free) and
appended to `scripts/eval/runs/spend.jsonl` (gitignored). A command prints
its estimate first (each fixture's largest past run in the ledger), refuses
to start when the estimate crosses a cap, and stops between fixtures when
the next one would: `EVAL_BUDGET_PER_RUN_USD` (default 0.50) and
`EVAL_BUDGET_PER_DAY_USD` (default 1.00, live spend on the UTC day,
whichever process spent it; point a worktree's runs at the same ledger with
`EVAL_SPEND_LEDGER`). The committed fixtures hold invented data and run on
`GOOGLE_GENERATIVE_AI_API_KEY_FREE` when it is set (the free tier, where
Google may use what it is sent; a 6 s gap between calls, and rate limits or
capacity errors retry the fixture up to three times); `fixtures.local/`
never goes there and runs on the paid key at Flex (`serviceTier: "flex"`,
half price, synchronous; `EVAL_PAID_TIER=standard` changes it). The routing
wraps `fetch` in the harness, so production requests stay byte-identical.
Each record keeps the tier it was served on, and `compare`, `stability`
and `quick --control` refuse two runs whose tiers differ for a fixture.
`full` and `run` without `--only` need `--confirm-cost`; `quick <label>
--control <label>` runs seed 7 on the two real postings and four synthetic
fixtures, and with `--replay` calls nothing and replays the control's
answers through the checkout. `npm run eval -- spend [--since <date>]`
prints the ledger by day, phase and tier (`--backfill` adds the stored runs
from before it). On 2026-11-10 the `es-posting` seed-7 analysis came back
byte-identical on standard, Flex and the free key.

`gold` reports recall, precision (inventions, over-extraction by reason,
splits, merges), kind and status accuracy (with met/missing swaps, false
"met" and not-shown items called missing), key terms named and judged
right, years determined, and evidence quoting the preferred line, synthetic
and real apart. `--by-source` locates items by their `sourceQuote` instead
of their text. A drop in recall or precision, or a false "met", is a
regression. A control runs from a git worktree of the commit it measures,
with the same fixtures copied in. The real CVs and postings stay in
`fixtures.local/`: `scripts/eval/realDataGuard.test.ts` fails `npm test`
when six consecutive words of any of their `cv.txt` or `job.txt` appear in
a tracked file, compared without accents, case or punctuation (skipped
where `fixtures.local/` does not exist), so tests use invented text. Each
record keeps the model's raw answers (`answers`) and the number of calls
(`calls`; tokens are their sum), so a change to code after the model can be
replayed over stored answers through `finishAnalysis` without a new call. A fixture with a `cv.pdf` is read the way
production reads it, through the checkout's own `pdfParse`, so a control
from an older commit extracts with its older code; text files are read with
LF line endings (a checkout with `core.autocrlf` used to send the model CR
characters production never sends). `compare` and `stability` refuse runs
captured on both sides of UTC midnight (the prompt states the date). After
an intended change of the output, capture a new seed-7 reference and point
`npm run eval -- canary` at it; the canary replays its reference's date, so
a difference means the model behind the alias moved. The reference is
`m8h-final-s7` (the `es-posting` fixture read from its PDF, which exercises
the English-only rule, the stated language levels, the years statement,
the outcome sentences, key-term relations and posting-word titles): `npm
run eval -- canary m8h-final-s7`. It was captured live on the paid standard
tier on 2026-11-10, the tier production uses, and a second call on the free
tier (`--tier free`, no cost) matched it byte for byte; the canary runs on
the tier its reference was captured on unless `--tier` says otherwise, so
by default it costs one standard call (about USD 0.014).

The alias moves within days and sometimes within hours. On 2026-11-05 the
M8-C code dropped every requirement of `long-boilerplate`, which it had
extracted the day before, and the M8-B code's interview feedback for
`not-evident-answered` differed from its own output of 2026-11-04 01:43
UTC with the same version string. A control therefore runs in the same
session as its change, never from a stored run.
