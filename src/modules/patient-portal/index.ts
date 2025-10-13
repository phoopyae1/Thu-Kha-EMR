import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient, FacilityType, Prisma } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const router = Router();

interface PatientAuthUser {
  accountId: string;
  patientId: string;
  email: string;
}

export interface PatientAuthRequest extends Request {
  portalAccount?: PatientAuthUser;
}

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  return value?.trim() || null;
}

function decodeToken(token: string): { sub?: string; patientId?: unknown; email?: unknown } {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid token');
  }
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload);
}

export async function requirePatientPortalAuth(
  req: PatientAuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const rawToken = parseBearerToken(req.get('authorization'));
    if (!rawToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = decodeToken(rawToken);
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.patientId !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const account = await prisma.patientPortalAccount.findUnique({
      where: { accountId: payload.sub },
      select: { accountId: true, patientId: true, email: true, status: true },
    });

    if (!account || account.status !== 'active') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.portalAccount = {
      accountId: account.accountId,
      patientId: account.patientId,
      email: account.email,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function createAccessToken(account: { accountId: string; patientId: string; email: string }) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: account.accountId, patientId: account.patientId, email: account.email })
  ).toString('base64url');
  return `${header}.${payload}.`;
}

const registrationSchema = z.object({
  patientId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { patientId, email, password } = parsed.data;

  const patient = await prisma.patient.findUnique({ where: { patientId } });
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const existing = await prisma.patientPortalAccount.findFirst({
    where: {
      OR: [{ patientId }, { email: email.toLowerCase() }],
    },
  });

  if (existing) {
    return res.status(409).json({ error: 'An account already exists for this patient or email' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const account = await prisma.patientPortalAccount.create({
    data: {
      patientId,
      email: email.toLowerCase(),
      passwordHash,
    },
    select: { accountId: true, patientId: true, email: true },
  });

  res.status(201).json({
    accountId: account.accountId,
    patientId: account.patientId,
    email: account.email,
  });
});

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

router.get('/profile', requirePatientPortalAuth, async (req: PatientAuthRequest, res: Response) => {
  const patientId = req.portalAccount!.patientId;
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
      visits: {
        take: 5,
        orderBy: { visitDate: 'desc' },
        select: {
          visitId: true,
          visitDate: true,
          doctor: { select: { doctorId: true, name: true, department: true } },
          department: true,
        },
      },
    },
  });

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  res.json(patient);
});

const appointmentCreateSchema = z.object({
  doctorId: z.string().uuid(),
  date: z.coerce.date(),
  startTimeMin: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60 - 1),
  endTimeMin: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .refine((value, ctx) => {
      const { startTimeMin } = ctx.parent as { startTimeMin: number };
      return value > startTimeMin;
    }, 'endTimeMin must be greater than startTimeMin'),
  reason: z.string().min(1).max(500),
  location: z.string().min(1).max(255).optional(),
});

router.post(
  '/appointments',
  requirePatientPortalAuth,
  async (req: PatientAuthRequest, res: Response) => {
    const parsed = appointmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { doctorId, date, startTimeMin, endTimeMin, reason, location } = parsed.data;

    const doctor = await prisma.doctor.findUnique({
      where: { doctorId },
      select: { department: true },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) {
      return res.status(400).json({ error: 'Appointment date must be in the future' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId: req.portalAccount!.patientId,
        doctorId,
        department: doctor.department,
        date,
        startTimeMin,
        endTimeMin,
        reason,
        location,
      },
      select: {
        appointmentId: true,
        date: true,
        startTimeMin: true,
        endTimeMin: true,
        status: true,
      },
    });

    res.status(201).json(appointment);
  }
);

router.get(
  '/appointments',
  requirePatientPortalAuth,
  async (req: PatientAuthRequest, res: Response) => {
    const patientId = req.portalAccount!.patientId;
    const appointments = await prisma.appointment.findMany({
      where: { patientId },
      orderBy: [{ date: 'desc' }, { startTimeMin: 'desc' }],
      select: {
        appointmentId: true,
        date: true,
        startTimeMin: true,
        endTimeMin: true,
        status: true,
        reason: true,
        location: true,
        doctor: { select: { doctorId: true, name: true, department: true } },
      },
    });

    res.json(appointments);
  }
);

router.get('/labs', requirePatientPortalAuth, async (req: PatientAuthRequest, res: Response) => {
  const patientId = req.portalAccount!.patientId;
  const labResults = await prisma.visitLabResult.findMany({
    where: { visit: { patientId } },
    orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      labId: true,
      testName: true,
      resultValue: true,
      unit: true,
      referenceRange: true,
      testDate: true,
      visit: {
        select: {
          visitId: true,
          visitDate: true,
          doctor: { select: { doctorId: true, name: true } },
        },
      },
    },
  });

  res.json(labResults);
});

