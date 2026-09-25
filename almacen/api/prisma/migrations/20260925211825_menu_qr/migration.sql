-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "menu" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tab" ADD COLUMN     "billAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MenuTable" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "table" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MenuTable_token_key" ON "MenuTable"("token");

-- CreateIndex
CREATE UNIQUE INDEX "MenuTable_storeId_table_key" ON "MenuTable"("storeId", "table");
