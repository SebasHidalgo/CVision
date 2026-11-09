# Gold requirement lists: the rules

A gold file (`<fixture>/gold.json`) is the list of requirements a careful
reader finds in that fixture's `job.txt`, written before and without
looking at any model output. The harness scores every extraction against
it (`npm run eval -- gold <label> …`). These rules say what counts as a
requirement, how many there are, and how the file is written. When a
posting is ambiguous, the rule decides; when no rule decides, the gold
says so in `why` and the item is marked `"contested": true`, which the
report counts separately.

## What is a requirement

1. **A requirement is something the posting asks the candidate to have or
   be able to do.** Years of experience, a skill, a tool, a domain, a
   degree, a language, a certification, a clearance and a soft skill the
   posting states as a demand ("you communicate clearly with
   non-technical partners") are all requirements. Location, hybrid days,
   hours and on-call rotations are conditions of the job, not
   qualifications of the candidate, unless the posting phrases them as a
   demand on the candidate ("must be based in Berlin", "willing to join
   the on-call rotation"); then they are `required`.
2. **Responsibilities are not requirements** ("you will build dashboards")
   unless the sentence demands a capability the posting states nowhere
   else. "You will design Kafka pipelines in Go, so you have shipped both
   in production" demands Go and Kafka. "You will build and maintain
   dashboards" does not demand a tool. The test: would a reader who only
   had this sentence conclude the candidate must already have X? If yes,
   it is a requirement sourced from that sentence; the gold names the
   span and says `"hidden": true`.
3. **Benefits, compensation, company description, process ("how we
   hire"), legal text (EEO, visa, background check boilerplate) are not
   requirements.** Exception: a condition the candidate must meet to be
   hired (a background check they must pass, a work authorization they
   must hold, a location they must be in) is a requirement of kind
   `required`, because the candidate either satisfies it or does not.
4. **The posting's own framing decides `kind`.** Items under "required",
   "minimum", "must have", "what we are looking for", "requirements" or
   an equivalent heading, and demands in prose stated with "must",
   "required", "need", "essential", are `required`. Items under "nice to
   have", "preferred", "bonus", "plus", "desirable", "ideally", "would be
   great", or an equivalent heading or wording, are `preferred`. A
   section without a heading is classified by its wording ("It would be
   great if you also…" is preferred). A posting that lists everything
   under one heading with no preference words is all `required`.
5. **A clause that softens one item inside a required bullet makes that
   clause preferred.** "3+ years as an analyst, ideally in e-commerce" is
   one required item (3+ years as an analyst) plus one preferred item
   (e-commerce). "Experience with a BI tool, preferably Power BI" is one
   required item (a BI tool) plus one preferred item (Power BI). "Fluent
   English; another European language is a plus" is required English plus
   preferred second language.

## How many requirements a sentence holds

6. **Alternatives are one requirement.** "Go, Java or Kotlin", "AWS or
   GCP", "a degree or equivalent experience", "Next.js or another SSR
   framework", "Jest or Vitest", "including, but not limited to, Java,
   C or Python": each is one requirement that any one alternative
   satisfies. The gold name lists the alternatives; a model that emits
   one item per alternative has made a split.
7. **An equivalence clause is part of its requirement.** "Bachelor's
   degree in CS or equivalent experience" is one requirement; "or
   equivalent" is a second way to satisfy it, not a second item and not a
   preferred one.
8. **One bullet is one requirement, and a bullet that joins two
   different capabilities is one requirement that may be split.** "Strong
   SQL; experience with a cloud warehouse such as BigQuery or Snowflake"
   is one gold item marked `"splitAllowed": true` with `"alsoAcceptedAs"`
   listing its parts ("Strong SQL", "a cloud warehouse such as BigQuery
   or Snowflake"). An extraction that returns the bullet as one item
   matches it; one that returns the parts as separate items matches each
   part to it and is scored as a match, not as a split. "Hands-on
   experience with relational databases and SQL" names one capability
   twice and is one item with no parts. The test for marking parts is
   whether a candidate could plausibly have one without the other and
   the posting would care.
9. **"A and B" where the posting treats the pair as a unit is one
   requirement** that needs both ("React and TypeScript", "written and
   spoken English", "Kubernetes on AWS or GCP, and infrastructure as code
   (Terraform)" is one item for Kubernetes-on-a-cloud and one for IaC
   because they are two different capabilities under rule 8).
10. **A requirement restated elsewhere is one requirement.** The closing
    paragraph that repeats "we cannot consider candidates without Python"
    is a second span of the same item, not a new item. The gold lists
    both spans.
11. **Years of experience attached to a skill are part of that skill's
    item** ("3+ years writing production Python" is one item). Years
    attached to the role as a whole ("5+ years of backend engineering")
    are their own item.
12. **Examples inside parentheses are not separate requirements.**
    "Observability tooling (Prometheus, Grafana, OpenTelemetry)" is one
    item; the tools are examples of the capability.

## What a CV can show

13. **Some requirements a CV can state but never demonstrate.** An
    attitude ("comfortable saying no to senior stakeholders", "a clear
    appetite to learn it fast"), a soft skill stated as a trait judged by
    its manner ("you write crisply", "you explain trade-offs clearly"),
    availability or willingness phrased as a demand ("willing to
    travel"), and a hiring condition (work authorization, a background
    check, a security screening) are requirements under rules 1 and 3,
    and carry `"assessable": false`. Their expected `status` is
    `not_evident` (the UI's "Not shown in your CV"), never `missing`: the
    candidate may well satisfy them. They are `met` when the CV states
    them in words that can be quoted ("Irish citizen" for a work
    authorization). Past experience of an activity is assessable ("experience
    being on call for a production service"). Alternatives where one is
    assessable and another is not ("GraphQL schema design, or a clear
    appetite to learn it fast") are `assessable: false`: `met` when the CV
    shows the assessable alternative, `not_evident` otherwise. When both
    `met` and `not_evident` are defensible for this CV, `status` holds one
    and `statusAlso` the other.

14. **Years are counted the way the analysis counts them (M8-C).** The
    posting's minimum is the lower bound of what it states ("5+", "3-5",
    "at least 3", "al menos 4", "two or more"). The CV's years are what it
    states in words ("2+ years of experience", "cuatro años") when it
    states them; otherwise the sum of the dated roles that are relevant to
    the requirement, overlapping months counted once. The status follows:
    `met` at or above the minimum, `partial` from 75% of it, `missing`
    below. A CV with nothing relevant has 0.
15. **An alternative no CV can show makes the item `assessable: false`
    (rule 13) and is marked `"unshowableAlternative": true`** ("or
    willingness to learn it on the job", "or a clear appetite to learn
    it fast", "o disposición para aprenderlo"). An equivalence ("or
    equivalent practical experience") is not one: a CV shows experience.

16. **A language level counts only when the CV states it (owner
    decision, M8-D).** A requirement for a level of a language ("fluent
    English", "inglés profesional", "Portugués") is `met` when the CV
    states a level for it (C1, native, fluent, "professional working
    proficiency", a test score) and the level answers the demand, and
    `not_evident` when it states none, even though a level is assessable:
    a CV written in English does not show the candidate's English. This is
    the one `not_evident` without `assessable: false`.

## How the file is written

```json
{
  "fixture": "mid-meets-required",
  "status": "final",
  "requirements": [
    {
      "id": "r1",
      "kind": "required",
      "name": "3+ years of professional backend development",
      "spans": ["3+ years of professional backend development experience."],
      "aliases": ["backend experience", "years of backend"],
      "status": "met",
      "why": "five years, two backend roles"
    }
  ],
  "notRequirements": [
    { "span": "We offer remote work within EMEA", "reason": "benefit" }
  ]
}
```

- `status` of the file: `final` for synthetic postings (the gold is
  ours) and `draft` for real postings until the owner approves the table
  in `fixtures.local/gold-review.md`. The report keeps draft metrics
  apart.
- `spans`: verbatim substrings of `job.txt`, whitespace-insensitive but
  otherwise character-exact. The loader refuses a span it cannot find.
  One span per place the posting states the item (rule 10).
- `name`: a short normalized description, the fallback matcher's input.
  Keep every alternative's proper noun in it ("Go, Java or Kotlin in
  production") and nothing else; the fallback matcher looks for the
  name's content words in the extracted text.
- `aliases`: optional, other short phrasings a correct extraction might
  use, for the fallback matcher.
- `status`, per requirement, only when the fixture's CV decides it
  without judgement: `met` when the CV plainly has it, `missing` when it
  plainly has nothing for it, `partial` when the CV has part of a
  conjunction (rule 9) or an adjacent thing the posting would not accept
  as the thing asked for, `not_evident` for an `assessable: false` item
  the CV does not state (rule 13). Omit it when a reasonable reader could
  go either way; the status metric only counts gold items that carry one.
- `statusAlso`: optional, other statuses that are equally right for this
  CV (rule 13); the status metric accepts any of them. Never `missing`
  beside `met`: that is the swap the metric exists to catch.
- `assessable`: `false` for the items of rule 13; absent means `true`.
- `contested`, `hidden`, `splitAllowed`, `alsoAcceptedAs`: see the rules
  above.
- `keyTerms` (M8-C): optional, `{ "mode": "all" | "any", "terms": [{
  "term", "present" }] }`, the technologies, tools, domains,
  certifications or languages the item names and whether this CV shows
  each. Scored against the analysis' own key terms: named, and judged
  present or absent correctly. Annotated where a term decides the status.
- `years` (M8-C): `{ "min", "cv" }` for an item that asks for a number of
  years, counted under rule 14.
- `preferredEvidence` (M8-C): optional, the start of the CV line a careful
  reader quotes for it: an experience or project bullet over the skills
  list.
- `unshowableAlternative` (M8-C): rule 15.
- `notRequirements`: optional, the spans a model is most likely to
  over-extract (benefits, responsibilities that name tools, boilerplate),
  each with its reason. The matcher uses them to classify an unmatched
  extraction as "over-extraction from a non-requirement" rather than
  "invention".
