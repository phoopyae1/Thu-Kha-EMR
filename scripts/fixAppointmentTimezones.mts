#!/usr/bin/env tsx

/**
 * Fix Appointment Timezones
 * 
 * This script fixes appointments that were created with local timezone
 * and converts them to UTC for consistency with the queue filtering.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixAppointmentTimezones() {
  console.log('🔍 Finding appointments with timezone issues...\n');

  try {
    // Get all appointments
    const appointments = await prisma.appointment.findMany({
      select: {
        appointmentId: true,
        date: true,
        startTimeMin: true,
        endTimeMin: true,
        patient: { select: { name: true } },
        doctor: { select: { name: true } },
        status: true,
      },
      orderBy: { date: 'desc' },
    });

    console.log(`Found ${appointments.length} total appointments\n`);

    let fixedCount = 0;

    for (const apt of appointments) {
      const currentDate = apt.date;
      
      // Check if the date has a non-zero time component (indicates local timezone issue)
      const hours = currentDate.getUTCHours();
      const minutes = currentDate.getUTCMinutes();
      const seconds = currentDate.getUTCSeconds();
      
      if (hours !== 0 || minutes !== 0 || seconds !== 0) {
        // This appointment has timezone issues - fix it
        const dateStr = currentDate.toISOString().slice(0, 10); // Get YYYY-MM-DD
        const fixedDate = new Date(`${dateStr}T00:00:00Z`); // Create UTC date at midnight
        
        console.log(`📝 Fixing appointment:`);
        console.log(`   Patient: ${apt.patient.name}`);
        console.log(`   Doctor: ${apt.doctor.name}`);
        console.log(`   Old date: ${currentDate.toISOString()}`);
        console.log(`   New date: ${fixedDate.toISOString()}`);
        console.log(`   Status: ${apt.status}\n`);
        
        await prisma.appointment.update({
          where: { appointmentId: apt.appointmentId },
          data: { date: fixedDate },
        });
        
        fixedCount++;
      }
    }

    console.log(`\n✅ Fixed ${fixedCount} appointments with timezone issues`);
    console.log(`✅ ${appointments.length - fixedCount} appointments were already correct\n`);

  } catch (error) {
    console.error('❌ Error fixing appointments:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixAppointmentTimezones()
  .then(() => {
    console.log('✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });

