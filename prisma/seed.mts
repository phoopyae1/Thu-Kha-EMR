import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function seedPharmacyReference() {
  const drugs = await prisma.$transaction([
    prisma.drug.upsert({
      where: { drugId: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        drugId: '00000000-0000-0000-0000-000000000001',
        name: 'Amoxicillin',
        genericName: 'amoxicillin',
        form: 'tab',
        strength: '500 mg',
        routeDefault: 'PO',
      },
    }),
    prisma.drug.upsert({
      where: { drugId: '00000000-0000-0000-0000-000000000002' },
      update: {},
      create: {
        drugId: '00000000-0000-0000-0000-000000000002',
        name: 'Paracetamol',
        genericName: 'acetaminophen',
        form: 'tab',
        strength: '500 mg',
        routeDefault: 'PO',
      },
    }),
    prisma.drug.upsert({
      where: { drugId: '00000000-0000-0000-0000-000000000003' },
      update: {},
      create: {
        drugId: '00000000-0000-0000-0000-000000000003',
        name: 'Ibuprofen',
        genericName: 'ibuprofen',
        form: 'tab',
        strength: '200 mg',
        routeDefault: 'PO',
      },
    }),
  ]);

  for (const drug of drugs) {
    await prisma.stockItem.create({
      data: {
        drugId: drug.drugId,
        batchNo: `BATCH-${drug.drugId.slice(-4)}`,
        expiryDate: new Date('2026-12-31'),
        location: 'COUNTER_A',
        qtyOnHand: 200,
        unitCost: 100.0,
      },
    });
  }

  console.log('✅ Seeded drugs + stock');
}

async function seedLabCatalog() {
  const entries: Array<Prisma.LabCatalogUpsertArgs> = [
    {
      where: { testCode: 'CBC' },
      update: {},
      create: {
        testCode: 'CBC',
        testName: 'Complete Blood Count',
        unit: null,
        refLow: null,
        refHigh: null,
        panel: true,
      },
    },
    {
      where: { testCode: 'HGB' },
      update: {},
      create: {
        testCode: 'HGB',
        testName: 'Hemoglobin',
        unit: 'g/dL',
        refLow: new Prisma.Decimal(12),
        refHigh: new Prisma.Decimal(17.5),
        panel: false,
      },
    },
    {
      where: { testCode: 'WBC' },
      update: {},
      create: {
        testCode: 'WBC',
        testName: 'White Blood Cell Count',
        unit: 'x10^9/L',
        refLow: new Prisma.Decimal(4),
        refHigh: new Prisma.Decimal(11),
        panel: false,
      },
    },
    {
      where: { testCode: 'PLT' },
      update: {},
      create: {
        testCode: 'PLT',
        testName: 'Platelet Count',
        unit: 'x10^9/L',
        refLow: new Prisma.Decimal(150),
        refHigh: new Prisma.Decimal(450),
        panel: false,
      },
    },
    {
      where: { testCode: 'LFT_ALT' },
      update: {},
      create: {
        testCode: 'LFT_ALT',
        testName: 'Alanine Aminotransferase (ALT)',
        unit: 'U/L',
        refLow: new Prisma.Decimal(7),
        refHigh: new Prisma.Decimal(56),
        panel: false,
      },
    },
    {
      where: { testCode: 'FBS' },
      update: {},
      create: {
        testCode: 'FBS',
        testName: 'Fasting Blood Sugar',
        unit: 'mmol/L',
        refLow: new Prisma.Decimal(3.9),
        refHigh: new Prisma.Decimal(5.5),
        panel: false,
      },
    },
  ];

  for (const entry of entries) {
    await prisma.labCatalog.upsert(entry);
  }

  console.log('✅ Seeded lab catalog');
}

async function seedFacilities() {
  const facilities = [
    {
      facilityId: '11111111-2222-4333-8444-555555555555',
      name: 'Downtown GP Clinic',
      type: 'GPClinic' as const,
      addressLine1: '12 Merchant Road',
      addressLine2: 'Lanmadaw Township',
      city: 'Yangon',
      state: 'Yangon',
      postalCode: '11181',
      phone: '+95 1 123 4567',
      email: 'frontdesk@downtownclinic.mm',
      website: 'https://downtownclinic.example',
      latitude: new Prisma.Decimal('16.779200'),
      longitude: new Prisma.Decimal('96.161500'),
    },
    {
      facilityId: '99999999-8888-7777-6666-555555555555',
      name: 'Thukha General Hospital',
      type: 'Hospital' as const,
      addressLine1: '88 University Avenue',
      addressLine2: 'Bahan Township',
      city: 'Yangon',
      state: 'Yangon',
      postalCode: '11041',
      phone: '+95 1 765 4321',
      email: 'info@thukhahospital.mm',
      website: 'https://thukhahospital.example',
      latitude: new Prisma.Decimal('16.832100'),
      longitude: new Prisma.Decimal('96.158400'),
    },
  ];

  for (const facility of facilities) {
    await prisma.facility.upsert({
      where: { facilityId: facility.facilityId },
      update: facility,
      create: facility,
    });
  }

  const gpClinic = facilities[0];
  const hospital = facilities[1];

  await prisma.doctor.updateMany({
    where: { department: { contains: 'General', mode: 'insensitive' } },
    data: { facilityId: gpClinic.facilityId },
  });

  await prisma.doctor.updateMany({
    where: { department: { in: ['Cardiology', 'Endocrinology'] } },
    data: { facilityId: hospital.facilityId },
  });

  console.log('✅ Facilities seeded');
}

