import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '../src/index';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
}

if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const prisma = new PrismaClient();
let patientId: string;

beforeAll(async () => {
  const patient = await prisma.patient.create({
    data: {
      name: 'Portal Patient',
      dob: new Date('1992-05-01'),
      gender: 'F',
      contact: '5551234567',
      insurance: 'Blue Shield',
    },
  });

  patientId = patient.patientId;
});

afterAll(async () => {
  await prisma.patientPortalAccount.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.$disconnect();
});

describe('POST /api/patient-portal/accounts', () => {
  it('creates a patient portal account', async () => {
    const res = await request(app).post('/api/patient-portal/accounts').send({
      patientId,
      email: 'patient@example.com',
      password: 'supersecret',
    });

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({
      patientId,
      email: 'patient@example.com',
      status: 'active',
    });

    const storedAccount = await prisma.patientPortalAccount.findUniqueOrThrow({
      where: { patientId },
    });

    expect(storedAccount.passwordHash).not.toBe('supersecret');
  });

  it('prevents duplicate registrations for the same patient', async () => {
    const res = await request(app).post('/api/patient-portal/accounts').send({
      patientId,
      email: 'patient@example.com',
      password: 'anothersecret',
    });

    expect(res.status).toBe(409);
  });

  it('rejects unknown patients', async () => {
    const res = await request(app).post('/api/patient-portal/accounts').send({
      patientId: '3e2876a0-74df-49ba-8e37-6b4f18e540a9',
      email: 'new@example.com',
      password: 'supersecret',
    });

    expect(res.status).toBe(404);
  });
});
