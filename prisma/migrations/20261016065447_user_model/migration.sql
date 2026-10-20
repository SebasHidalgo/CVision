-- DropForeignKey
ALTER TABLE "public"."Interview" DROP CONSTRAINT "Interview_resumeAnalysisId_fkey";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Row-level security, like every table (see 0_init).
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

-- Backfill (by hand): one User row per account that already has rows, so the
-- foreign keys below can be added over the existing data. Ids are Clerk's.
INSERT INTO "User" ("id", "createdAt", "updatedAt")
SELECT DISTINCT "userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT "userId" FROM "ResumeAnalysis"
    UNION
    SELECT "userId" FROM "Interview"
) AS existing
ON CONFLICT ("id") DO NOTHING;

-- AddForeignKey
ALTER TABLE "ResumeAnalysis" ADD CONSTRAINT "ResumeAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (was ON DELETE SET NULL: an analysis now takes its rehearsals with it)
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_resumeAnalysisId_fkey" FOREIGN KEY ("resumeAnalysisId") REFERENCES "ResumeAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
