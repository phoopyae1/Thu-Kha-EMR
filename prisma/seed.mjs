import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

function loadCsv(path) {
  const buf = fs.readFileSync(path);
  return parse(buf, { columns: true, skip_empty_lines: true, trim: true });
}
function d(s) { return s ? new Date(`${s}T00:00:00Z`) : null; }

async function seedUsers() {
  const adminEmail = 'admin@example.com';
  const assistantEmail = 'assistant@example.com';
  const doctorEmail = 'drsmith@example.com';
  const cashierEmail = 'cashier@example.com';
  const pharmacistEmail = 'pharmacist@example.com';

  const adminHash = await bcrypt.hash('AdminPass123!', 10);
  const assistantHash = await bcrypt.hash('AssistantPass123!', 10);
  const doctorHash = await bcrypt.hash('DoctorPass123!', 10);
  const cashierHash = await bcrypt.hash('CashierPass123!', 10);
  const pharmacistHash = await bcrypt.hash('PharmacistPass123!', 10);

  const doctorRecord = await prisma.doctor.findFirst({
    where: { name: { equals: 'Dr Smith', mode: 'insensitive' } },
  });

  const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const adminData = {
    email: adminEmail,
    passwordHash: adminHash,
    role: 'ITAdmin',
    status: 'active',
    doctorId: null,
  };
  if (admin) {
    await prisma.user.update({ where: { email: adminEmail }, data: adminData });
  } else {
    await prisma.user.create({ data: adminData });
  }

  const assistant = await prisma.user.findUnique({ where: { email: assistantEmail } });
  const assistantData = {
    email: assistantEmail,
    passwordHash: assistantHash,
    role: 'AdminAssistant',
    status: 'active',
    doctorId: null,
  };
  if (assistant) {
    await prisma.user.update({ where: { email: assistantEmail }, data: assistantData });
  } else {
    await prisma.user.create({ data: assistantData });
  }

  const doctor = await prisma.user.findUnique({ where: { email: doctorEmail } });
  const doctorData = {
    email: doctorEmail,
    passwordHash: doctorHash,
    role: 'Doctor',
    status: 'active',
    doctorId: doctorRecord?.doctorId ?? null,
  };
  if (doctor) {
    await prisma.user.update({ where: { email: doctorEmail }, data: doctorData });
  } else {
    await prisma.user.create({ data: doctorData });
  }

  const cashier = await prisma.user.findUnique({ where: { email: cashierEmail } });
  const cashierData = {
    email: cashierEmail,
    passwordHash: cashierHash,
    role: 'Cashier',
    status: 'active',
    doctorId: null,
  };
  if (cashier) {
    await prisma.user.update({ where: { email: cashierEmail }, data: cashierData });
  } else {
    await prisma.user.create({ data: cashierData });
  }

  const pharmacist = await prisma.user.findUnique({ where: { email: pharmacistEmail } });
  const pharmacistData = {
    email: pharmacistEmail,
    passwordHash: pharmacistHash,
    role: 'Pharmacist',
    status: 'active',
    doctorId: null,
  };
  if (pharmacist) {
    await prisma.user.update({ where: { email: pharmacistEmail }, data: pharmacistData });
  } else {
    await prisma.user.create({ data: pharmacistData });
  }

  console.log('✅ Users seeded (admin, assistant, doctor, cashier, pharmacist)');
}

async function seedDoctors() {
  const rows = loadCsv('./prisma/data/doctors.csv');
  // expected headers: doctorId,name,department
  const map = new Map(); // doctorId -> true
  for (const r of rows) {
    const doctorId = r.doctorId;
    if (!doctorId) {
      console.warn('⚠️ Skipping doctor without doctorId:', r);
      continue;
    }
    await prisma.doctor.upsert({
      where: { doctorId },
      update: { name: r.name, department: r.department },
      create: { doctorId, name: r.name, department: r.department },
    });
    map.set(doctorId, true);
  }
  console.log(`✅ ${rows.length} doctors seeded`);
  return map;
}

