-- The interview's spoken language, the calls it is made of, and the resume window.
ALTER TABLE "Interview" ADD COLUMN "language" TEXT;
ALTER TABLE "Interview" ADD COLUMN "segments" JSONB;
ALTER TABLE "Interview" ADD COLUMN "resumableUntil" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "finishRequestedAt" TIMESTAMP(3);
