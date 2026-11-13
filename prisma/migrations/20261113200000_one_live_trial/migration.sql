-- One live free trial per account, whatever the isolation level of the writer.
-- A refunded trial (refundedAt set) is outside the index, so a given-back trial can be taken again.
CREATE UNIQUE INDEX "UsageEvent_one_live_trial" ON "UsageEvent" ("userId") WHERE "kind" = 'INTERVIEW_TRIAL' AND "refundedAt" IS NULL;
