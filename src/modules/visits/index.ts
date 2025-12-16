import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthRequest } from '../auth/index.js';
import { logDataChange } from '../audit/index.js';
import { validate } from '../../middleware/validate.js';
import { CreateRxSchema, type CreateRxInput } from '../../validation/pharmacy.js';
import { createPrescription } from '../../services/pharmacyService.js';

const prisma = new PrismaClient();
const router = Router();

const diagnosisSchema = z.object({
  diagnosis: z.string().min(1),
});

const medicationSchema = z.object({
  drugName: z.string().min(1),
  dosage: z.string().optional(),
  instructions: z.string().optional(),
});

const labResultSchema = z.object({
  testName: z.string().min(1),
  resultValue: z.number().optional(),
  unit: z.string().optional(),
  referenceRange: z.string().optional(),
  testDate: z.coerce.date().optional(),
});

const observationSchema = z.object({
  noteText: z.string().min(1),
  bpSystolic: z.coerce.number().int().optional(),
  bpDiastolic: z.coerce.number().int().optional(),
  heartRate: z.coerce.number().int().optional(),
  temperatureC: z.coerce.number().optional(),
  spo2: z.coerce.number().int().optional(),
  bmi: z.coerce.number().optional(),
});

const visitSchema = z.object({
  patientId: z.string().uuid(),
  visitDate: z.coerce.date(),
  doctorId: z.string().uuid(),
  department: z.string(),
  reason: z.string().optional(),
  diagnoses: z.array(diagnosisSchema).optional(),
  medications: z.array(medicationSchema).optional(),
  labResults: z.array(labResultSchema).optional(),
  observations: z.array(observationSchema).optional(),
});

router.post('/visits', requireAuth, requireRole('Doctor'), async (req: AuthRequest, res: Response) => {
  const parsed = visitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { diagnoses, medications, labResults, observations, ...visitData } = parsed.data;
  const data: any = { ...visitData };
  if (diagnoses && diagnoses.length) {
    data.diagnoses = { create: diagnoses };
  }
  if (medications && medications.length) {
    data.medications = { create: medications };
  }
  if (labResults && labResults.length) {
    data.labResults = { create: labResults };
  }
  if (observations && observations.length) {
    data.observations = {
      create: observations.map((o) => ({
        ...o,
        patientId: visitData.patientId,
        doctorId: visitData.doctorId,
      })),
    };
  }
  const visit = await prisma.visit.create({
    data,
    include: {
      doctor: { select: { doctorId: true, name: true, department: true } },
      diagnoses: { orderBy: { createdAt: 'desc' } },
      medications: { orderBy: { createdAt: 'desc' } },
      labResults: { orderBy: { createdAt: 'desc' } },
      observations: { orderBy: { createdAt: 'desc' } },
    },
  });
  await logDataChange(req.user!.userId, 'visit', visit.visitId, undefined, visit);
  for (const d of visit.diagnoses) {
    await logDataChange(req.user!.userId, 'diagnosis', d.diagId, undefined, d);
  }
  for (const m of visit.medications) {
    await logDataChange(req.user!.userId, 'medication', m.medId, undefined, m);
  }
  for (const l of visit.labResults) {
    await logDataChange(req.user!.userId, 'lab', l.labId, undefined, l);
  }
  for (const o of visit.observations) {
    await logDataChange(req.user!.userId, 'observation', o.obsId, undefined, o);
  }

  // Notify Atenxion agent about visit creation (doctor-specific)
  try {
    const { recordAtenxionTransactionForDoctor } = await import('../../services/atenxion.js');
    await recordAtenxionTransactionForDoctor(visitData.doctorId);
    console.log('Atenxion transaction recorded for visit creation:', visit.visitId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for visit creation:', error);
  }

  res.status(201).json(visit);
});

router.get('/patients/:id/visits', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  const visits = await prisma.visit.findMany({
    where: { patientId: id },
    orderBy: { visitDate: 'desc' },
    include: { doctor: { select: { doctorId: true, name: true, department: true } } },
  });

  // Fetch appointments for each visit to get time information
  const visitsWithAppointments = await Promise.all(
    visits.map(async (visit) => {
      // Find matching appointment by patientId, doctorId, and date
      const visitDateOnly = new Date(visit.visitDate);
      visitDateOnly.setHours(0, 0, 0, 0);
      const nextDay = new Date(visitDateOnly);
      nextDay.setDate(nextDay.getDate() + 1);

      const appointment = await prisma.appointment.findFirst({
        where: {
          patientId: visit.patientId,
          doctorId: visit.doctorId,
          date: {
            gte: visitDateOnly,
            lt: nextDay,
          },
          status: { in: ['Completed', 'InProgress', 'CheckedIn'] },
        },
        select: {
          startTimeMin: true,
          endTimeMin: true,
        },
        orderBy: { startTimeMin: 'asc' },
      });

      return {
        ...visit,
        appointment: appointment ? {
          startTimeMin: appointment.startTimeMin,
          endTimeMin: appointment.endTimeMin,
        } : null,
      };
    })
  );

  res.json(visitsWithAppointments);
});

router.get('/visits/:id', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  const visit = await prisma.visit.findUnique({
    where: { visitId: id },
    include: {
      doctor: { select: { doctorId: true, name: true, department: true } },
      diagnoses: { orderBy: { createdAt: 'desc' } },
      medications: { orderBy: { createdAt: 'desc' } },
      labResults: { orderBy: { createdAt: 'desc' } },
      observations: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!visit) return res.sendStatus(404);
  res.json(visit);
});

router.post(
  '/visits/:visitId/prescriptions',
  requireAuth,
  requireRole('Doctor', 'Pharmacist'),
  validate({ body: CreateRxSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const visitId = req.params.visitId;
      const payload = req.body as CreateRxInput;

      const visit = await prisma.visit.findUnique({
        where: { visitId },
        select: { visitId: true, patientId: true, doctorId: true },
      });

      if (!visit) {
        return res.status(404).json({ error: 'Visit not found' });
      }

      if (req.user?.doctorId && req.user.doctorId !== visit.doctorId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const patientId = payload.patientId ?? visit.patientId;
      const { prescription, allergyHits } = await createPrescription(
        visitId,
        visit.doctorId,
        patientId,
        payload,
      );

      res.status(201).json({ prescription, allergyHits });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
