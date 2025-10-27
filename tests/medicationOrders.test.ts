import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '../src/index';

const prisma = new PrismaClient();

function makeAuthHeader(userId: string, role: string, email: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, email })).toString('base64url');
  return `Bearer ${header}.${payload}.`;
}

let patientId: string;
let prescriptionId: string;
let pharmacistUserId: string;
let doctorId: string;
let drugId: string;

beforeAll(async () => {
  const doctor = await prisma.doctor.create({ data: { name: 'Dr Portal Rx', department: 'Pharmacy' } });
  doctorId = doctor.doctorId;
  const patient = await prisma.patient.create({
    data: { name: 'Portal Patient', dob: new Date('1992-02-02'), gender: 'F' },
  });
  patientId = patient.patientId;

  const visit = await prisma.visit.create({
    data: {
      patientId,
      doctorId: doctor.doctorId,
      visitDate: new Date('2024-02-01'),
      department: 'Pharmacy',
      reason: 'Medication refill',
    },
  });

  const drug = await prisma.drug.create({
    data: {
      name: 'Portal Test Drug',
      form: 'tab',
      strength: '250 mg',
    },
  });
  drugId = drug.drugId;

  const prescription = await prisma.prescription.create({
    data: {
      visitId: visit.visitId,
      doctorId: doctor.doctorId,
      patientId,
      status: 'PENDING',
      notes: 'Test prescription',
      items: {
        create: [
          {
            drugId: drug.drugId,
            dose: '250 mg',
            route: 'PO',
            frequency: 'TID',
            durationDays: 5,
            quantityPrescribed: 15,
          },
        ],
      },
    },
    include: { items: true },
  });
  prescriptionId = prescription.prescriptionId;

  const pharmacist = await prisma.user.create({
    data: {
      email: 'portal-rx@example.com',
      passwordHash: 'hash',
      role: 'Pharmacist',
      status: 'active',
    },
  });
  pharmacistUserId = pharmacist.userId;
});

afterAll(async () => {
  await prisma.medicationOrder.deleteMany({ where: { patientId } });
  await prisma.prescriptionItem.deleteMany({ where: { prescriptionId } });
  await prisma.prescription.deleteMany({ where: { prescriptionId } });
  await prisma.visit.deleteMany({ where: { patientId } });
  await prisma.patient.deleteMany({ where: { patientId } });
  await prisma.doctor.deleteMany({ where: { doctorId } });
  await prisma.drug.deleteMany({ where: { drugId } });
  await prisma.user.deleteMany({ where: { userId: pharmacistUserId } });
  await prisma.$disconnect();
});

describe('Patient portal medication orders', () => {
  it('creates an order for a prescription and allows pharmacist status updates', async () => {
    const createRes = await request(app)
      .post('/api/patient-portal/orders')
      .send({
        patientId,
        prescriptionId,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('PENDING');
    const orderId = createRes.body.orderId as string;

    const listRes = await request(app).get(`/api/patient-portal/orders/${patientId}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body[0].orderId).toBe(orderId);

    const pharmacistAuth = makeAuthHeader(
      pharmacistUserId,
      'Pharmacist',
      'portal-rx@example.com',
    );

    const approveRes = await request(app)
      .patch(`/api/pharmacy/medication-orders/${orderId}`)
      .set('Authorization', pharmacistAuth)
      .send({ status: 'APPROVED', notes: 'Ready for shipping' });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.notes).toBe('Ready for shipping');
    expect(approveRes.body.approvedAt).toBeTruthy();

    const shipRes = await request(app)
      .patch(`/api/pharmacy/medication-orders/${orderId}`)
      .set('Authorization', pharmacistAuth)
      .send({ status: 'SHIPPING' });

    expect(shipRes.status).toBe(200);
    expect(shipRes.body.status).toBe('SHIPPING');

    const shippingQueueRes = await request(app)
      .get('/api/pharmacy/medication-orders?status=SHIPPING')
      .set('Authorization', pharmacistAuth);

    expect(shippingQueueRes.status).toBe(200);
    expect(Array.isArray(shippingQueueRes.body.data)).toBe(true);
    expect(shippingQueueRes.body.data[0].status).toBe('SHIPPING');
    expect(shippingQueueRes.body.data[0].orderId).toBe(orderId);

    const enRouteRes = await request(app)
      .patch(`/api/pharmacy/medication-orders/${orderId}`)
      .set('Authorization', pharmacistAuth)
      .send({ status: 'ON_THE_WAY' });

    expect(enRouteRes.status).toBe(200);
    expect(enRouteRes.body.status).toBe('ON_THE_WAY');

    const shippedRes = await request(app)
      .patch(`/api/pharmacy/medication-orders/${orderId}`)
      .set('Authorization', pharmacistAuth)
      .send({ status: 'SHIPPED' });

    expect(shippedRes.status).toBe(200);
    expect(shippedRes.body.status).toBe('SHIPPED');

    const shippedQueueRes = await request(app)
      .get('/api/pharmacy/medication-orders?status=SHIPPED')
      .set('Authorization', pharmacistAuth);

    expect(shippedQueueRes.status).toBe(200);
    expect(Array.isArray(shippedQueueRes.body.data)).toBe(true);
    expect(shippedQueueRes.body.data[0].status).toBe('SHIPPED');
    expect(shippedQueueRes.body.data[0].orderId).toBe(orderId);
  });

  it('supports manual medication order submissions', async () => {
    const manualRes = await request(app)
      .post('/api/patient-portal/orders')
      .send({
        patientId,
        drugName: 'Ibuprofen 200mg',
        dosage: '200 mg',
        instructions: 'Take after meals',
        quantity: 30,
      });

    expect(manualRes.status).toBe(201);
    expect(manualRes.body.drugName).toBe('Ibuprofen 200mg');
    expect(manualRes.body.status).toBe('PENDING');
  });
});
