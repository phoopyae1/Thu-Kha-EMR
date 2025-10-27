import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getUserId() {
  try {
    console.log('🔍 Getting user ID for drsmith@example.com...\n');

    const user = await prisma.user.findUnique({
      where: { email: 'drsmith@example.com' },
      select: { userId: true, email: true, role: true }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('✅ User found:');
    console.log(`  Email: ${user.email}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  User ID: ${user.userId}\n`);

    console.log('🔗 Correct URL format:');
    console.log(`http://localhost:5174/admin/${user.userId}/appointments/112f912a-8ddf-4086-9e7a-a9f722e366e5\n`);

    console.log('📝 Steps to access the appointment:');
    console.log('1. Go to: http://localhost:5174/admin/login');
    console.log('2. Login with: drsmith@example.com / DoctorPass123!');
    console.log('3. You will be redirected to the dashboard');
    console.log('4. Navigate to Appointments from the sidebar');
    console.log('5. Click on the appointment you want to view');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getUserId();
