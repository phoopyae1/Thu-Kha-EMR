import { Router, type Response, type Request } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient, type AppointmentStatus } from '@prisma/client';
import { z } from 'zod';

import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole, type AuthRequest } from '../auth/index.js';
import { toDateOnly } from '../../utils/time.js';
import { medicationOrderSelect } from '../../services/medicationOrderService.js';

const prisma = new PrismaClient();
const router = Router();

const staffRouter = Router();

const portalAccountSelect = {
  accountId: true,
  patientId: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const portalPatientParams = z.object({
  patientId: z.string().uuid(),
});

const portalAccountParams = z.object({
  accountId: z.string().uuid(),
});

const portalAccountCreateSchema = z.object({
  patientId: z.string().uuid(),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const portalAccountUpdateSchema = z.object({
  email: z.string().trim().email().optional(),
  password: z.string().min(8).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const portalAccountRegisterSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
  dob: z.coerce.date(),
  contact: z.string().trim().min(1),
  insurance: z.string().trim().min(1).optional(),
  drugAllergies: z.string().trim().min(1).optional(),
});

const medicationOrderCreateSchema = z
  .object({
    patientId: z.string().uuid(),
    prescriptionId: z.string().uuid().optional(),
    drugName: z.string().trim().min(1).optional(),
    dosage: z.string().trim().min(1).optional(),
    instructions: z.string().trim().min(1).optional(),
    quantity: z.coerce.number().int().positive().max(10000).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.prescriptionId) {
      const name = value.drugName?.trim() ?? '';
      if (!name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'drugName is required when no prescriptionId is provided',
          path: ['drugName'],
        });
      }
    }
  });

const medicationOrderPatientParams = z.object({
  patientId: z.string().uuid(),
});

staffRouter.use(requireAuth);
staffRouter.use(requireRole('AdminAssistant', 'ITAdmin'));

