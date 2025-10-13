import { Router, type Response, type Request } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient, type AppointmentStatus } from '@prisma/client';
import { z } from 'zod';

import { validate } from '../../middleware/validate.js';

const prisma = new PrismaClient();
const router = Router();

// Helper functions for JWT
function createAccessToken(account: { accountId: string; patientId: string; email: string }) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: account.accountId, patientId: account.patientId, email: account.email })
  ).toString('base64url');
  return `${header}.${payload}.`;
}

// Patient Portal Login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const account = await prisma.patientPortalAccount.findFirst({
    where: { email: email.toLowerCase() },
    select: { accountId: true, patientId: true, email: true, passwordHash: true, status: true },
  });

  if (!account || account.status !== 'active') {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const passwordValid = await bcrypt.compare(password, account.passwordHash);
  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = createAccessToken(account);
  await prisma.patientPortalAccount.update({
    where: { accountId: account.accountId },
    data: { lastLoginAt: new Date() },
  });

  const patient = await prisma.patient.findUnique({
    where: { patientId: account.patientId },
    select: { patientId: true, name: true },
  });

  res.json({
    accessToken: token,
    patient,
  });
});

const facilityQuerySchema = z.object({
  type: z.enum(['HOSPITAL', 'GP_CLINIC', 'DIAGNOSTIC_CENTER']).optional(),
  search: z.string().trim().min(1).optional(),
});

type FacilityQuery = z.infer<typeof facilityQuerySchema>;

