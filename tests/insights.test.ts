import request from 'supertest';
import { app } from '../src/index';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let patient1Id: string;
let patient2Id: string;
let latestVisitId: string;

beforeAll(async () => {
  await prisma.user.create({ data: { email: 'insights@example.com', passwordHash: 'x', role: 'Doctor' } });
  const doctor = await prisma.doctor.create({ data: { name: 'Dr. I', department: 'Insights' } });
  const patient1 = await prisma.patient.create({ data: { name: 'Alice', dob: new Date('1980-01-01'), gender: 'F' } });
  const patient2 = await prisma.patient.create({ data: { name: 'Bob', dob: new Date('1975-01-01'), gender: 'M' } });
  patient1Id = patient1.patientId;
  patient2Id = patient2.patientId;
  const now = new Date();
  const older = new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
  const recent = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const visitA = await prisma.visit.create({ data: { patientId: patient1Id, doctorId: doctor.doctorId, visitDate: older, department: 'Gen' } });
  const visitB = await prisma.visit.create({ data: { patientId: patient1Id, doctorId: doctor.doctorId, visitDate: recent, department: 'Gen' } });
  latestVisitId = visitB.visitId;
  const visitC = await prisma.visit.create({ data: { patientId: patient2Id, doctorId: doctor.doctorId, visitDate: recent, department: 'Gen' } });
  await prisma.diagnosis.create({ data: { visitId: visitB.visitId, diagnosis: 'Condition' } });
  await prisma.medication.create({ data: { visitId: visitB.visitId, drugName: 'Drug', dosage: '10mg' } });
  await prisma.visitLabResult.create({ data: { visitId: visitA.visitId, testName: 'HbA1c', resultValue: 8.5, unit: '%', testDate: older } });
  await prisma.visitLabResult.create({ data: { visitId: visitB.visitId, testName: 'HbA1c', resultValue: 9.2, unit: '%', testDate: recent } });
  await prisma.visitLabResult.create({ data: { visitId: visitC.visitId, testName: 'HbA1c', resultValue: 7.0, unit: '%', testDate: recent } });
});

afterAll(async () => {
  await prisma.visitLabResult.deleteMany({});
  await prisma.medication.deleteMany({});
  await prisma.diagnosis.deleteMany({});
  await prisma.visit.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.doctor.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
});

describe('Insights cohort', () => {
  it('finds patients with high HbA1c', async () => {
    const res = await request(app)
      .get('/api/insights/cohort')
      .query({ test_name: 'HbA1c', op: 'gt', value: 8, months: 6 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].patientId).toBe(patient1Id);
    expect(res.body[0].lastMatchingLab.value).toBeCloseTo(9.2);
  });
});

describe('Insights summary and latest visit', () => {
  it('returns patient summary', async () => {
    const res = await request(app)
      .get('/api/insights/patient-summary')
      .query({ patient_id: patient1Id, last_n: 2 });
    expect(res.status).toBe(200);
    expect(res.body.visits.length).toBe(2);
  });

  it('returns latest visit bundle', async () => {
    const res = await request(app)
      .get('/api/insights/latest-visit')
      .query({ patient_id: patient1Id });
    expect(res.status).toBe(200);
    expect(res.body.visitId).toBe(latestVisitId);
  });
});

