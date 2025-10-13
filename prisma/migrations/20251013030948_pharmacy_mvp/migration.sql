/*
  Warnings:

  - The primary key for the `ServiceCatalog` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "public"."InvoiceItem" DROP CONSTRAINT "InvoiceItem_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabOrder" DROP CONSTRAINT "LabOrder_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabOrder" DROP CONSTRAINT "LabOrder_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabOrder" DROP CONSTRAINT "LabOrder_visitId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabOrderItem" DROP CONSTRAINT "LabOrderItem_labOrderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabResult" DROP CONSTRAINT "LabResult_labOrderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabResult" DROP CONSTRAINT "LabResult_labOrderItemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabResult" DROP CONSTRAINT "LabResult_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."LabResult" DROP CONSTRAINT "LabResult_resultedBy_fkey";

-- DropForeignKey
ALTER TABLE "public"."PaymentAllocation" DROP CONSTRAINT "PaymentAllocation_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PriceList" DROP CONSTRAINT "PriceList_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Problem" DROP CONSTRAINT "Problem_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "public"."Problem" DROP CONSTRAINT "Problem_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Vitals" DROP CONSTRAINT "Vitals_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Vitals" DROP CONSTRAINT "Vitals_recordedBy_fkey";

-- DropForeignKey
ALTER TABLE "public"."Vitals" DROP CONSTRAINT "Vitals_visitId_fkey";

-- DropIndex
DROP INDEX "public"."Patient_contact_trgm_idx";

-- DropIndex
DROP INDEX "public"."Patient_name_trgm_idx";

-- AlterTable
ALTER TABLE "public"."Appointment" ALTER COLUMN "appointmentId" DROP DEFAULT,
ALTER COLUMN "date" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."AuthAudit" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "ts" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Diagnosis" ALTER COLUMN "diagId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Dispense" ALTER COLUMN "dispenseId" DROP DEFAULT,
ALTER COLUMN "dispensedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."DispenseItem" ALTER COLUMN "dispenseItemId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Doctor" ALTER COLUMN "doctorId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."DoctorAvailability" ALTER COLUMN "availabilityId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."DoctorBlackout" ALTER COLUMN "blackoutId" DROP DEFAULT,
ALTER COLUMN "startAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Drug" ALTER COLUMN "drugId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Invoice" ALTER COLUMN "invoiceId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."InvoiceItem" ALTER COLUMN "itemId" DROP DEFAULT,
ALTER COLUMN "serviceId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."LabOrder" ALTER COLUMN "labOrderId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."LabOrderItem" ALTER COLUMN "labOrderItemId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."LabResult" ALTER COLUMN "labResultId" DROP DEFAULT,
ALTER COLUMN "resultedBy" SET DATA TYPE TEXT,
ALTER COLUMN "resultedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Medication" ALTER COLUMN "medId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Observation" ALTER COLUMN "obsId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."PasswordResetToken" ALTER COLUMN "tokenId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Patient" ALTER COLUMN "patientId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Payment" ALTER COLUMN "paymentId" DROP DEFAULT,
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."PaymentAllocation" ALTER COLUMN "allocationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Prescription" ALTER COLUMN "prescriptionId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."PrescriptionItem" ALTER COLUMN "itemId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."PriceList" ALTER COLUMN "priceId" DROP DEFAULT,
ALTER COLUMN "serviceId" SET DATA TYPE TEXT,
ALTER COLUMN "effectiveFrom" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Problem" ALTER COLUMN "problemId" DROP DEFAULT,
ALTER COLUMN "onsetDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "resolvedDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."ServiceCatalog" DROP CONSTRAINT "ServiceCatalog_pkey",
ALTER COLUMN "serviceId" DROP DEFAULT,
ALTER COLUMN "serviceId" SET DATA TYPE TEXT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "ServiceCatalog_pkey" PRIMARY KEY ("serviceId");

-- AlterTable
ALTER TABLE "public"."Session" ALTER COLUMN "sessionId" DROP DEFAULT,
ALTER COLUMN "issuedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."StockItem" ALTER COLUMN "stockItemId" DROP DEFAULT,
ALTER COLUMN "expiryDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."User" ALTER COLUMN "userId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Visit" ALTER COLUMN "visitId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."VisitLabResult" ALTER COLUMN "labId" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Vitals" ALTER COLUMN "vitalsId" DROP DEFAULT,
ALTER COLUMN "recordedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "public"."PriceList" ADD CONSTRAINT "PriceList_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."ServiceCatalog"("serviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvoiceItem" ADD CONSTRAINT "InvoiceItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."ServiceCatalog"("serviceId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LabOrderItem" ADD CONSTRAINT "LabOrderItem_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "public"."LabOrder"("labOrderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LabResult" ADD CONSTRAINT "LabResult_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "public"."LabOrder"("labOrderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LabResult" ADD CONSTRAINT "LabResult_labOrderItemId_fkey" FOREIGN KEY ("labOrderItemId") REFERENCES "public"."LabOrderItem"("labOrderItemId") ON DELETE CASCADE ON UPDATE CASCADE;
