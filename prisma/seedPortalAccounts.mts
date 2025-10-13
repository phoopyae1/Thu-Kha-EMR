import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding patient portal accounts...');

  // Get first 5 patients
  const patients = await prisma.patient.findMany({
    take: 5,
    select: { patientId: true, name: true },
  });

  if (patients.length === 0) {
    console.log('❌ No patients found. Please seed patients first.');
    return;
  }

  // Password: "password123" for all test accounts
  const passwordHash = await bcrypt.hash('password123', 10);

  const accounts = [
    { email: 'patient1@test.com', patientId: patients[0]?.patientId },
    { email: 'patient2@test.com', patientId: patients[1]?.patientId },
    { email: 'patient3@test.com', patientId: patients[2]?.patientId },
    { email: 'john.doe@test.com', patientId: patients[3]?.patientId },
    { email: 'jane.smith@test.com', patientId: patients[4]?.patientId },
  ];

  for (const account of accounts) {
    if (!account.patientId) continue;

    try {
      const patient = patients.find((p) => p.patientId === account.patientId);
      
      await prisma.patientPortalAccount.upsert({
        where: { email: account.email },
        update: {},
        create: {
          patientId: account.patientId,
          email: account.email,
          passwordHash,
          status: 'active',
        },
      });

      console.log(`✅ Created portal account for ${patient?.name}`);
      console.log(`   Email: ${account.email}`);
      console.log(`   Password: password123`);
    } catch (error) {
      console.error(`❌ Failed to create account for ${account.email}:`, error);
    }
  }

  console.log('\n📋 Test Credentials Summary:');
  console.log('================================');
  for (let i = 0; i < Math.min(patients.length, accounts.length); i++) {
    console.log(`${patients[i].name}:`);
    console.log(`  Email: ${accounts[i].email}`);
    console.log(`  Password: password123\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