staffRouter.get(
  '/:patientId',
  validate({ params: portalPatientParams }),
  async (req: AuthRequest, res: Response) => {
    const { patientId } = req.params as z.infer<typeof portalPatientParams>;

    const patient = await prisma.patient.findUnique({
      where: { patientId },
      select: { patientId: true },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const account = await prisma.patientPortalAccount.findUnique({
      where: { patientId },
      select: portalAccountSelect,
    });

    res.json({ account });
  },
);

staffRouter.post(
  '/',
  validate({ body: portalAccountCreateSchema }),
  async (req: AuthRequest, res: Response) => {
    const { patientId, email, password } = req.body as z.infer<typeof portalAccountCreateSchema>;
    const normalizedEmail = email.toLowerCase();

    const patient = await prisma.patient.findUnique({
      where: { patientId },
      select: { patientId: true },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const existingByPatient = await prisma.patientPortalAccount.findUnique({
      where: { patientId },
      select: { accountId: true },
    });

    if (existingByPatient) {
      return res.status(409).json({ error: 'Patient already has a portal account' });
    }

    const existingByEmail = await prisma.patientPortalAccount.findUnique({
      where: { email: normalizedEmail },
      select: { accountId: true },
    });

    if (existingByEmail) {
      return res.status(409).json({ error: 'Email is already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const account = await prisma.patientPortalAccount.create({
      data: {
        patientId,
        email: normalizedEmail,
        passwordHash,
        status: 'active',
      },
      select: portalAccountSelect,
    });

    res.status(201).json({ account });
  },
);

staffRouter.patch(
  '/:accountId',
  validate({ params: portalAccountParams, body: portalAccountUpdateSchema }),
  async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params as z.infer<typeof portalAccountParams>;
    const { email, password, status } = req.body as z.infer<typeof portalAccountUpdateSchema>;

    const existing = await prisma.patientPortalAccount.findUnique({
      where: { accountId },
      select: portalAccountSelect,
    });

    if (!existing) {
      return res.status(404).json({ error: 'Portal account not found' });
    }

    const updates: Record<string, unknown> = {};

    if (typeof email === 'string') {
      const normalizedEmail = email.toLowerCase();
      if (normalizedEmail !== existing.email) {
        const conflict = await prisma.patientPortalAccount.findFirst({
          where: {
            email: normalizedEmail,
            NOT: { accountId },
          },
          select: { accountId: true },
        });

        if (conflict) {
          return res.status(409).json({ error: 'Email is already in use' });
        }

        updates.email = normalizedEmail;
      }
    }

    if (typeof status === 'string' && status !== existing.status) {
      updates.status = status;
    }

    if (typeof password === 'string') {
      updates.passwordHash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No changes supplied' });
    }

    const account = await prisma.patientPortalAccount.update({
      where: { accountId },
      data: updates,
      select: portalAccountSelect,
    });

    res.json({ account });
  },
);

router.use('/accounts', staffRouter);

router.post('/register', async (req: Request, res: Response) => {
  const parsed = portalAccountRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, email, password, dob, contact, insurance, drugAllergies } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existingAccount = await prisma.patientPortalAccount.findUnique({
    where: { email: normalizedEmail },
    select: { accountId: true },
  });

  if (existingAccount) {
    return res.status(409).json({ error: 'An account already exists for that email address' });
  }

  const existingPatient = await prisma.patient.findFirst({
    where: {
      OR: [
        { AND: [{ dob }, { name: { equals: name, mode: 'insensitive' } }] },
        { AND: [{ dob }, { contact: { equals: contact, mode: 'insensitive' } }] },
      ],
    },
    select: {
      patientId: true,
      contact: true,
      insurance: true,
      drugAllergies: true,
      portalAccount: { select: { accountId: true } },
    },
  });

  if (existingPatient?.portalAccount) {
    return res.status(409).json({ error: 'A portal account already exists for this patient' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { patient, account } = await prisma.$transaction(async (tx) => {
    const patientRecord = existingPatient
      ? await tx.patient.update({
          where: { patientId: existingPatient.patientId },
        data: {
          contact,
          ...(typeof insurance === 'string' ? { insurance } : {}),
          ...(typeof drugAllergies === 'string' ? { drugAllergies } : {}),
        },
        select: {
            patientId: true,
            name: true,
            dob: true,
            contact: true,
            insurance: true,
            drugAllergies: true,
          },
        })
      : await tx.patient.create({
          data: {
            name,
            dob,
            gender: 'M',
            contact,
            ...(typeof insurance === 'string' ? { insurance } : {}),
            ...(typeof drugAllergies === 'string' ? { drugAllergies } : {}),
          },
          select: {
            patientId: true,
            name: true,
            dob: true,
            contact: true,
            insurance: true,
            drugAllergies: true,
          },
        });

    const createdAccount = await tx.patientPortalAccount.create({
      data: {
        patientId: patientRecord.patientId,
        email: normalizedEmail,
        passwordHash,
        status: 'active',
      },
      select: portalAccountSelect,
    });

    return { patient: patientRecord, account: createdAccount };
  });

  res.status(201).json({
    message: 'Account created successfully. You can now sign in to your patient portal.',
    account,
    patient,
  });
});

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

  // Get current medications (from visits)
  const medicines = await prisma.medication.findMany({
    where: {
      visit: {
        patientId: patientId
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      medId: true,
      drugName: true,
      dosage: true,
      instructions: true,
      createdAt: true,
      visit: {
        select: {
          visitDate: true,
          doctor: {
            select: {
              name: true,
              department: true,
            },
          },
        },
      },
    },
  });

  // Get prescriptions with items
  const prescriptions = await prisma.prescription.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      prescriptionId: true,
      status: true,
      notes: true,
      createdAt: true,
      doctor: {
        select: {
          name: true,
          department: true,
        },
      },
      items: {
        select: {
          itemId: true,
          dose: true,
          route: true,
          frequency: true,
          durationDays: true,
          quantityPrescribed: true,
          prn: true,
          notes: true,
          drug: {
            select: {
              name: true,
              genericName: true,
            },
          },
        },
      },
    },
  });

  // Get medication orders
  const medicationOrders = await prisma.medicationOrder.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      orderId: true,
      drugName: true,
      dosage: true,
      instructions: true,
      quantity: true,
      status: true,
      notes: true,
      createdAt: true,
      approvedAt: true,
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
    medicines: medicines.map(med => ({
      medId: med.medId,
      drugName: med.drugName,
      dosage: med.dosage,
      instructions: med.instructions,
      visitDate: med.visit.visitDate,
      doctor: {
        name: med.visit.doctor.name,
        department: med.visit.doctor.department,
      },
      createdAt: med.createdAt,
    })),
    prescriptions: prescriptions.map(pres => ({
      prescriptionId: pres.prescriptionId,
      status: pres.status,
      notes: pres.notes,
      createdAt: pres.createdAt,
      doctor: {
        name: pres.doctor.name,
        department: pres.doctor.department,
      },
      items: pres.items.map(item => ({
        itemId: item.itemId,
        drugName: item.drug.name,
        genericName: item.drug.genericName,
        dose: item.dose,
        route: item.route,
        frequency: item.frequency,
        durationDays: item.durationDays,
        quantityPrescribed: item.quantityPrescribed,
        prn: item.prn,
        notes: item.notes,
      })),
    })),
    medicationOrders: medicationOrders.map(order => ({
      orderId: order.orderId,
      drugName: order.drugName,
      dosage: order.dosage,
      instructions: order.instructions,
      quantity: order.quantity,
      status: order.status,
      notes: order.notes,
      createdAt: order.createdAt,
      approvedAt: order.approvedAt,
    })),
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

    const dateOnly = toDateOnly(body.date.toISOString().slice(0, 10));

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
        .json({ error: 'This time slot is already booked. Please choose a different time.' });
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

router.get('/prescriptions/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const prescriptions = await prisma.prescription.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      prescriptionId: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      doctor: {
        select: {
          doctorId: true,
          name: true,
          department: true,
        },
      },
      visit: {
        select: {
          visitId: true,
          visitDate: true,
          department: true,
        },
      },
      items: {
        select: {
          itemId: true,
          dose: true,
          route: true,
          frequency: true,
          durationDays: true,
          quantityPrescribed: true,
          prn: true,
          notes: true,
          drug: {
            select: {
              drugId: true,
              name: true,
              strength: true,
              form: true,
            },
          },
        },
      },
      dispenses: {
        orderBy: { createdAt: 'desc' },
        select: {
          dispenseId: true,
          status: true,
          dispensedAt: true,
          createdAt: true,
        },
      },
    },
  });

  res.json(
    prescriptions.map((prescription) => ({
      ...prescription,
      items: prescription.items.map((item) => ({
        ...item,
        drug: item.drug
          ? {
              ...item.drug,
            }
          : null,
      })),
    })),
  );
});