router.get(
  '/immunisations',
  requirePatientPortalAuth,
  async (req: PatientAuthRequest, res: Response) => {
    const patientId = req.portalAccount!.patientId;
    const records = await prisma.immunizationRecord.findMany({
      where: { patientId },
      orderBy: { administeredAt: 'desc' },
      select: {
        immunizationId: true,
        vaccineName: true,
        administeredAt: true,
        provider: true,
        lotNumber: true,
        notes: true,
      },
    });

    res.json(records);
  }
);

router.get(
  '/radiology',
  requirePatientPortalAuth,
  async (req: PatientAuthRequest, res: Response) => {
    const patientId = req.portalAccount!.patientId;
    const reports = await prisma.radiologyReport.findMany({
      where: { patientId },
      orderBy: { reportDate: 'desc' },
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
            doctor: { select: { doctorId: true, name: true, department: true } },
          },
        },
      },
    });

    res.json(reports);
  }
);

router.get(
  '/payments',
  requirePatientPortalAuth,
  async (req: PatientAuthRequest, res: Response) => {
    const patientId = req.portalAccount!.patientId;
    const invoices = await prisma.invoice.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        invoiceId: true,
        invoiceNo: true,
        status: true,
        currency: true,
        amountDue: true,
        amountPaid: true,
        grandTotal: true,
        createdAt: true,
        payments: {
          select: {
            paymentId: true,
            amount: true,
            method: true,
            paidAt: true,
            referenceNo: true,
          },
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    res.json(
      invoices.map((invoice) => ({
        ...invoice,
        amountDue: invoice.amountDue.toString(),
        amountPaid: invoice.amountPaid.toString(),
        grandTotal: invoice.grandTotal.toString(),
        payments: invoice.payments.map((payment) => ({
          ...payment,
          amount: payment.amount.toString(),
        })),
      }))
    );
  }
);

const facilityQuerySchema = z.object({
  type: z.nativeEnum(FacilityType).optional(),
  city: z.string().optional(),
});

router.get('/facilities', async (req: Request, res: Response) => {
  const parsed = facilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { type, city } = parsed.data;

  const where: Prisma.FacilityWhereInput = {};
  if (type) {
    where.type = type;
  }
  if (city) {
    where.city = { equals: city, mode: 'insensitive' };
  }

  const facilities = await prisma.facility.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  res.json(facilities);
});

const specialistQuerySchema = z.object({
  query: z.string().optional(),
  department: z.string().optional(),
});

router.get('/specialists', async (req: Request, res: Response) => {
  const parsed = specialistQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { query, department } = parsed.data;

  const where: Prisma.DoctorWhereInput = {};
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { department: { contains: query, mode: 'insensitive' } },
    ];
  }
  if (department) {
    where.department = { contains: department, mode: 'insensitive' };
  }

  const doctors = await prisma.doctor.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      doctorId: true,
      name: true,
      department: true,
    },
  });

  res.json(doctors);
});

export default router;
