import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';
import { logDataChange } from '../audit/index.js';

const prisma = new PrismaClient();
const router = Router();

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);
}

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MIN || '1') * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_MAX || '100'),
});

function maskContact(contact?: string | null) {
  if (!contact) return contact;
  return contact.replace(/.(?=.{2})/g, '*');
}

router.get(
  '/',
  requireAuth,
  limiter,
  validate({
    query: z.object({
      query: z.string().min(1),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  }),
  async (req: Request, res: Response) => {
    const q = req.query.query as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;
    const trimmed = q.trim();
    const lowerQ = trimmed.toLowerCase();
    const likeTerm = `%${trimmed}%`;

    const filters = [
      Prisma.sql`lower(name) % ${lowerQ}`,
      Prisma.sql`"patientId"::text ILIKE ${likeTerm}`,
      Prisma.sql`(insurance IS NOT NULL AND insurance ILIKE ${likeTerm})`,
    ];

    if (isUuid(trimmed)) {
      filters.push(Prisma.sql`"patientId" = ${trimmed}`);
    }

    const whereClause = Prisma.join(filters, ' OR ');

    type RawPatient = {
      patientId: string;
      name: string;
      dob: Date;
      insurance: string | null;
      name_similarity: number;
      id_match: number;
      insurance_match: number;
    };

    const rawPatients = await prisma.$queryRaw<RawPatient[]>(
      Prisma.sql`
        SELECT
          "patientId",
          name,
          dob,
          insurance,
          similarity(lower(name), ${lowerQ}) AS name_similarity,
          CASE WHEN "patientId"::text ILIKE ${likeTerm} THEN 1 ELSE 0 END AS id_match,
          CASE WHEN insurance ILIKE ${likeTerm} THEN 1 ELSE 0 END AS insurance_match
        FROM "Patient"
        WHERE ${whereClause}
        ORDER BY
          id_match DESC,
          name_similarity DESC,
          insurance_match DESC,
          name ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const patients = rawPatients.map(({ patientId, name, dob, insurance }) => ({
      patientId,
      name,
      dob,
      insurance,
    }));

    console.log('patient search', { q: trimmed, count: patients.length });
    res.json(patients);
  }
);

const createPatientSchema = z.object({
  name: z.string().min(1),
  dob: z.coerce.date(),
  insurance: z.string().min(1),
  gender: z.enum(['M', 'F']),
  drugAllergies: z.string().min(1).optional(),
});

router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = createPatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { drugAllergies, ...patientData } = parsed.data;
  const patient = await prisma.patient.create({
    data: { ...patientData, drugAllergies: drugAllergies ?? null },
    select: { patientId: true, name: true, dob: true, insurance: true, gender: true, drugAllergies: true },
  });
  await logDataChange(req.user!.userId, 'patient', patient.patientId, undefined, patient);
  
  // Notify Atenxion agent about patient creation
  try {
    const { recordAtenxionTransaction } = await import('../../services/atenxion.js');
    await recordAtenxionTransaction(patient.patientId);
    console.log('Atenxion transaction recorded for patient creation:', patient.patientId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for patient creation:', error);
  }
  
  res.status(201).json(patient);
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const include = req.query.include === 'summary';
  const select: any = {
    patientId: true,
    name: true,
    dob: true,
    gender: true,
    contact: true,
    insurance: true,
    drugAllergies: true,
  };
  if (include) {
    select.visits = {
      orderBy: { visitDate: 'desc' },
      take: 3,
      select: {
        visitId: true,
        visitDate: true,
        doctor: { select: { doctorId: true, name: true, department: true } },
        diagnoses: { select: { diagnosis: true } },
        medications: { select: { drugName: true, dosage: true, instructions: true } },
        labResults: {
          where: { testName: { in: ['HbA1c', 'LDL'] } },
          select: { testName: true, resultValue: true, unit: true, testDate: true },
        },
        observations: {
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: {
            obsId: true,
            noteText: true,
            bpSystolic: true,
            bpDiastolic: true,
            heartRate: true,
            temperatureC: true,
            spo2: true,
            bmi: true,
            createdAt: true,
          },
        },
      },
    };
  }
  const patient = await prisma.patient.findUnique({ where: { patientId: id }, select });
  if (!patient) {
    return res.sendStatus(404);
  }
  console.log('patient detail', { patientId: id, contact: maskContact(patient.contact as unknown as string | null) });
  res.json(patient);
});

// Patient Overview - Returns past visit dates and upcoming appointment dates
router.get('/:id/overview', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id: patientId } = req.params;
    const user = req.user;

    // Security: Patients can only view their own overview
    if (user?.role === 'Patient' && user.patientId !== patientId) {
      return res.status(403).json({ error: 'Forbidden: You can only view your own overview' });
    }

    // Verify patient exists
    const patient = await prisma.patient.findUnique({
      where: { patientId },
      select: { patientId: true, name: true },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get past visits (visits before today)
    const pastVisits = await prisma.visit.findMany({
      where: {
        patientId,
        visitDate: { lt: today },
      },
      select: {
        visitId: true,
        visitDate: true,
        doctor: {
          select: {
            name: true,
            department: true,
          },
        },
      },
      orderBy: {
        visitDate: 'desc',
      },
    });

    // Get upcoming appointments (appointments from today onwards, not cancelled)
    const upcomingAppointments = await prisma.appointment.findMany({
      where: {
        patientId,
        date: { gte: today },
        status: { not: 'Cancelled' },
      },
      select: {
        appointmentId: true,
        date: true,
        startTimeMin: true,
        endTimeMin: true,
        status: true,
        reason: true,
        doctor: {
          select: {
            name: true,
            department: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
        startTimeMin: 'asc',
      },
    });

    res.json({
      patientId: patient.patientId,
      patientName: patient.name,
      pastVisits: pastVisits.map((visit) => ({
        visitId: visit.visitId,
        visitDate: visit.visitDate.toISOString().split('T')[0], // YYYY-MM-DD format
        doctorName: visit.doctor.name,
        department: visit.doctor.department,
      })),
      upcomingAppointments: upcomingAppointments.map((appointment) => {
        const hours = Math.floor(appointment.startTimeMin / 60);
        const minutes = appointment.startTimeMin % 60;
        const endHours = Math.floor(appointment.endTimeMin / 60);
        const endMinutes = appointment.endTimeMin % 60;
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
        const endPeriod = endHours >= 12 ? 'PM' : 'AM';
        const endDisplayHours = endHours > 12 ? endHours - 12 : endHours === 0 ? 12 : endHours;
        
        return {
          appointmentId: appointment.appointmentId,
          date: appointment.date.toISOString().split('T')[0], // YYYY-MM-DD format
          startTime: `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`,
          endTime: `${endDisplayHours}:${String(endMinutes).padStart(2, '0')} ${endPeriod}`,
          status: appointment.status,
          reason: appointment.reason,
          doctorName: appointment.doctor.name,
          department: appointment.doctor.department,
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching patient overview:', error);
    res.status(500).json({ error: 'Failed to fetch patient overview' });
  }
});

export default router;
