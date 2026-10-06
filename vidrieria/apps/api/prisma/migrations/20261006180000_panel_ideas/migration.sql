-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "dollarAlertPct" DECIMAL(6,2) NOT NULL DEFAULT 3,
ADD COLUMN     "payAlias" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payCbu" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payHolder" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "supplierName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "supplierWhatsapp" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "chosenOption" INTEGER,
ADD COLUMN     "depositPaidAt" TIMESTAMP(3),
ADD COLUMN     "depositProofId" TEXT,
ADD COLUMN     "depositReportedAt" TIMESTAMP(3),
ADD COLUMN     "lastViewedAt" TIMESTAMP(3),
ADD COLUMN     "options" JSONB,
ADD COLUMN     "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_businessId_idx" ON "PushSubscription"("businessId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

