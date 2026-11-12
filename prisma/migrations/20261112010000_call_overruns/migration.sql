-- What the latest call was allowed, and how many calls of a user ran past it.
ALTER TABLE "Interview" ADD COLUMN "callAllowedSeconds" INTEGER;
ALTER TABLE "User" ADD COLUMN "callOverruns" INTEGER NOT NULL DEFAULT 0;
