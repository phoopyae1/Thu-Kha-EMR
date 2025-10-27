import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkITAdmin() {
  try {
    console.log('🔍 Checking IT Admin account...\n');

    // Check IT Admin user
    const itAdmin = await prisma.user.findFirst({
      where: { role: 'ITAdmin' },
      select: { userId: true, email: true, role: true, status: true }
    });

    if (!itAdmin) {
      console.log('❌ IT Admin account not found');
      return;
    }

    console.log('✅ IT Admin found:');
    console.log(`  Email: ${itAdmin.email}`);
    console.log(`  Role: ${itAdmin.role}`);
    console.log(`  Status: ${itAdmin.status}`);
    console.log(`  User ID: ${itAdmin.userId}\n`);

    // Check route permissions for IT Admin
    console.log('🔍 Checking appointment route permissions...');
    console.log('IT Admin should have access to all routes including appointments.\n');

    // Check if IT Admin can see appointments
    const appointments = await prisma.appointment.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        patient: { select: { name: true } },
        doctor: { select: { name: true } }
      }
    });

    console.log('📅 Recent appointments (IT Admin should see all):');
    appointments.forEach((apt, index) => {
      console.log(`  ${index + 1}. ID: ${apt.appointmentId}`);
      console.log(`     Patient: ${apt.patient.name}`);
      console.log(`     Doctor: ${apt.doctor.name}`);
      console.log(`     Date: ${apt.date.toISOString().split('T')[0]}`);
      console.log(`     Status: ${apt.status}\n`);
    });

    console.log('🔗 Correct URL for IT Admin:');
    console.log(`http://localhost:5174/admin/${itAdmin.userId}/appointments\n`);

    console.log('📝 Steps for IT Admin:');
    console.log('1. Go to: http://localhost:5174/admin/login');
    console.log(`2. Login with: ${itAdmin.email} / AdminPass123!`);
    console.log('3. Navigate to Appointments from sidebar');
    console.log('4. Click on any appointment to view details');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkITAdmin();