router.post(
  '/orders',
  validate({ body: medicationOrderCreateSchema }),
  async (req: Request, res: Response) => {
    const payload = req.body as z.infer<typeof medicationOrderCreateSchema>;
    const { patientId, prescriptionId } = payload;

    const patient = await prisma.patient.findUnique({
      where: { patientId },
      select: { patientId: true },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    let derivedDrugName: string | null = null;
    if (prescriptionId) {
      const prescription = await prisma.prescription.findUnique({
        where: { prescriptionId },
        select: {
          prescriptionId: true,
          patientId: true,
          items: {
            orderBy: { itemId: 'asc' },
            take: 1,
            select: {
              drug: {
                select: {
                  name: true,
                  strength: true,
                },
              },
            },
          },
        },
      });

      if (!prescription || prescription.patientId !== patientId) {
        return res.status(400).json({ error: 'Prescription not found for this patient' });
      }

      const firstDrug = prescription.items[0]?.drug;
      if (firstDrug) {
        const parts = [firstDrug.name, firstDrug.strength].filter(
          (part) => typeof part === 'string' && part.trim().length > 0,
        );
        derivedDrugName = parts.length ? parts.join(' ') : null;
      }
    }

    const trimmedDrugName = typeof payload.drugName === 'string' ? payload.drugName.trim() : undefined;
    const trimmedDosage = typeof payload.dosage === 'string' ? payload.dosage.trim() : undefined;
    const trimmedInstructions =
      typeof payload.instructions === 'string' ? payload.instructions.trim() : undefined;
    const trimmedNotes = typeof payload.notes === 'string' ? payload.notes.trim() : undefined;

    const order = await prisma.medicationOrder.create({
      data: {
        patientId,
        prescriptionId: prescriptionId ?? null,
        drugName: trimmedDrugName ?? derivedDrugName,
        dosage: trimmedDosage ?? null,
        instructions: trimmedInstructions ?? null,
        quantity: payload.quantity ?? null,
        notes: trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null,
      },
      select: medicationOrderSelect,
    });

    res.status(201).json(order);
  },
);

router.get('/orders/:patientId', async (req: Request, res: Response) => {
  const parsed = medicationOrderPatientParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const { patientId } = parsed.data;

  const patient = await prisma.patient.findUnique({
    where: { patientId },
    select: { patientId: true },
  });

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const orders = await prisma.medicationOrder.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: medicationOrderSelect,
  });

  res.json(orders);
});

router.get('/medications/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  const medications = await prisma.medication.findMany({
    where: { visit: { patientId } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      medId: true,
      drugName: true,
      dosage: true,
      instructions: true,
      createdAt: true,
      visit: {
        select: {
          visitId: true,
          visitDate: true,
          department: true,
          doctor: {
            select: { name: true },
          },
        },
      },
    },
  });

  const formatted = medications.map((medication) => ({
    ...medication,
    visit: medication.visit
      ? {
          ...medication.visit,
          visitDate: medication.visit.visitDate,
        }
      : null,
  }));

  res.json(formatted);
});

