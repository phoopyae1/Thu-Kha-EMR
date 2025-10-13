import request from 'supertest';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { app } from '../src/index';

const prisma = new PrismaClient();

describe('Patient portal account management', () => {
  const adminEmail = 'portal-admin@example.com';
  const adminPassword = 'AdminPass123!';
  const doctorEmail = 'portal-doctor@example.com';
  const doctorPassword = 'DoctorPass123!';
  const initialPortalEmail = 'portal.patient@example.com';

  let patientId: string;
  let accountId: string;
  let adminToken: string;
  let doctorToken: string;

  beforeAll(async () => {
    await prisma.patientPortalAccount.deleteMany({
      where: { email: { in: [initialPortalEmail, 'updated-portal@example.com'] } },
    });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, doctorEmail] } } });

    const patient = await prisma.patient.create({
      data: {
        name: 'Portal Test Patient',
        dob: new Date('1992-04-03'),
        gender: 'F',
        contact: '555-2024',
        insurance: 'Demo Health',
      },
    });
    patientId = patient.patientId;

    const adminHash = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: adminHash,
        role: 'AdminAssistant',
        status: 'active',
      },
    });

    const doctorHash = await bcrypt.hash(doctorPassword, 10);
    await prisma.user.create({
      data: {
        email: doctorEmail,
        passwordHash: doctorHash,
        role: 'Doctor',
        status: 'active',
      },
    });

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken as string;

    const doctorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: doctorEmail, password: doctorPassword });
    expect(doctorLogin.status).toBe(200);
    doctorToken = doctorLogin.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.patientPortalAccount.deleteMany({ where: { patientId } });
    await prisma.patient.deleteMany({ where: { patientId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, doctorEmail] } } });
    await prisma.$disconnect();
  });

  it('returns null when no portal account exists', async () => {
    const res = await request(app)
      .get(`/api/patient-portal/accounts/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.account).toBeNull();
  });

  it('creates a portal account for a patient', async () => {
    const res = await request(app)
      .post('/api/patient-portal/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ patientId, email: initialPortalEmail, password: 'PortalPass123!' });

    expect(res.status).toBe(201);
    expect(res.body.account.email).toBe(initialPortalEmail.toLowerCase());
    expect(res.body.account.status).toBe('active');
    accountId = res.body.account.accountId as string;
  });

  it('fetches the created portal account', async () => {
    const res = await request(app)
      .get(`/api/patient-portal/accounts/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.account.accountId).toBe(accountId);
    expect(res.body.account.email).toBe(initialPortalEmail.toLowerCase());
  });

  it('updates email, status, and password for an existing account', async () => {
    const updatedEmail = 'updated-portal@example.com';
    const res = await request(app)
      .patch(`/api/patient-portal/accounts/${accountId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: updatedEmail, status: 'inactive', password: 'NewPortalPass456!' });

    expect(res.status).toBe(200);
    expect(res.body.account.email).toBe(updatedEmail);
    expect(res.body.account.status).toBe('inactive');

    const fetchRes = await request(app)
      .get(`/api/patient-portal/accounts/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.account.email).toBe(updatedEmail);
    expect(fetchRes.body.account.status).toBe('inactive');
  });

  it('prevents non-privileged staff from creating accounts', async () => {
    const otherPatient = await prisma.patient.create({
      data: {
        name: 'Unauthorized Portal Patient',
        dob: new Date('1988-09-09'),
        gender: 'M',
        contact: '555-3030',
        insurance: 'Demo Health',
      },
    });

    const res = await request(app)
      .post('/api/patient-portal/accounts')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: otherPatient.patientId,
        email: 'forbidden@example.com',
        password: 'DoctorCannot123!',
      });

    expect(res.status).toBe(403);

    await prisma.patient.delete({ where: { patientId: otherPatient.patientId } });
  });
});
