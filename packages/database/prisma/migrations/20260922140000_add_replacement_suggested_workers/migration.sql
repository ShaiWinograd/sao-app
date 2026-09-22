ALTER TABLE "replacement_requests"
ADD COLUMN "suggestedWorkerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
