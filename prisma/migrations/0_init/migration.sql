-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FEEDBACK_PENDING', 'GENERATING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ResumeAnalysis" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "jobDescription" TEXT NOT NULL,
    "resumeKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeFeedback" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "overall" JSONB NOT NULL,
    "atsCompatibility" JSONB NOT NULL,
    "experienceAndImpact" JSONB NOT NULL,
    "skills" JSONB NOT NULL,
    "educationAndCertifications" JSONB NOT NULL,
    "toneAndClarity" JSONB NOT NULL,
    "jobFit" JSONB NOT NULL,

    CONSTRAINT "ResumeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "techstack" TEXT[],
    "userId" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT,
    "issuedConversationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "transcript" JSONB,
    "transcriptSource" TEXT,
    "issuedContext" JSONB,
    "contextMismatch" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "startCount" INTEGER NOT NULL DEFAULT 0,
    "feedbackAttempts" INTEGER NOT NULL DEFAULT 0,
    "feedbackStartedAt" TIMESTAMP(3),
    "resumeAnalysisId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewFeedback" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "report" JSONB,

    CONSTRAINT "InterviewFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeAnalysis_userId_createdAt_idx" ON "ResumeAnalysis"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeFeedback_resumeId_key" ON "ResumeFeedback"("resumeId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_conversationId_key" ON "Interview"("conversationId");

-- CreateIndex
CREATE INDEX "Interview_userId_createdAt_idx" ON "Interview"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_resumeAnalysisId_attemptNumber_key" ON "Interview"("resumeAnalysisId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewFeedback_interviewId_key" ON "InterviewFeedback"("interviewId");

-- AddForeignKey
ALTER TABLE "ResumeFeedback" ADD CONSTRAINT "ResumeFeedback_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "ResumeAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_resumeAnalysisId_fkey" FOREIGN KEY ("resumeAnalysisId") REFERENCES "ResumeAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewFeedback" ADD CONSTRAINT "InterviewFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security is not modelled by Prisma: every table enables it here
-- so a database rebuilt from these migrations matches the one that exists.
-- The app connects as the table owner, which bypasses RLS; nothing else may
-- reach these tables (no policies, Data API off).
ALTER TABLE "ResumeAnalysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResumeFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Interview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InterviewFeedback" ENABLE ROW LEVEL SECURITY;