// Comprehensive endpoint that returns ALL patient data in one call
router.get('/complete/:patientId', async (req: Request, res: Response) => {
  const { patientId } = req.params;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  try {
    // Fetch patient demographics
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

    // Fetch all data in parallel for performance
    const [
      appointments,
      visits,
      invoices,
      immunizations,
      labResults,
      radiologyReports,
      medications,
      prescriptions,
      medicationOrders,
    ] = await Promise.all([
      // Appointments
      prisma.appointment.findMany({
        where: { patientId, status: { not: 'Cancelled' } },
        orderBy: { date: 'asc' },
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
      }),

      // Visits
      prisma.visit.findMany({
        where: { patientId },
        orderBy: { visitDate: 'desc' },
        take: 10,
        select: {
          visitId: true,
          visitDate: true,
          department: true,
          doctor: { select: { name: true } },
        },
      }),

      // Invoices
      prisma.invoice.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          Visit: {
            select: {
              visitId: true,
              visitDate: true,
              department: true,
              doctor: {
                select: {
                  doctorId: true,
                  name: true,
                  department: true,
                },
              },
            },
          },
          items: {
            select: {
              itemId: true,
              description: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              sourceType: true,
              sourceRefId: true,
            },
          },
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
      }),

      // Immunizations
      prisma.immunizationRecord.findMany({
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
      }),

      // Lab Results
      prisma.labResult.findMany({
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
      }),

      // Radiology Reports
      prisma.radiologyReport.findMany({
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
      }),

      // Medications
      prisma.medication.findMany({
        where: { visit: { patientId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          medId: true,
          drugName: true,
          dosage: true,
          instructions: true,
          createdAt: true,
          visit: {
            select: {
              visitId: true,
              visitDate: true,
              department: true,
              doctor: {
                select: { name: true },
              },
            },
          },
        },
      }),

      // Prescriptions
      prisma.prescription.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          prescriptionId: true,
          status: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          doctor: {
            select: {
              doctorId: true,
              name: true,
              department: true,
            },
          },
          visit: {
            select: {
              visitId: true,
              visitDate: true,
              department: true,
            },
          },
          items: {
            select: {
              itemId: true,
              dose: true,
              route: true,
              frequency: true,
              durationDays: true,
              quantityPrescribed: true,
              prn: true,
              notes: true,
              drug: {
                select: {
                  drugId: true,
                  name: true,
                  strength: true,
                  form: true,
                },
              },
            },
          },
          dispenses: {
            orderBy: { createdAt: 'desc' },
            select: {
              dispenseId: true,
              status: true,
              dispensedAt: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.medicationOrder.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: medicationOrderSelect,
      }),
    ]);

    // Split appointments into upcoming and past
    const { upcoming, past } = splitAppointments(appointments);

    // Calculate invoice summary
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

    // Format lab results (convert Decimal to Number)
    const formattedLabs = labResults.map((result) => ({
      ...result,
      resultValueNum: result.resultValueNum ? Number(result.resultValueNum) : null,
      referenceLow: result.referenceLow ? Number(result.referenceLow) : null,
      referenceHigh: result.referenceHigh ? Number(result.referenceHigh) : null,
    }));

    // Format invoices (convert Decimal to Number)
    const formattedInvoices = invoices.map((invoice: any) => ({
      invoiceId: invoice.invoiceId,
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      grandTotal: Number(invoice.grandTotal),
      amountPaid: Number(invoice.amountPaid),
      amountDue: Number(invoice.amountDue),
      subTotal: Number(invoice.subTotal),
      discountAmt: Number(invoice.discountAmt),
      taxAmt: Number(invoice.taxAmt),
      note: invoice.note,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      visit: invoice.Visit || null,
      items: (invoice.items || []).map((item: any) => ({
        itemId: item.itemId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
        sourceType: item.sourceType,
        sourceRefId: item.sourceRefId,
      })),
      payments: (invoice.payments || []).map((payment: any) => ({
        paymentId: payment.paymentId,
        method: payment.method,
        amount: Number(payment.amount),
        paidAt: payment.paidAt,
        referenceNo: payment.referenceNo,
        note: payment.note,
      })),
    }));

    // Prepare comprehensive response
    const response = {
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
      visits: visits,
      prescriptions: prescriptions,
      medicationOrders,
      medications: medications,
      labs: formattedLabs,
      immunizations: immunizations,
      radiology: radiologyReports,
      billing: {
        summary: invoiceSummary,
        invoices: formattedInvoices,
      },
      latestImmunization: immunizations[0] ?? null,
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching complete patient data:', error);
    res.status(500).json({ error: 'Failed to fetch patient data' });
  }
});

export default router;
