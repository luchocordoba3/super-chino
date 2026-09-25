-- CreateTable
CREATE TABLE "MpAccount" (
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "mpStoreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MpAccount_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "MpPos" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "table" INTEGER,
    "externalId" TEXT NOT NULL,
    "mpPosId" TEXT NOT NULL,
    "qrImage" TEXT NOT NULL,

    CONSTRAINT "MpPos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpCharge" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT,
    "posExternalId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpPos_externalId_key" ON "MpPos"("externalId");

-- CreateIndex
CREATE INDEX "MpPos_storeId_idx" ON "MpPos"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "MpCharge_orderId_key" ON "MpCharge"("orderId");

-- CreateIndex
CREATE INDEX "MpCharge_storeId_createdAt_idx" ON "MpCharge"("storeId", "createdAt");
