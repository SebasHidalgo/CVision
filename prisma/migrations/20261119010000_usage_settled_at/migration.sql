-- When an analysis unit was spent for good: set right before the analysis row it pays for is saved.
-- A held unit (settledAt null) whose request died before saving is given back by the sweep; a settled one never is.
ALTER TABLE "UsageEvent" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- Every analysis unit from before is taken as spent: without the column, a unit whose analysis was deleted
-- cannot be told from one whose request died, and the sweep must never give back the first.
UPDATE "UsageEvent" SET "settledAt" = "createdAt" WHERE "kind" = 'ANALYSIS' AND "refundedAt" IS NULL;