async function seedPatients() {
  const rows = loadCsv('./prisma/data/patients.csv');
  // expected headers: patientId,name,dob,gender,contact,insurance
  const map = new Map(); // patientId -> true
  for (const r of rows) {
    const patientId = r.patientId;
    if (!patientId) {
      console.warn('⚠️ Skipping patient without patientId:', r);
      continue;
    }
    await prisma.patient.upsert({
      where: { patientId },
      update: {
        name: r.name, dob: d(r.dob), gender: r.gender || null,
        contact: r.contact || null, insurance: r.insurance || null,
      },
      create: {
        patientId,
        name: r.name, dob: d(r.dob), gender: r.gender || null,
        contact: r.contact || null, insurance: r.insurance || null,
      },
    });
    map.set(patientId, true);
  }
  console.log(`✅ ${rows.length} patients seeded`);
  return map;
}

async function seedDoctorAvailability(doctorMap) {
  const slots = [
    // Dr Tan (General Medicine) Monday to Friday
    { availabilityId: 'b2d2b9df-796d-41f5-8fdb-c70bad00adcc', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 1, startMin: 540, endMin: 720 },
    { availabilityId: '52cfb3a3-b42f-4824-b7c2-354720d028cb', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 1, startMin: 780, endMin: 1020 },
    { availabilityId: '006794f9-9f03-4fe9-aa1b-82c93d27a7bd', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 2, startMin: 540, endMin: 720 },
    { availabilityId: 'a27d5796-24db-41f4-ac37-f320203bc52f', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 2, startMin: 780, endMin: 1020 },
    { availabilityId: 'e3803857-b743-4113-9695-b8de7b2c3e41', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 3, startMin: 540, endMin: 720 },
    { availabilityId: '07618e7d-6656-40d3-82ff-cda232e7ab03', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 3, startMin: 780, endMin: 1020 },
    { availabilityId: '0c74c7a1-edf8-4479-aa66-81adb956c138', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 4, startMin: 540, endMin: 720 },
    { availabilityId: '0007e357-efcc-4323-8d21-d294916a6145', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 4, startMin: 780, endMin: 1020 },
    { availabilityId: '02daf0e2-eb0f-424a-a389-11d1b3b6a587', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 5, startMin: 540, endMin: 720 },
    { availabilityId: '62b42ce4-d7bb-442e-9468-e53f4eb7cdb9', doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53', dayOfWeek: 5, startMin: 780, endMin: 1020 },
    // Dr Lee (Endocrinology) Tuesday & Thursday
    { availabilityId: 'fbfa2a80-3d55-459d-a1c0-fdd248dc46bf', doctorId: 'ce60576c-9cac-524a-8134-26db68392be6', dayOfWeek: 2, startMin: 600, endMin: 960 },
    { availabilityId: 'f87ec26a-869a-47d3-8cfb-01e039aba27d', doctorId: 'ce60576c-9cac-524a-8134-26db68392be6', dayOfWeek: 4, startMin: 600, endMin: 960 },
  ];

  let created = 0;
  for (const slot of slots) {
    if (!doctorMap.has(slot.doctorId)) {
      console.warn('⚠️ Skipping availability for missing doctorId:', slot);
      continue;
    }

    await prisma.doctorAvailability.upsert({
      where: { availabilityId: slot.availabilityId },
      update: {
        doctorId: slot.doctorId,
        dayOfWeek: slot.dayOfWeek,
        startMin: slot.startMin,
        endMin: slot.endMin,
      },
      create: slot,
    });
    created++;
  }

  console.log(`✅ ${created} doctor availability slots seeded`);
}

async function seedDoctorBlackouts(doctorMap) {
  const blackouts = [
    {
      blackoutId: '89316939-b0df-4aa0-8e6b-0d09faea458d',
      doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53',
      startAt: new Date('2025-09-25T09:00:00Z'),
      endAt: new Date('2025-09-25T13:00:00Z'),
      reason: 'Conference attendance',
    },
    {
      blackoutId: '84036a72-e0be-4a3b-b2c7-9c6e29a7cafa',
      doctorId: 'ce60576c-9cac-524a-8134-26db68392be6',
      startAt: new Date('2025-10-14T10:00:00Z'),
      endAt: new Date('2025-10-14T12:00:00Z'),
      reason: 'Specialist workshop',
    },
  ];

  let created = 0;
  for (const blackout of blackouts) {
    if (!doctorMap.has(blackout.doctorId)) {
      console.warn('⚠️ Skipping blackout for missing doctorId:', blackout);
      continue;
    }

    await prisma.doctorBlackout.upsert({
      where: { blackoutId: blackout.blackoutId },
      update: {
        doctorId: blackout.doctorId,
        startAt: blackout.startAt,
        endAt: blackout.endAt,
        reason: blackout.reason,
      },
      create: blackout,
    });
    created++;
  }

  console.log(`✅ ${created} doctor blackout periods seeded`);
}

async function seedAppointments(doctorMap, patientMap) {
  const appointments = [
    {
      appointmentId: 'd26f0028-0fae-4b4b-a561-9086fc7bcf61',
      patientId: '6a1928ef-a4b2-51c2-9746-0ac0b2594f55',
      doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53',
      department: 'General Medicine',
      date: new Date('2025-09-23T00:00:00Z'),
      startTimeMin: 570,
      endTimeMin: 600,
      reason: 'Chronic condition review',
      location: 'Clinic Room 3',
      status: 'Scheduled',
    },
    {
      appointmentId: '7934c1bb-b502-4fb8-addf-f535022be631',
      patientId: 'cb3c6ada-1e86-5e14-8c17-0be10e6bb5ca',
      doctorId: '7d24ea31-79b3-58dc-9d7c-8e34a298fc53',
      department: 'General Medicine',
      date: new Date('2025-09-25T00:00:00Z'),
      startTimeMin: 840,
      endTimeMin: 900,
      reason: 'Post-discharge follow-up',
      location: 'Clinic Room 2',
      status: 'Scheduled',
    },
    {
      appointmentId: 'abdb33f9-3e0a-40e8-a257-8101b905f155',
      patientId: '7f09bd54-9c0a-54ad-9908-622e687f7c31',
      doctorId: 'ce60576c-9cac-524a-8134-26db68392be6',
      department: 'Endocrinology',
      date: new Date('2025-09-30T00:00:00Z'),
      startTimeMin: 630,
      endTimeMin: 690,
      reason: 'Diabetes management review',
      location: 'Endocrinology Suite',
      status: 'Scheduled',
    },
  ];

  let created = 0;
  for (const appt of appointments) {
    if (!doctorMap.has(appt.doctorId)) {
      console.warn('⚠️ Skipping appointment for missing doctorId:', appt);
      continue;
    }
    if (!patientMap.has(appt.patientId)) {
      console.warn('⚠️ Skipping appointment for missing patientId:', appt);
      continue;
    }

    await prisma.appointment.upsert({
      where: { appointmentId: appt.appointmentId },
      update: {
        patientId: appt.patientId,
        doctorId: appt.doctorId,
        department: appt.department,
        date: appt.date,
        startTimeMin: appt.startTimeMin,
        endTimeMin: appt.endTimeMin,
        reason: appt.reason,
        location: appt.location,
        status: appt.status,
      },
      create: appt,
    });
    created++;
  }

  console.log(`✅ ${created} appointments seeded`);
}

async function seedVisits(doctorMap, patientMap) {
  const rows = loadCsv('./prisma/data/visits.csv');
  // expected headers: visitId,patientId,doctorId,visitDate,department,reason
  let created = 0, skipped = 0;
  for (const r of rows) {
    const { visitId, patientId, doctorId } = r;
    if (!visitId || !patientId || !doctorId) {
      console.warn('⚠️ Skipping visit missing IDs:', r);
      skipped++; continue;
    }
    if (!doctorMap.has(doctorId)) {
      console.error('❌ Missing doctor for visit, doctorId=', doctorId, ' row=', r);
      skipped++; continue;
    }
    if (!patientMap.has(patientId)) {
      console.error('❌ Missing patient for visit, patientId=', patientId, ' row=', r);
      skipped++; continue;
    }
    try {
      await prisma.visit.upsert({
        where: { visitId },
        update: {
          patientId, doctorId, visitDate: d(r.visitDate),
          department: r.department || null, reason: r.reason || null,
        },
        create: {
          visitId, patientId, doctorId, visitDate: d(r.visitDate),
          department: r.department || null, reason: r.reason || null,
        },
      });
      created++;
    } catch (e) {
      console.error('❌ Visit upsert failed for', visitId, e.message);
      throw e;
    }
  }
  console.log(`✅ ${created} visits seeded, ${skipped} skipped`);
}

async function seedDiagnoses() {
  const rows = loadCsv('./prisma/data/diagnoses.csv');
  // expected: diagId,visitId,diagnosis
  for (const r of rows) {
    await prisma.diagnosis.upsert({
      where: { diagId: r.diagId },
      update: { visitId: r.visitId, diagnosis: r.diagnosis },
      create: { diagId: r.diagId, visitId: r.visitId, diagnosis: r.diagnosis },
    });
  }
  console.log(`✅ ${rows.length} diagnoses seeded`);
}

async function seedMedications() {
  const rows = loadCsv('./prisma/data/medications.csv');
  // expected: medId,visitId,drugName,dosage,instructions
  for (const r of rows) {
    await prisma.medication.upsert({
      where: { medId: r.medId },
      update: { visitId: r.visitId, drugName: r.drugName, dosage: r.dosage || null, instructions: r.instructions || null },
      create: { medId: r.medId, visitId: r.visitId, drugName: r.drugName, dosage: r.dosage || null, instructions: r.instructions || null },
    });
  }
  console.log(`✅ ${rows.length} medications seeded`);
}

async function seedLabs() {
  const rows = loadCsv('./prisma/data/lab_results.csv');
  // expected: labId,visitId,testName,resultValue,unit,referenceRange,testDate
  for (const r of rows) {
    await prisma.visitLabResult.upsert({  
      where: { labId: r.labId },
      update: {
        visitId: r.visitId, testName: r.testName,
        resultValue: r.resultValue ? parseFloat(r.resultValue) : null,
        unit: r.unit || null, referenceRange: r.referenceRange || null, testDate: d(r.testDate),
      },
      create: {
        labId: r.labId, visitId: r.visitId, testName: r.testName,
        resultValue: r.resultValue ? parseFloat(r.resultValue) : null,
        unit: r.unit || null, referenceRange: r.referenceRange || null, testDate: d(r.testDate),
      },
    });
  }
  console.log(`✅ ${rows.length} lab results seeded`);
}

async function seedObservations() {
  const rows = loadCsv('./prisma/data/reports.csv');
  // expected: obsId,visitId,patientId,doctorId,noteText,bpSystolic,bpDiastolic,heartRate,temperatureC,spo2,bmi,createdAt
  for (const r of rows) {
    await prisma.observation.upsert({
      where: { obsId: r.obsId },
      update: {
        visitId: r.visitId, patientId: r.patientId, doctorId: r.doctorId,
        noteText: r.noteText || '',
        bpSystolic: r.bpSystolic ? parseInt(r.bpSystolic, 10) : null,
        bpDiastolic: r.bpDiastolic ? parseInt(r.bpDiastolic, 10) : null,
        heartRate: r.heartRate ? parseInt(r.heartRate, 10) : null,
        temperatureC: r.temperatureC ? parseFloat(r.temperatureC) : null,
        spo2: r.spo2 ? parseInt(r.spo2, 10) : null,
        bmi: r.bmi ? parseFloat(r.bmi) : null,
        createdAt: d(r.createdAt),
      },
      create: {
        obsId: r.obsId,
        visitId: r.visitId, patientId: r.patientId, doctorId: r.doctorId,
        noteText: r.noteText || '',
        bpSystolic: r.bpSystolic ? parseInt(r.bpSystolic, 10) : null,
        bpDiastolic: r.bpDiastolic ? parseInt(r.bpDiastolic, 10) : null,
        heartRate: r.heartRate ? parseInt(r.heartRate, 10) : null,
        temperatureC: r.temperatureC ? parseFloat(r.temperatureC) : null,
        spo2: r.spo2 ? parseInt(r.spo2, 10) : null,
        bmi: r.bmi ? parseFloat(r.bmi) : null,
        createdAt: d(r.createdAt),
      },
    });
  }
  console.log(`✅ ${rows.length} observations seeded`);
}

async function main() {
  // ORDER MATTERS
  const doctorMap  = await seedDoctors();
  const patientMap = await seedPatients();
  await seedDoctorAvailability(doctorMap);
  await seedDoctorBlackouts(doctorMap);
  await seedAppointments(doctorMap, patientMap);
  await seedVisits(doctorMap, patientMap);

  await seedDiagnoses();
  await seedMedications();
  await seedLabs();
  await seedObservations();
  await seedUsers();
}

main()
  .catch((e) => {
    console.error('❌ Seed failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
