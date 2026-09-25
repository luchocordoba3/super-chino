-- CreateTable
CREATE TABLE "FiscalConfig" (
    "storeId" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "address" TEXT,
    "taxStatus" TEXT NOT NULL,
    "pointOfSale" INTEGER NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "production" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "certPem" TEXT NOT NULL,
    "keyPem" TEXT NOT NULL,
    "wsaaToken" TEXT,
    "wsaaSign" TEXT,
    "wsaaExpires" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalConfig_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "pointOfSale" INTEGER NOT NULL,
    "number" INTEGER,
    "docType" INTEGER NOT NULL,
    "docNumber" TEXT NOT NULL,
    "customerName" TEXT,
    "customerVat" INTEGER NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2) NOT NULL,
    "cae" TEXT,
    "caeDue" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_saleId_key" ON "Invoice"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_publicToken_key" ON "Invoice"("publicToken");

-- CreateIndex
CREATE INDEX "Invoice_storeId_status_idx" ON "Invoice"("storeId", "status");

