-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "priority_score" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "JobPosting_priority_score_idx" ON "JobPosting"("priority_score");
