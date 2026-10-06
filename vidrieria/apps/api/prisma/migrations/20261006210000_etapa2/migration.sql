-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('INICIAL', 'PROFESIONAL', 'COMPLETO');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ORDERED', 'MAKING', 'RECEIVED', 'SCHEDULED', 'INSTALLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayKind" AS ENUM ('SENA', 'SALDO', 'OTRO');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'MERCADOPAGO', 'DEBITO', 'CREDITO', 'CHEQUE', 'ECHEQ', 'OTRO');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('CARTERA', 'DEPOSITADO', 'COBRADO', 'ENDOSADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('ALQUILER', 'SUELDOS', 'LUZ', 'VEHICULO', 'COMBUSTIBLE', 'IMPUESTOS', 'CONTADOR', 'MANTENIMIENTO', 'MATERIAL', 'OTRO');

-- CreateEnum
CREATE TYPE "BreakWhere" AS ENUM ('TALLER', 'TRASLADO', 'OBRA', 'POSTVENTA');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEB', 'GOOGLE', 'INSTAGRAM', 'CARTEL', 'RECOMENDACION', 'WHATSAPP', 'OTRO');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "arcaCert" TEXT,
ADD COLUMN     "arcaCuit" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "arcaKey" TEXT,
ADD COLUMN     "arcaProduction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "arcaPtoVta" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "glassDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "installmentRates" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "monotributoCap" DECIMAL(16,2),
ADD COLUMN     "monotributoCategory" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mpAccessToken" TEXT,
ADD COLUMN     "payFees" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'COMPLETO',
ADD COLUMN     "priceTestPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "referralBenefit" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stormMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stormUntil" TIMESTAMP(3),
ADD COLUMN     "temperDays" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "warrantyMonths" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "stockMin" DECIMAL(14,3),
ADD COLUMN     "stockQty" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "source" "LeadSource";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "refCode" TEXT,
ADD COLUMN     "signId" TEXT,
ADD COLUMN     "source" "LeadSource" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "insurance" JSONB,
ADD COLUMN     "priceVariant" TEXT,
ADD COLUMN     "renderUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "safetyAckAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "members" TEXT NOT NULL DEFAULT '',
    "dayRate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#1d4ed8',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "address" TEXT NOT NULL DEFAULT '',
    "needsFactory" BOOLEAN NOT NULL DEFAULT false,
    "orderedAt" TIMESTAMP(3),
    "promisedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "crewId" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "beforeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "afterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "installNotes" TEXT NOT NULL DEFAULT '',
    "crewToken" TEXT NOT NULL,
    "warrantyToken" TEXT NOT NULL,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 12,
    "confirmSentAt" TIMESTAMP(3),
    "reviewSentAt" TIMESTAMP(3),
    "check30SentAt" TIMESTAMP(3),
    "maint6SentAt" TIMESTAMP(3),
    "maint12SentAt" TIMESTAMP(3),
    "stockUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breakage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "jobId" TEXT,
    "where" "BreakWhere" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "responsible" TEXT NOT NULL DEFAULT '',
    "reordered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Breakage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remnant" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "glassName" TEXT NOT NULL,
    "thicknessMm" DECIMAL(6,2),
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "photoId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "usedAt" TIMESTAMP(3),
    "usedQuoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Remnant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "quoteId" TEXT,
    "customerId" TEXT,
    "kind" "PayKind" NOT NULL DEFAULT 'OTRO',
    "method" "PayMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "feePct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',
    "chequeBank" TEXT,
    "chequeNumber" TEXT,
    "chequeDueAt" TIMESTAMP(3),
    "chequeStatus" "ChequeStatus",
    "mpPaymentId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkDay" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "crewId" TEXT,
    "worker" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "advance" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "quoteId" TEXT,
    "paymentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'C',
    "ptoVta" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "cae" TEXT,
    "caeDue" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "docType" INTEGER NOT NULL DEFAULT 99,
    "docNumber" TEXT NOT NULL DEFAULT '0',
    "customerName" TEXT NOT NULL DEFAULT '',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "glasses" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "visits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Render" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "quoteId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "resultUrl" TEXT,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Render_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Crew_businessId_idx" ON "Crew"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_quoteId_key" ON "Job"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_crewToken_key" ON "Job"("crewToken");

-- CreateIndex
CREATE UNIQUE INDEX "Job_warrantyToken_key" ON "Job"("warrantyToken");

-- CreateIndex
CREATE INDEX "Job_businessId_status_idx" ON "Job"("businessId", "status");

-- CreateIndex
CREATE INDEX "Job_businessId_scheduledAt_idx" ON "Job"("businessId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Breakage_businessId_idx" ON "Breakage"("businessId");

-- CreateIndex
CREATE INDEX "Remnant_businessId_usedAt_idx" ON "Remnant"("businessId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mpPaymentId_key" ON "Payment"("mpPaymentId");

-- CreateIndex
CREATE INDEX "Payment_businessId_date_idx" ON "Payment"("businessId", "date");

-- CreateIndex
CREATE INDEX "Expense_businessId_date_idx" ON "Expense"("businessId", "date");

-- CreateIndex
CREATE INDEX "WorkDay_businessId_date_idx" ON "WorkDay"("businessId", "date");

-- CreateIndex
CREATE INDEX "Invoice_businessId_date_idx" ON "Invoice"("businessId", "date");

-- CreateIndex
CREATE INDEX "Building_businessId_idx" ON "Building"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Sign_code_key" ON "Sign"("code");

-- CreateIndex
CREATE INDEX "Sign_businessId_idx" ON "Sign"("businessId");

-- CreateIndex
CREATE INDEX "Render_businessId_createdAt_idx" ON "Render"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakage" ADD CONSTRAINT "Breakage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakage" ADD CONSTRAINT "Breakage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remnant" ADD CONSTRAINT "Remnant_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sign" ADD CONSTRAINT "Sign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Render" ADD CONSTRAINT "Render_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

