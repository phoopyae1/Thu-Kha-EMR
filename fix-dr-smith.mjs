import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function fixDrSmith() {
  try {
    console.log('🔧 Fixing Dr Smith user account...\n');

    // Find Dr Smith
    const drSmith = await prisma.doctor.findFirst({
      where: { name: { contains: 'Smith', mode: 'insensitive' } }
    });

    if (!drSmith) {
      console.log('❌ Dr Smith not found');
      return;
    }

    console.log(`👨‍⚕️ Found Dr Smith: ${drSmith.name} (${drSmith.doctorId})\n`);

    // Create a user account for Dr Smith
    const email = 'drsmith@example.com';
    const password = 'DoctorPass123!';
    const passwordHash = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      console.log('📝 Updating existing user account...');
      await prisma.user.update({
        where: { email },
        data: {
          doctorId: drSmith.doctorId,
          role: 'Doctor',
          status: 'active'
        }
      });
      console.log('✅ Updated existing user account');
    } else {
      console.log('📝 Creating new user account...');
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'Doctor',
          status: 'active',
          doctorId: drSmith.doctorId
        }
      });
      console.log('✅ Created new user account');
    }

    // Verify the fix
    const updatedUser = await prisma.user.findUnique({
      where: { email },
      include: { doctor: true }
    });

    console.log('\n✅ Verification:');
    console.log(`  Email: ${updatedUser.email}`);
    console.log(`  Role: ${updatedUser.role}`);
    console.log(`  Doctor ID: ${updatedUser.doctorId}`);
    console.log(`  Doctor Name: ${updatedUser.doctor?.name}`);
    console.log(`  Doctor Department: ${updatedUser.doctor?.department}`);

    // Check appointments
    const appointments = await prisma.appointment.findMany({
      where: { doctorId: drSmith.doctorId },
      include: { patient: { select: { name: true } } },
      orderBy: { date: 'asc' }
    });

    console.log(`\n📅 Dr Smith now has ${appointments.length} appointments:`);
    appointments.slice(0, 5).forEach((apt, index) => {
      console.log(`  ${index + 1}. ${apt.patient.name} - ${apt.date.toISOString().split('T')[0]} (${apt.status})`);
    });
    if (appointments.length > 5) {
      console.log(`  ... and ${appointments.length - 5} more appointments`);
    }

    console.log('\n🎉 Dr Smith can now log in and see their appointments!');
    console.log('Login credentials:');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixDrSmith();
