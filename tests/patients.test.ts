import request from 'supertest';
import { app } from '../src/index';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let patientId: string;

beforeAll(async () => {
  await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`;
  await prisma.user.create({ data: { email: 'doc@example.com', passwordHash: 'x', role: 'Doctor' } });
  const doctor = await prisma.doctor.create({ data: { name: 'Dr. Who', department: 'General' } });
  const patient = await prisma.patient.create({
    data: {
      name: 'John Doe',
      dob: new Date('1980-01-01'),
      gender: 'M',
      contact: '5551234',
      insurance: 'Aetna',
      drugAllergies: 'Penicillin',
    },
  });
  patientId = patient.patientId;
  await prisma.patient.create({
    data: {
      name: 'Jane Smith',
      dob: new Date('1990-01-01'),
      gender: 'F',
      contact: '5555678',
      insurance: 'Aetna',
      drugAllergies: 'Sulfa',
    },
  });
  const visit1 = await prisma.visit.create({ data: { patientId: patient.patientId, doctorId: doctor.doctorId, visitDate: new Date('2023-01-01'), department: 'Cardiology', reason: 'checkup' } });
  const visit2 = await prisma.visit.create({ data: { patientId: patient.patientId, doctorId: doctor.doctorId, visitDate: new Date('2023-02-01'), department: 'Endocrinology', reason: 'follow-up' } });
  await prisma.diagnosis.create({ data: { visitId: visit2.visitId, diagnosis: 'Diabetes' } });
  await prisma.medication.create({ data: { visitId: visit2.visitId, drugName: 'Metformin', dosage: '500mg' } });
  await prisma.labResult.create({ data: { visitId: visit2.visitId, testName: 'HbA1c', resultValue: 7.2, unit: '%', testDate: new Date('2023-02-01') } });
  await prisma.observation.create({ data: { visitId: visit2.visitId, patientId: patient.patientId, doctorId: doctor.doctorId, noteText: 'note1' } });
  await prisma.observation.create({ data: { visitId: visit2.visitId, patientId: patient.patientId, doctorId: doctor.doctorId, noteText: 'note2' } });
  await prisma.diagnosis.create({ data: { visitId: visit1.visitId, diagnosis: 'Hypertension' } });
  await prisma.medication.create({ data: { visitId: visit1.visitId, drugName: 'Lisinopril', dosage: '10mg' } });
  await prisma.labResult.create({ data: { visitId: visit1.visitId, testName: 'LDL', resultValue: 100, unit: 'mg/dL', testDate: new Date('2023-01-01') } });
  await prisma.observation.create({ data: { visitId: visit1.visitId, patientId: patient.patientId, doctorId: doctor.doctorId, noteText: 'noteA' } });
  await prisma.observation.create({ data: { visitId: visit1.visitId, patientId: patient.patientId, doctorId: doctor.doctorId, noteText: 'noteB' } });
});

afterAll(async () => {
  await prisma.observation.deleteMany({});
  await prisma.labResult.deleteMany({});
  await prisma.medication.deleteMany({});
  await prisma.diagnosis.deleteMany({});
  await prisma.visit.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.doctor.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
});

describe('GET /api/patients search', () => {
  it('finds patient by fuzzy name', async () => {
    const res = await request(app)
      .get('/api/patients')
      .query({ query: 'Jon Doe' });
    expect(res.status).toBe(200);
    const names = res.body.map((p: any) => p.name);
    expect(names).toContain('John Doe');
  });

  it('finds patient by identifier', async () => {
    const res = await request(app)
      .get('/api/patients')
      .query({ query: patientId });
    expect(res.status).toBe(200);
    const ids = res.body.map((p: any) => p.patientId);
    expect(ids).toContain(patientId);
  });
});

describe('GET /api/patients/:id summary', () => {
  it('returns patient summary with visits', async () => {
    const res = await request(app)
      .get(`/api/patients/${patientId}`)
      .query({ include: 'summary' });
    expect(res.status).toBe(200);
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.visits.length).toBeGreaterThan(0);
    const visit = res.body.visits[0];
    expect(visit.doctor.name).toBe('Dr. Who');
    expect(visit.diagnoses.length).toBeGreaterThan(0);
    expect(visit.medications.length).toBeGreaterThan(0);
    expect(visit.labResults.length).toBeGreaterThan(0);
    expect(visit.observations.length).toBeGreaterThan(0);
  });
});

describe('POST /api/patients', () => {
  it('creates a new patient', async () => {
    const res = await request(app).post('/api/patients').send({
      name: 'Alice Jones',
      dob: '2001-01-01',
      insurance: 'Aetna',
      drugAllergies: 'Ibuprofen',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Alice Jones');
    expect(res.body.drugAllergies).toBe('Ibuprofen');
  });
});
