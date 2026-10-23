-- CreateEnum
CREATE TYPE "InterviewPaidBy" AS ENUM ('PERIOD', 'CREDIT', 'TRIAL');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "paidBy" "InterviewPaidBy";

