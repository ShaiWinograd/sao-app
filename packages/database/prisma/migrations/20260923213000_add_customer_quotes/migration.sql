CREATE TYPE "CustomerIdentifierType" AS ENUM ('ISRAELI_ID', 'COMPANY_NUMBER');

ALTER TABLE "customers"
ADD COLUMN "identifierType" "CustomerIdentifierType",
ADD COLUMN "identifierNumber" TEXT;

CREATE TABLE "customer_quotes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "identifierType" "CustomerIdentifierType" NOT NULL,
    "identifierNumber" TEXT NOT NULL,
    "jobIds" TEXT[],
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_quotes_customerId_createdAt_idx"
ON "customer_quotes"("customerId", "createdAt");

ALTER TABLE "customer_quotes"
ADD CONSTRAINT "customer_quotes_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
