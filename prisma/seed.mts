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

async function main() {
  // Import and execute the legacy seed
  const { execSync } = await import('child_process');
  execSync('tsx prisma/seed.mjs', { stdio: 'inherit' });
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
