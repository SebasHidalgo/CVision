-- The daily sweep reads only analysis units still held; this index holds only those rows.
-- Deploy with the code that settles units (settledAt): together, never apart.
CREATE INDEX "UsageEvent_held_analysis" ON "UsageEvent" ("createdAt") WHERE "kind" = 'ANALYSIS' AND "refundedAt" IS NULL AND "settledAt" IS NULL;
