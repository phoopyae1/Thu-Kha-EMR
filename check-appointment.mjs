import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAppointment() {
  try {
    console.log('🔍 Checking appointment details...\n');

    const appointmentId = '112f912a-8ddf-4086-9e7a-a9f722e366e5';
    
    // Check if appointment exists
    const appointment = await prisma.appointment.findUnique({
      where: { appointmentId },
      include: {
        patient: { select: { name: true, patientId: true } },
        doctor: { select: { name: true, department: true } }
      }
    });

    if (!appointment) {
      console.log(`❌ Appointment ${appointmentId} not found in database`);
      
      // Show some existing appointments
      console.log('\n📅 Recent appointments in database:');
      const recentAppointments = await prisma.appointment.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { name: true } },
          doctor: { select: { name: true } }
        }
      });

      recentAppointments.forEach((apt, index) => {
        console.log(`  ${index + 1}. ID: ${apt.appointmentId}`);
        console.log(`     Patient: ${apt.patient.name}`);
        console.log(`     Doctor: ${apt.doctor.name}`);
        console.log(`     Date: ${apt.date.toISOString().split('T')[0]}`);
        console.log(`     Status: ${apt.status}\n`);
      });

      return;
    }

    console.log('✅ Appointment found:');
    console.log(`  ID: ${appointment.appointmentId}`);
    console.log(`  Patient: ${appointment.patient.name}`);
    console.log(`  Doctor: ${appointment.doctor.name}`);
    console.log(`  Department: ${appointment.doctor.department}`);
    console.log(`  Date: ${appointment.date.toISOString().split('T')[0]}`);
    console.log(`  Time: ${Math.floor(appointment.startTimeMin / 60)}:${(appointment.startTimeMin % 60).toString().padStart(2, '0')} - ${Math.floor(appointment.endTimeMin / 60)}:${(appointment.endTimeMin % 60).toString().padStart(2, '0')}`);
    console.log(`  Status: ${appointment.status}`);
    console.log(`  Reason: ${appointment.reason || 'N/A'}`);
    console.log(`  Location: ${appointment.location || 'N/A'}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAppointment();
