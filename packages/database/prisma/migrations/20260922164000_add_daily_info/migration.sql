CREATE TABLE "daily_info" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_info_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_info_date_key" ON "daily_info"("date");
