import { Router, type Response } from 'express';
import { PrismaClient, type AppointmentStatus } from '@prisma/client';
import { z } from 'zod';

import { requireAuth, requirePatient, type AuthRequest } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

const prisma = new PrismaClient();
const router = Router();

const facilityQuerySchema = z.object({
  type: z.enum(['GPClinic', 'Hospital']).optional(),
  search: z.string().trim().min(1).optional(),
});

type FacilityQuery = z.infer<typeof facilityQuerySchema>;

router.get(
  '/facilities',
  validate({ query: facilityQuerySchema }),
  async (req, res: Response) => {
    const { type, search } = req.query as FacilityQuery;
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

    const enriched = facilities.map((facility) => {
      const latitude = facility.latitude ? Number(facility.latitude) : null;
      const longitude = facility.longitude ? Number(facility.longitude) : null;
      const mapTarget = latitude && longitude
        ? `${latitude},${longitude}`
        : `${facility.name} ${facility.city} ${facility.state}`;

      return {
        ...facility,
        latitude,
        longitude,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapTarget)}`,
      };
    });

    res.json(enriched);
  }
);

const specialistQuerySchema = z.object({
  department: z.string().trim().min(1).optional(),
  facilityId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
});

type SpecialistQuery = z.infer<typeof specialistQuerySchema>;

router.get(
  '/specialists',
  validate({ query: specialistQuerySchema }),
  async (req, res: Response) => {
    const { department, facilityId, search } = req.query as SpecialistQuery;
    const doctors = await prisma.doctor.findMany({
      where: {
        ...(department ? { department: { contains: department, mode: 'insensitive' } } : {}),
        ...(facilityId ? { facilityId } : {}),
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
        facility: {
          select: {
            facilityId: true,
            name: true,
            city: true,
            state: true,
            phone: true,
          },
        },
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
  }
);

router.use(requireAuth);
router.use(requirePatient);

const appointmentCreateSchema = z.object({
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

router.get('/profile', async (req: AuthRequest, res: Response) => {
  const patientId = req.user!.patientId!;
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
      appointments: {
        where: { status: { not: 'Cancelled' } },
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
      },
      visits: {
        orderBy: { visitDate: 'desc' },
        take: 3,
        select: {
          visitId: true,
          visitDate: true,
          department: true,
          doctor: { select: { name: true } },
        },
      },
      invoices: {
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
      },
      immunizations: {
        orderBy: { administeredAt: 'desc' },
        take: 1,
        select: {
          vaccineName: true,
          administeredAt: true,
          nextDueDate: true,
        },
      },
    },
  });

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const { upcoming, past } = splitAppointments(patient.appointments);
  const invoiceSummary = patient.invoices.reduce(
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
    recentVisits: patient.visits,
    invoiceSummary,
    latestImmunization: patient.immunizations[0] ?? null,
  });
});

router.get('/appointments', async (req: AuthRequest, res: Response) => {
  const patientId = req.user!.patientId!;
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
  async (req: AuthRequest, res: Response) => {
    const patientId = req.user!.patientId!;
    const body = req.body as AppointmentCreateInput;
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

router.get('/labs', async (req: AuthRequest, res: Response) => {
  const patientId = req.user!.patientId!;
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
          doctor: { select: { name: true } },
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

router.get('/immunizations', async (req: AuthRequest, res: Response) => {
  const patientId = req.user!.patientId!;
  const immunizations = await prisma.immunization.findMany({
    where: { patientId },
    orderBy: { administeredAt: 'desc' },
    take: 25,
    select: {
      immunizationId: true,
      vaccineName: true,
      manufacturer: true,
      lotNumber: true,
      doseNumber: true,
      administeredAt: true,
      provider: true,
      nextDueDate: true,
      notes: true,
    },
  });

  res.json(immunizations);
});

router.get('/radiology', async (req: AuthRequest, res: Response) => {
  const patientId = req.user!.patientId!;
  const reports = await prisma.radiologyReport.findMany({
    where: { patientId },
    orderBy: { performedAt: 'desc' },
    take: 25,
    select: {
      reportId: true,
      modality: true,
      bodyPart: true,
      reportText: true,
      impressions: true,
      performedAt: true,
      radiologist: true,
      visit: {
        select: {
          visitId: true,
          visitDate: true,
          department: true,
          doctor: { select: { name: true } },
        },
      },
    },
  });

  res.json(reports);
});

router.get('/payments', async (req: AuthRequest, res: Response) => {
  const patientId = req.user!.patientId!;
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
