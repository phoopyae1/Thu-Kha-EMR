import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getITAdminURL() {
  try {
    const itAdmin = await prisma.user.findFirst({
      where: { role: 'ITAdmin' },
      select: { userId: true, email: true, role: true }
    });

    if (!itAdmin) {
      console.log('❌ IT Admin not found');
      return;
    }

    console.log('✅ IT Admin found:');
    console.log(`  Email: ${itAdmin.email}`);
    console.log(`  User ID: ${itAdmin.userId}\n`);

    console.log('🔗 CORRECT URL FORMAT:');
    console.log(`http://localhost:5173/admin/${itAdmin.userId}/appointments/112f912a-8ddf-4086-9e7a-a9f722e366e5\n`);

    console.log('📝 STEPS TO ACCESS:');
    console.log('1. Go to: http://localhost:5173/admin/login');
    console.log('2. Login with: admin@example.com / AdminPass123!');
    console.log('3. You will be redirected to the dashboard');
    console.log('4. Navigate to Appointments from sidebar');
    console.log('5. Click on the appointment you want to view');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getITAdminURL();
