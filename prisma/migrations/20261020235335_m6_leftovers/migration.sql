-- CreateEnum
CREATE TYPE "GuardKind" AS ENUM ('ANALYSIS', 'INTERVIEW');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "lastSessionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InterviewFeedback" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "GuardStatDaily" (
    "date" DATE NOT NULL,
    "kind" "GuardKind" NOT NULL,
    "check" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GuardStatDaily_pkey" PRIMARY KEY ("date","kind","check","action")
);

-- Row-level security, like every table (see 0_init).
ALTER TABLE "GuardStatDaily" ENABLE ROW LEVEL SECURITY;

-- Backfill: the latest session's time is the first one's for rows from
-- before the column (one session, or reconnects nobody dated).
UPDATE "Interview" SET "lastSessionAt" = "startedAt" WHERE "lastSessionAt" IS NULL;

-- Backfill: a feedback stored before the column is dated from the end of
-- its interview (feedback follows the call by minutes), else its creation.
UPDATE "InterviewFeedback" f
SET "createdAt" = COALESCE(i."endedAt", i."createdAt")
FROM "Interview" i
WHERE i."id" = f."interviewId";

-- Backfill of the anonymous aggregate from the per-row stats that exist:
-- one row per (day, kind, check, action) among the interventions, plus the
-- rows recorded and the rows where anything fired. Idempotent on conflict.
INSERT INTO "GuardStatDaily" ("date", "kind", "check", "action", "count")
SELECT a."createdAt"::date, 'ANALYSIS'::"GuardKind", i->>'check', i->>'action', count(*)
FROM "ResumeAnalysis" a, jsonb_array_elements(a."guardStats"->'interventions') AS i
WHERE a."guardStats" IS NOT NULL
GROUP BY 1, 2, 3, 4
ON CONFLICT ("date", "kind", "check", "action") DO UPDATE SET "count" = "GuardStatDaily"."count" + EXCLUDED."count";

INSERT INTO "GuardStatDaily" ("date", "kind", "check", "action", "count")
SELECT a."createdAt"::date, 'ANALYSIS'::"GuardKind", 'rows', 'recorded', count(*)
FROM "ResumeAnalysis" a
WHERE a."guardStats" IS NOT NULL
GROUP BY 1
ON CONFLICT ("date", "kind", "check", "action") DO UPDATE SET "count" = "GuardStatDaily"."count" + EXCLUDED."count";

INSERT INTO "GuardStatDaily" ("date", "kind", "check", "action", "count")
SELECT a."createdAt"::date, 'ANALYSIS'::"GuardKind", 'rows', 'fired', count(*)
FROM "ResumeAnalysis" a
WHERE a."guardStats" IS NOT NULL
  AND (jsonb_array_length(COALESCE(a."guardStats"->'interventions', '[]'::jsonb)) > 0
       OR EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(a."guardStats"->'counts', '{}'::jsonb)) c WHERE c.value::int > 0))
GROUP BY 1
ON CONFLICT ("date", "kind", "check", "action") DO UPDATE SET "count" = "GuardStatDaily"."count" + EXCLUDED."count";

INSERT INTO "GuardStatDaily" ("date", "kind", "check", "action", "count")
SELECT f."createdAt"::date, 'INTERVIEW'::"GuardKind", i->>'check', i->>'action', count(*)
FROM "InterviewFeedback" f, jsonb_array_elements(f."guardStats"->'interventions') AS i
WHERE f."guardStats" IS NOT NULL
GROUP BY 1, 2, 3, 4
ON CONFLICT ("date", "kind", "check", "action") DO UPDATE SET "count" = "GuardStatDaily"."count" + EXCLUDED."count";

INSERT INTO "GuardStatDaily" ("date", "kind", "check", "action", "count")
SELECT f."createdAt"::date, 'INTERVIEW'::"GuardKind", 'rows', 'recorded', count(*)
FROM "InterviewFeedback" f
WHERE f."guardStats" IS NOT NULL
GROUP BY 1
ON CONFLICT ("date", "kind", "check", "action") DO UPDATE SET "count" = "GuardStatDaily"."count" + EXCLUDED."count";

INSERT INTO "GuardStatDaily" ("date", "kind", "check", "action", "count")
SELECT f."createdAt"::date, 'INTERVIEW'::"GuardKind", 'rows', 'fired', count(*)
FROM "InterviewFeedback" f
WHERE f."guardStats" IS NOT NULL
  AND (jsonb_array_length(COALESCE(f."guardStats"->'interventions', '[]'::jsonb)) > 0
       OR EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(f."guardStats"->'counts', '{}'::jsonb)) c WHERE c.value::int > 0))
GROUP BY 1
ON CONFLICT ("date", "kind", "check", "action") DO UPDATE SET "count" = "GuardStatDaily"."count" + EXCLUDED."count";
