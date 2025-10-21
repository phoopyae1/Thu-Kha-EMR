#!/usr/bin/env tsx

/**
 * Create Today's Appointment for Testing
 * 
 * Creates an appointment for today to test the doctor queue
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTodayAppointment() {
  console.log('🔍 Creating appointment for today...\n');

  try {
    // Find Dr. Duke
    const doctor = await prisma.doctor.findFirst({
      where: { name: { contains: 'Duke', mode: 'insensitive' } }
    });
    
    if (!doctor) {
      console.log('❌ Dr. Duke not found');
      return;
    }
    
    console.log(`✅ Found Dr. ${doctor.name} (${doctor.doctorId})\n`);

    // Find patient Hein Arakar
    const patient = await prisma.patient.findFirst({
      where: { name: { contains: 'Hein', mode: 'insensitive' } }
    });
    
    if (!patient) {
      console.log('❌ Patient Hein Arakar not found');
      return;
    }
    
    console.log(`✅ Found patient ${patient.name} (${patient.patientId})\n`);

    // Create today's date at midnight UTC
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    
    console.log(`📅 Today's date (UTC): ${todayUTC.toISOString()}\n`);

    // Check if there's already an appointment today
    const existingToday = await prisma.appointment.findFirst({
      where: {
        patientId: patient.patientId,
        doctorId: doctor.doctorId,
        date: todayUTC,
        status: { not: 'Cancelled' },
      },
    });

    if (existingToday) {
      console.log('ℹ️  Appointment already exists for today!');
      console.log(`   Appointment ID: ${existingToday.appointmentId}`);
      console.log(`   Time: ${existingToday.startTimeMin} minutes (${Math.floor(existingToday.startTimeMin / 60)}:${(existingToday.startTimeMin % 60).toString().padStart(2, '0')})`);
      console.log(`   Status: ${existingToday.status}\n`);
      return;
    }

    // Create appointment for 10:00 AM (600 minutes from midnight)
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.patientId,
        doctorId: doctor.doctorId,
        department: doctor.department,
        date: todayUTC,
        startTimeMin: 600, // 10:00 AM
        endTimeMin: 630,   // 10:30 AM
        reason: 'Follow-up consultation',
        status: 'Scheduled',
      },
      include: {
        patient: { select: { name: true } },
        doctor: { select: { name: true, department: true } },
      },
    });

    console.log('✅ Successfully created appointment!\n');
    console.log(`   Appointment ID: ${appointment.appointmentId}`);
    console.log(`   Patient: ${appointment.patient.name}`);
    console.log(`   Doctor: ${appointment.doctor.name}`);
    console.log(`   Department: ${appointment.department}`);
    console.log(`   Date: ${appointment.date.toISOString()}`);
    console.log(`   Time: 10:00 AM - 10:30 AM`);
    console.log(`   Status: ${appointment.status}\n`);

  } catch (error) {
    console.error('❌ Error creating appointment:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createTodayAppointment()
  .then(() => {
    console.log('✨ Done! The appointment should now appear in Dr. Duke\'s queue.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });

