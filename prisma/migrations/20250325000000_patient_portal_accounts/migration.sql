CREATE TABLE "PatientPortalAccount" (
  "accountId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patientId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastLogin" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientPortalAccount_pkey" PRIMARY KEY ("accountId")
);

ALTER TABLE "PatientPortalAccount"
  ADD CONSTRAINT "PatientPortalAccount_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("patientId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PatientPortalAccount_patientId_key" ON "PatientPortalAccount" ("patientId");
CREATE UNIQUE INDEX "PatientPortalAccount_email_key" ON "PatientPortalAccount" ("email");

CREATE OR REPLACE FUNCTION set_patient_portal_account_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_patient_portal_account_updated_at
BEFORE UPDATE ON "PatientPortalAccount"
FOR EACH ROW
EXECUTE PROCEDURE set_patient_portal_account_updated_at();