router.get('/facilities', async (req: Request, res: Response) => {
  const query = facilityQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.flatten() });
  }

  const { type, search } = query.data;
  const facilities = await prisma.facility.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
              { state: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
  });

  const enriched = facilities.map((facility: any) => {
    const latitude = facility.latitude ? Number(facility.latitude) : null;
    const longitude = facility.longitude ? Number(facility.longitude) : null;
    const mapTarget =
      latitude && longitude
        ? `${latitude},${longitude}`
        : `${facility.name} ${facility.city || ''} ${facility.state || ''}`.trim();

    return {
      ...facility,
      latitude,
      longitude,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapTarget)}`,
    };
  });

  res.json(enriched);
});

const specialistQuerySchema = z.object({
  department: z.string().trim().min(1).optional(),
  facilityId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
});

type SpecialistQuery = z.infer<typeof specialistQuerySchema>;

router.get('/specialists', async (req: Request, res: Response) => {
  const query = specialistQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.flatten() });
  }

  const { department, search } = query.data;
  const doctors = await prisma.doctor.findMany({
    where: {
      ...(department ? { department: { contains: department, mode: 'insensitive' } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { department: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      doctorId: true,
      name: true,
      department: true,
      availabilities: {
        orderBy: { dayOfWeek: 'asc' },
        take: 5,
        select: {
          dayOfWeek: true,
          startMin: true,
          endMin: true,
        },
      },
    },
  });

  res.json(doctors);
});

// Public endpoints for patient portal

const appointmentCreateSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  department: z.string().trim().min(1).optional(),
  date: z.coerce.date(),
  startTimeMin: z.coerce.number().int().min(0).max(24 * 60 - 1),
  endTimeMin: z.coerce.number().int().min(1).max(24 * 60).optional(),
  reason: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
});

type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

function splitAppointments(
  appointments: Array<{
    appointmentId: string;
    date: Date;
    startTimeMin: number;
    endTimeMin: number;
    status: AppointmentStatus;
    department: string;
    doctor: { doctorId: string; name: string; department: string };
    location: string | null;
    reason: string | null;
  }>
) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming: typeof appointments = [];
  const past: typeof appointments = [];

  for (const appointment of appointments) {
    if (appointment.date >= today) {
      upcoming.push(appointment);
    } else {
      past.push(appointment);
    }
  }

  return {
    upcoming,
    past,
  };
}

router.get('/profile/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;
  
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const patient = await prisma.patient.findUnique({
    where: { patientId },
    select: {
      patientId: true,
      name: true,
      dob: true,
      gender: true,
      contact: true,
      insurance: true,
      drugAllergies: true,
    },
  });

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const appointments = await prisma.appointment.findMany({
    where: { patientId, status: { not: 'Cancelled' } },
    orderBy: { date: 'asc' },
    take: 10,
    select: {
      appointmentId: true,
      date: true,
      startTimeMin: true,
      endTimeMin: true,
      status: true,
      department: true,
      location: true,
      reason: true,
      doctor: {
        select: {
          doctorId: true,
          name: true,
          department: true,
        },
      },
    },
  });

  const visits = await prisma.visit.findMany({
    where: { patientId },
    orderBy: { visitDate: 'desc' },
    take: 3,
    select: {
      visitId: true,
      visitDate: true,
      department: true,
      doctor: { select: { name: true } },
    },
  });

  const invoices = await prisma.invoice.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      invoiceId: true,
      invoiceNo: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      amountDue: true,
      createdAt: true,
    },
  });

  const immunizations = await prisma.immunizationRecord.findMany({
    where: { patientId },
    orderBy: { administeredAt: 'desc' },
    take: 1,
    select: {
      vaccineName: true,
      administeredAt: true,
      provider: true,
    },
  });

  const { upcoming, past } = splitAppointments(appointments);
  const invoiceSummary = invoices.reduce(
    (acc, invoice) => {
      const due = Number(invoice.amountDue);
      const total = Number(invoice.grandTotal);
      const paid = Number(invoice.amountPaid);
      return {
        outstanding: acc.outstanding + due,
        lifetimeValue: acc.lifetimeValue + total,
        paidTotal: acc.paidTotal + paid,
      };
    },
    { outstanding: 0, lifetimeValue: 0, paidTotal: 0 }
  );

  res.json({
    patient: {
      patientId: patient.patientId,
      name: patient.name,
      dob: patient.dob,
      gender: patient.gender,
      contact: patient.contact,
      insurance: patient.insurance,
      drugAllergies: patient.drugAllergies,
    },
    appointments: {
      upcoming,
      past,
    },
    recentVisits: visits,
    invoiceSummary,
    latestImmunization: immunizations[0] ?? null,
  });
});

router.get('/appointments/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;
  
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const appointments = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: { date: 'desc' },
    take: 50,
    select: {
      appointmentId: true,
      date: true,
      startTimeMin: true,
      endTimeMin: true,
      status: true,
      department: true,
      location: true,
      reason: true,
      doctor: {
        select: {
          doctorId: true,
          name: true,
          department: true,
        },
      },
    },
  });

  res.json(splitAppointments(appointments));
});

router.post(
  '/appointments',
  validate({ body: appointmentCreateSchema }),
  async (req: Request, res: Response) => {
    const body = req.body as AppointmentCreateInput;
    const { patientId } = body;
    const endTimeMin = body.endTimeMin ?? body.startTimeMin + 30;

    if (endTimeMin <= body.startTimeMin) {
      return res.status(400).json({ error: 'Appointment end time must be after the start time' });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { doctorId: body.doctorId },
      select: { doctorId: true, department: true },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const dateOnly = new Date(body.date.getFullYear(), body.date.getMonth(), body.date.getDate());

    const overlapping = await prisma.appointment.findFirst({
      where: {
        doctorId: doctor.doctorId,
        date: dateOnly,
        status: { not: 'Cancelled' },
        startTimeMin: { lt: endTimeMin },
        endTimeMin: { gt: body.startTimeMin },
      },
    });

    if (overlapping) {
      return res
        .status(409)
        .json({ error: 'The selected doctor already has an appointment during that time window.' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId: doctor.doctorId,
        department: body.department ?? doctor.department,
        date: dateOnly,
        startTimeMin: body.startTimeMin,
        endTimeMin,
        reason: body.reason ?? null,
        location: body.location ?? null,
        status: 'Scheduled',
      },
      select: {
        appointmentId: true,
        date: true,
        startTimeMin: true,
        endTimeMin: true,
        status: true,
        department: true,
        location: true,
        reason: true,
        doctor: {
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        },
      },
    });

    res.status(201).json(appointment);
  }
);

router.get('/labs/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;
  
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const labResults = await prisma.labResult.findMany({
    where: { patientId },
    orderBy: { resultedAt: 'desc' },
    take: 50,
    select: {
      labResultId: true,
      resultValue: true,
      resultValueNum: true,
      unit: true,
      referenceLow: true,
      referenceHigh: true,
      abnormalFlag: true,
      resultedAt: true,
      notes: true,
      LabOrder: {
        select: {
          labOrderId: true,
          status: true,
          doctorId: true,
        },
      },
      LabOrderItem: {
        select: {
          testCode: true,
          testName: true,
        },
      },
    },
  });

  const formatted = labResults.map((result) => ({
    ...result,
    resultValueNum: result.resultValueNum ? Number(result.resultValueNum) : null,
    referenceLow: result.referenceLow ? Number(result.referenceLow) : null,
    referenceHigh: result.referenceHigh ? Number(result.referenceHigh) : null,
  }));

  res.json(formatted);
});

router.get('/immunizations/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;
  
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const immunizations = await prisma.immunizationRecord.findMany({
    where: { patientId },
    orderBy: { administeredAt: 'desc' },
    take: 25,
    select: {
      immunizationId: true,
      vaccineName: true,
      lotNumber: true,
      administeredAt: true,
      provider: true,
      notes: true,
    },
  });

  res.json(immunizations);
});

router.get('/radiology/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;
  
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const reports = await prisma.radiologyReport.findMany({
    where: { patientId },
    orderBy: { reportDate: 'desc' },
    take: 25,
    select: {
      reportId: true,
      modality: true,
      reportDate: true,
      impression: true,
      findings: true,
      imageUrl: true,
      visit: {
        select: {
          visitId: true,
          visitDate: true,
          department: true,
          doctor: { select: { name: true, department: true } },
        },
      },
    },
  });

  res.json(reports);
});

router.get('/payments/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;
  
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const invoices = await prisma.invoice.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      invoiceId: true,
      invoiceNo: true,
      status: true,
      grandTotal: true,
      amountPaid: true,
      amountDue: true,
      createdAt: true,
      payments: {
        orderBy: { paidAt: 'desc' },
        select: {
          paymentId: true,
          method: true,
          amount: true,
          paidAt: true,
          referenceNo: true,
          note: true,
        },
      },
    },
  });

  const formatted = invoices.map((invoice) => ({
    ...invoice,
    grandTotal: Number(invoice.grandTotal),
    amountPaid: Number(invoice.amountPaid),
    amountDue: Number(invoice.amountDue),
    payments: invoice.payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
    })),
  }));

  res.json(formatted);
});

export default router;