async function seedPatientPortalArtifacts() {
  const patientUser = await prisma.user.findUnique({
    where: { email: 'patient@example.com' },
    select: { patientId: true },
  });

  if (!patientUser?.patientId) {
    console.warn('⚠️ Unable to locate patient portal account for enrichment');
    return;
  }

  const patientId = patientUser.patientId;
  const visit = await prisma.visit.findFirst({
    where: { patientId },
    orderBy: { visitDate: 'desc' },
  });

  await prisma.immunization.upsert({
    where: { immunizationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    update: {
      patientId,
      vaccineName: 'Influenza (Quadrivalent)',
      manufacturer: 'Sanofi',
      lotNumber: 'FLU-2025-01',
      doseNumber: 1,
      administeredAt: new Date('2025-07-15'),
      provider: 'Downtown GP Clinic',
      nextDueDate: new Date('2026-07-15'),
      notes: 'Annual flu shot administered in left deltoid.',
    },
    create: {
      immunizationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      patientId,
      vaccineName: 'Influenza (Quadrivalent)',
      manufacturer: 'Sanofi',
      lotNumber: 'FLU-2025-01',
      doseNumber: 1,
      administeredAt: new Date('2025-07-15'),
      provider: 'Downtown GP Clinic',
      nextDueDate: new Date('2026-07-15'),
      notes: 'Annual flu shot administered in left deltoid.',
    },
  });

  await prisma.radiologyReport.upsert({
    where: { reportId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' },
    update: {
      patientId,
      visitId: visit?.visitId ?? null,
      modality: 'Chest X-ray',
      bodyPart: 'Chest',
      reportText:
        'PA and lateral chest radiographs show clear lung fields with no focal consolidation. Cardiomediastinal silhouette within normal limits.',
      impressions: 'No acute cardiopulmonary process.',
      performedAt: new Date('2025-06-28T09:30:00Z'),
      radiologist: 'Dr Nay Win',
    },
    create: {
      reportId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      patientId,
      visitId: visit?.visitId ?? null,
      modality: 'Chest X-ray',
      bodyPart: 'Chest',
      reportText:
        'PA and lateral chest radiographs show clear lung fields with no focal consolidation. Cardiomediastinal silhouette within normal limits.',
      impressions: 'No acute cardiopulmonary process.',
      performedAt: new Date('2025-06-28T09:30:00Z'),
      radiologist: 'Dr Nay Win',
    },
  });

  console.log('✅ Patient portal records seeded');
}

async function main() {
  // Run legacy seed first to ensure baseline data remains available.
  await import('./seed.mjs');
  await prisma.serviceCatalog.upsert({
    where: { code: 'CONSULT_OPD' },
    update: { name: 'OPD Consultation', defaultPrice: new Prisma.Decimal(8000) },
    create: {
      code: 'CONSULT_OPD',
      name: 'OPD Consultation',
      defaultPrice: new Prisma.Decimal(8000),
    },
  });
  await prisma.serviceCatalog.upsert({
    where: { code: 'PROC_DRESSING' },
    update: { name: 'Dressing', defaultPrice: new Prisma.Decimal(5000) },
    create: {
      code: 'PROC_DRESSING',
      name: 'Dressing',
      defaultPrice: new Prisma.Decimal(5000),
    },
  });
  await prisma.serviceCatalog.upsert({
    where: { code: 'PROC_INJ' },
    update: { name: 'Injection', defaultPrice: new Prisma.Decimal(3000) },
    create: {
      code: 'PROC_INJ',
      name: 'Injection',
      defaultPrice: new Prisma.Decimal(3000),
    },
  });
  await seedPharmacyReference();
  await seedLabCatalog();
  await seedFacilities();
  await seedPatientPortalArtifacts();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
