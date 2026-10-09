-- CreateEnum
CREATE TYPE "public"."BusinessType" AS ENUM ('SUPERMARKET', 'PHONES');

-- CreateEnum
CREATE TYPE "public"."DepositStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ItemCondition" AS ENUM ('NEW', 'USED', 'REFURB');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('INQUIRY', 'RESERVED', 'PAID', 'PREPARING', 'ASSIGNED', 'ON_THE_WAY', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."RepairStatus" AS ENUM ('RECEIVED', 'DIAGNOSIS', 'QUOTE_SENT', 'APPROVED', 'REJECTED', 'WAITING_PART', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SerialStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_REPAIR', 'SOLD', 'RMA', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "public"."TradeInStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."AlertType" ADD VALUE 'UNIT_AGING';
ALTER TYPE "public"."AlertType" ADD VALUE 'UNIT_CONFLICT';
ALTER TYPE "public"."AlertType" ADD VALUE 'IMEI_DUPLICATE';
ALTER TYPE "public"."AlertType" ADD VALUE 'DEPOSIT_EXPIRED';
ALTER TYPE "public"."AlertType" ADD VALUE 'REPAIR_STUCK';
ALTER TYPE "public"."AlertType" ADD VALUE 'REPAIR_NOT_PICKED';
ALTER TYPE "public"."AlertType" ADD VALUE 'COURIER_DIFF';
ALTER TYPE "public"."AlertType" ADD VALUE 'RATE_STALE';

-- AlterEnum
ALTER TYPE "public"."MovementType" ADD VALUE 'REPAIR';

-- AlterTable
ALTER TABLE "public"."CashMovement" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS',
ADD COLUMN     "refId" TEXT;

-- AlterTable
ALTER TABLE "public"."CashSession" ADD COLUMN     "countedUsd" DECIMAL(14,2),
ADD COLUMN     "differenceUsd" DECIMAL(14,2),
ADD COLUMN     "expectedUsd" DECIMAL(14,2),
ADD COLUMN     "openingUsd" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS',
ADD COLUMN     "isService" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serialized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warrantyMonths" INTEGER;

-- AlterTable
ALTER TABLE "public"."Sale" ADD COLUMN     "cashArs" DECIMAL(14,2),
ADD COLUMN     "cashUsd" DECIMAL(14,2),
ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'POS',
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "rate" DECIMAL(14,4),
ADD COLUMN     "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
ALTER COLUMN "deviceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."SaleItem" ADD COLUMN     "repairOrderId" TEXT,
ADD COLUMN     "serialItemId" TEXT,
ADD COLUMN     "warrantyUntil" DATE;

-- AlterTable
ALTER TABLE "public"."Store" ADD COLUMN     "businessType" "public"."BusinessType" NOT NULL DEFAULT 'SUPERMARKET';

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dni" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Delivery" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierId" TEXT,
    "courierName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "collectAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "collectCurrency" TEXT NOT NULL DEFAULT 'ARS',
    "collected" DECIMAL(14,2),
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "proofPhoto" TEXT,
    "receiverName" TEXT,
    "receiverDni" TEXT,
    "imeiConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "failReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Deposit" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "serialItemId" TEXT,
    "repairOrderId" TEXT,
    "orderId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "fx" DECIMAL(14,2),
    "method" TEXT NOT NULL,
    "cashSessionId" TEXT,
    "deviceId" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" "public"."DepositStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "usedSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExchangeRate" (
    "id" TEXT NOT NULL,
    "casa" TEXT NOT NULL,
    "compra" DECIMAL(14,4) NOT NULL,
    "venta" DECIMAL(14,4) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,4),
    "deliveryFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL DEFAULT 'COD',
    "codCurrency" TEXT NOT NULL DEFAULT 'ARS',
    "paidMethod" TEXT,
    "address" TEXT,
    "addressNotes" TEXT,
    "window" TEXT,
    "scheduledFor" DATE,
    "notes" TEXT,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'INQUIRY',
    "delivery" BOOLEAN NOT NULL DEFAULT true,
    "saleId" TEXT,
    "withdrawalUntil" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RepairEvent" (
    "id" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "status" "public"."RepairStatus",
    "note" TEXT,
    "userId" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RepairOrder" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "serialItemId" TEXT,
    "device" TEXT NOT NULL,
    "imei" TEXT,
    "problem" TEXT NOT NULL,
    "accessories" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lockSecret" TEXT,
    "lockType" TEXT NOT NULL DEFAULT 'NONE',
    "technicianId" TEXT,
    "promisedAt" TIMESTAMP(3),
    "status" "public"."RepairStatus" NOT NULL DEFAULT 'RECEIVED',
    "diagnosis" TEXT,
    "quote" JSONB NOT NULL DEFAULT '[]',
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "quoteTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "diagnosisFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quoteSentAt" TIMESTAMP(3),
    "quoteAnswerAt" TIMESTAMP(3),
    "quoteAnswerBy" TEXT,
    "partsCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "partsUsed" BOOLEAN NOT NULL DEFAULT false,
    "warrantyDays" INTEGER NOT NULL DEFAULT 90,
    "warrantyOfId" TEXT,
    "publicToken" TEXT NOT NULL,
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "saleId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SerialEvent" (
    "id" TEXT NOT NULL,
    "serialItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "public"."SerialStatus",
    "refId" TEXT,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SerialItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "imei1" TEXT,
    "imei2" TEXT,
    "serial" TEXT,
    "condition" "public"."ItemCondition" NOT NULL DEFAULT 'NEW',
    "grade" TEXT,
    "battery" INTEGER,
    "color" TEXT,
    "carrierLocked" BOOLEAN NOT NULL DEFAULT false,
    "accountFree" BOOLEAN,
    "includes" TEXT,
    "notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(14,2),
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "supplierWarrantyUntil" DATE,
    "status" "public"."SerialStatus" NOT NULL DEFAULT 'AVAILABLE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),
    "saleId" TEXT,
    "customerId" TEXT,
    "warrantyUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradeIn" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "model" TEXT NOT NULL,
    "imei1" TEXT NOT NULL,
    "imei2" TEXT,
    "serial" TEXT,
    "color" TEXT,
    "grade" TEXT,
    "battery" INTEGER,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "accountFree" BOOLEAN NOT NULL DEFAULT false,
    "imeiMatches" BOOLEAN NOT NULL DEFAULT false,
    "enacomResult" TEXT,
    "enacomAt" TIMESTAMP(3),
    "enacomBy" TEXT,
    "enacomPhoto" TEXT,
    "dniFront" TEXT,
    "dniBack" TEXT,
    "selfie" TEXT,
    "signature" TEXT,
    "offeredUsd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payout" TEXT NOT NULL DEFAULT 'CREDIT',
    "status" "public"."TradeInStatus" NOT NULL DEFAULT 'DRAFT',
    "usedSaleId" TEXT,
    "paidAt" TIMESTAMP(3),
    "serialItemId" TEXT,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "TradeIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradeInPrice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeInPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_storeId_dni_idx" ON "public"."Customer"("storeId" ASC, "dni" ASC);

-- CreateIndex
CREATE INDEX "Customer_storeId_name_idx" ON "public"."Customer"("storeId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "Customer_storeId_phone_idx" ON "public"."Customer"("storeId" ASC, "phone" ASC);

-- CreateIndex
CREATE INDEX "Delivery_storeId_courierId_idx" ON "public"."Delivery"("storeId" ASC, "courierId" ASC);

-- CreateIndex
CREATE INDEX "Delivery_storeId_status_idx" ON "public"."Delivery"("storeId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "Deposit_storeId_status_idx" ON "public"."Deposit"("storeId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "ExchangeRate_casa_fetchedAt_idx" ON "public"."ExchangeRate"("casa" ASC, "fetchedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_number_key" ON "public"."Order"("storeId" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "Order_storeId_status_idx" ON "public"."Order"("storeId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "RepairEvent_repairId_createdAt_idx" ON "public"."RepairEvent"("repairId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_publicToken_key" ON "public"."RepairOrder"("publicToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_storeId_number_key" ON "public"."RepairOrder"("storeId" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "RepairOrder_storeId_status_idx" ON "public"."RepairOrder"("storeId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "SerialEvent_serialItemId_createdAt_idx" ON "public"."SerialEvent"("serialItemId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SerialItem_storeId_imei1_key" ON "public"."SerialItem"("storeId" ASC, "imei1" ASC);

-- CreateIndex
CREATE INDEX "SerialItem_storeId_imei2_idx" ON "public"."SerialItem"("storeId" ASC, "imei2" ASC);

-- CreateIndex
CREATE INDEX "SerialItem_storeId_productId_idx" ON "public"."SerialItem"("storeId" ASC, "productId" ASC);

-- CreateIndex
CREATE INDEX "SerialItem_storeId_serial_idx" ON "public"."SerialItem"("storeId" ASC, "serial" ASC);

-- CreateIndex
CREATE INDEX "SerialItem_storeId_status_idx" ON "public"."SerialItem"("storeId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "SerialItem_storeId_updatedAt_idx" ON "public"."SerialItem"("storeId" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "TradeIn_storeId_createdAt_idx" ON "public"."TradeIn"("storeId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "TradeIn_storeId_imei1_idx" ON "public"."TradeIn"("storeId" ASC, "imei1" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TradeIn_storeId_number_key" ON "public"."TradeIn"("storeId" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TradeInPrice_productId_grade_key" ON "public"."TradeInPrice"("productId" ASC, "grade" ASC);

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Delivery" ADD CONSTRAINT "Delivery_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deposit" ADD CONSTRAINT "Deposit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Deposit" ADD CONSTRAINT "Deposit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RepairEvent" ADD CONSTRAINT "RepairEvent_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "public"."RepairOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RepairOrder" ADD CONSTRAINT "RepairOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RepairOrder" ADD CONSTRAINT "RepairOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerialEvent" ADD CONSTRAINT "SerialEvent_serialItemId_fkey" FOREIGN KEY ("serialItemId") REFERENCES "public"."SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerialItem" ADD CONSTRAINT "SerialItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerialItem" ADD CONSTRAINT "SerialItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SerialItem" ADD CONSTRAINT "SerialItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeIn" ADD CONSTRAINT "TradeIn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeIn" ADD CONSTRAINT "TradeIn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeInPrice" ADD CONSTRAINT "TradeInPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeInPrice" ADD CONSTRAINT "TradeInPrice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

