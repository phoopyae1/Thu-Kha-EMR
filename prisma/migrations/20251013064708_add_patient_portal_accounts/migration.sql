-- CreateEnum
CREATE TYPE "public"."FacilityType" AS ENUM ('HOSPITAL', 'GP_CLINIC', 'DIAGNOSTIC_CENTER');

-- CreateTable
CREATE TABLE "public"."Facility" (
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."FacilityType" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("facilityId")
);

-- CreateTable
CREATE TABLE "public"."ImmunizationRecord" (
    "immunizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "vaccineName" TEXT NOT NULL,
    "administeredAt" DATE NOT NULL,
    "provider" TEXT,
    "lotNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImmunizationRecord_pkey" PRIMARY KEY ("immunizationId")
);

-- CreateTable
CREATE TABLE "public"."RadiologyReport" (
    "reportId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "visitId" UUID,
    "modality" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "impression" TEXT NOT NULL,
    "findings" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadiologyReport_pkey" PRIMARY KEY ("reportId")
);

-- CreateTable
CREATE TABLE "public"."PatientPortalAccount" (
    "accountId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPortalAccount_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "ImmunizationRecord_patientId_administeredAt_idx" ON "public"."ImmunizationRecord"("patientId", "administeredAt" DESC);

-- CreateIndex
CREATE INDEX "RadiologyReport_patientId_reportDate_idx" ON "public"."RadiologyReport"("patientId", "reportDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PatientPortalAccount_patientId_key" ON "public"."PatientPortalAccount"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPortalAccount_email_key" ON "public"."PatientPortalAccount"("email");

-- AddForeignKey
ALTER TABLE "public"."ImmunizationRecord" ADD CONSTRAINT "ImmunizationRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("patientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RadiologyReport" ADD CONSTRAINT "RadiologyReport_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("patientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RadiologyReport" ADD CONSTRAINT "RadiologyReport_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "public"."Visit"("visitId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PatientPortalAccount" ADD CONSTRAINT "PatientPortalAccount_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("patientId") ON DELETE CASCADE ON UPDATE CASCADE;
