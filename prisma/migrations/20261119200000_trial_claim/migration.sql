-- The trial claims a trial reservation wrote, so a refund can remove them.
ALTER TABLE "UsageEvent" ADD COLUMN "trialClaimHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- One free trial per email: a keyed hash of the normalized email and the time, no user id.
CREATE TABLE "TrialClaim" (
    "emailHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialClaim_pkey" PRIMARY KEY ("emailHash")
);

ALTER TABLE "TrialClaim" ENABLE ROW LEVEL SECURITY;
