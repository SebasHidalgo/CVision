-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT,
    "interviewFeedbackId" TEXT,
    "locale" VARCHAR(8) NOT NULL,
    "status" "TranslationStatus" NOT NULL DEFAULT 'PENDING',
    "sourceHash" TEXT NOT NULL,
    "payload" JSONB,
    "guardStats" JSONB,
    "model" TEXT,
    "modelVersion" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_analysisId_locale_key" ON "ContentTranslation"("analysisId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_interviewFeedbackId_locale_key" ON "ContentTranslation"("interviewFeedbackId", "locale");

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ResumeAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_interviewFeedbackId_fkey" FOREIGN KEY ("interviewFeedbackId") REFERENCES "InterviewFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one parent: an analysis or an interview feedback.
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_one_parent" CHECK (num_nonnulls("analysisId", "interviewFeedbackId") = 1);

-- Prisma does not model RLS: every table gets it, with no policies.
ALTER TABLE "ContentTranslation" ENABLE ROW LEVEL SECURITY;
