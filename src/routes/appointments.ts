import { Router, type Request, type Response, type NextFunction } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';

import {
  assertCreatable,
  assertUpdatable,
  getDoctorAvailabilityForDate,
  type AvailabilityWindow,
} from '../services/appointmentService.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, type AuthRequest } from '../modules/auth/index.js';
import {
  CreateAppointmentSchema,
  UpdateAppointmentBodySchema,
  UpdateAppointmentParamsSchema,
  PatchStatusSchema,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type PatchStatusInput,
} from '../validation/appointment.js';
import { toDateOnly } from '../utils/time.js';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  HttpError,
  NotFoundError,
  ServiceUnavailableError,
} from '../utils/httpErrors.js';
import type {
  AppPrismaClient,
  AppPrismaTransactionClient,
  AppointmentFindManyArgs,
  AppointmentStatus,
  AppointmentUpdateData,
  AppointmentWhereInput,
  DateTimeFilter,
} from '../types/appointments.js';

const prisma = new PrismaClient() as AppPrismaClient;

function assertModelExists(client: any, key: string) {
  if (!client[key]) {
    throw new Error(
      `Prisma model '${key}' is missing on PrismaClient. ` +
        "Make sure it exists in schema.prisma and run 'npx prisma generate' (and 'prisma migrate deploy' in prod)."
    );
  }
}

assertModelExists(prisma as any, 'appointment');
assertModelExists(prisma as any, 'doctorBlackout');
assertModelExists(prisma as any, 'doctorAvailability');
const router = Router();

router.use(requireAuth);

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const statusValues = ['Scheduled', 'CheckedIn', 'InProgress', 'Completed', 'Cancelled'] as const satisfies readonly AppointmentStatus[];

function isMissingRelationOrColumnError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === 'P2010') {
    const meta = error.meta as { code?: string } | undefined;
    return meta?.code === '42P01' || meta?.code === '42703';
  }

  return error.code === 'P2021' || error.code === 'P2022';
}

function isMissingTableError(error: unknown, target: RegExp): boolean {
  if (!isMissingRelationOrColumnError(error)) {
    return false;
  }

  const meta = error.meta as { table?: string; modelName?: string } | undefined;
  const name = meta?.table ?? meta?.modelName;

  if (typeof name === 'string' && target.test(name)) {
    return true;
  }

  return target.test(error.message);
}

function isMissingAppointmentsTableError(error: unknown): boolean {
  return isMissingTableError(error, /appointment/i);
}

function isMissingDoctorBlackoutsTableError(error: unknown): boolean {
  return isMissingTableError(error, /doctor.*blackout/i);
}

function createAppointmentsUnavailableError(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    'Appointments storage is not available. Please run database migrations to create the Appointment table.'
  );
}

const dateParam = z
  .coerce.string()
  .transform((value) => value.trim())
  .transform((value) => (value.includes('T') ? value.split('T')[0] : value))
  .pipe(z.string().regex(dateRegex, 'Date must be in format YYYY-MM-DD'));

const uuidParam = z.coerce.string().trim().uuid();

const limitedPositiveIntParam = z.coerce.number().int().positive().max(100);
const positiveIntParam = z.coerce.number().int().positive();

const queueQuerySchema = z.object({
  doctorId: uuidParam.optional(),
  days: z.coerce.number().int().min(1).max(7).optional(),
});

const availabilityQuerySchema = z.object({
  doctorId: uuidParam,
  date: dateParam,
});

type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

const listQuerySchema = z.object({
  date: dateParam.optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  doctorId: uuidParam.optional(),
  status: z.coerce.string().trim().pipe(z.enum(statusValues)).optional(),
  limit: limitedPositiveIntParam.optional(),
  cursor: uuidParam.optional(),
  page: positiveIntParam.optional(),
  pageSize: limitedPositiveIntParam.optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

type TimeSegment = { startMin: number; endMin: number };

router.get(
  '/availability',
  requireRole('AdminAssistant', 'Doctor'),
  validate({ query: availabilityQuerySchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { doctorId, date } = req.query as AvailabilityQuery;
      if (req.user?.role === 'Doctor') {
        if (!req.user.doctorId) {
          throw new ForbiddenError('Doctor profile is not linked to this account');
        }
        if (req.user.doctorId !== doctorId) {
          throw new ForbiddenError('You can only view your own availability');
        }
      }
      const appointmentDate = toDateOnly(date);
      const availabilityPromise = getDoctorAvailabilityForDate(
        prisma,
        doctorId,
        appointmentDate
      );
      const appointmentsPromise = (prisma.appointment
        .findMany({
          where: {
            doctorId,
            date: appointmentDate,
            status: { not: 'Cancelled' },
          },
          select: {
            startTimeMin: true,
            endTimeMin: true,
          },
        })
        .catch((error) => {
          if (isMissingAppointmentsTableError(error)) {
            return [] as Array<{ startTimeMin: number; endTimeMin: number }>;
          }
          throw error;
        })) as Promise<Array<{ startTimeMin: number; endTimeMin: number }>>;
      const blackoutsPromise = (prisma.doctorBlackout
        .findMany({
          where: {
            doctorId,
            startAt: { lt: addDays(appointmentDate, 1) },
            endAt: { gt: appointmentDate },
          },
          select: {
            startAt: true,
            endAt: true,
          },
        })
        .catch((error) => {
          if (isMissingDoctorBlackoutsTableError(error)) {
            return [] as Array<{ startAt: Date; endAt: Date }>;
          }
          throw error;
        })) as Promise<Array<{ startAt: Date; endAt: Date }>>;

      const [availability, appointments, blackouts] = await Promise.all([
        availabilityPromise,
        appointmentsPromise,
        blackoutsPromise,
      ]);

      const dayStart = appointmentDate;
      const dayEnd = addDays(dayStart, 1);
      const blackoutSegments = blackouts
        .map((blackout) =>
          convertBlackoutToSegment(blackout.startAt, blackout.endAt, dayStart, dayEnd)
        )
        .filter((segment): segment is TimeSegment => Boolean(segment));
      const bookedSegments = appointments.map((appt) => ({
        startMin: appt.startTimeMin,
        endMin: appt.endTimeMin,
      }));
      const blockers = mergeSegments([...bookedSegments, ...blackoutSegments]);
      const freeSlots = calculateFreeSlots(availability, blockers);

      res.json({
        availability,
        blocked: blockers,
        freeSlots,
      });
    } catch (error) {
      handleError(error, next);
    }
  }
);

router.post(
  '/',
  requireRole('AdminAssistant', 'ITAdmin'),
  validate({ body: CreateAppointmentSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateAppointmentInput;
      await assertCreatable(prisma, body);
      const appointment = await prisma.appointment.create({
        data: {
          patientId: body.patientId,
          doctorId: body.doctorId,
          department: body.department,
          date: toDateOnly(body.date),
          startTimeMin: body.startTimeMin,
          endTimeMin: body.endTimeMin,
          reason: body.reason ?? null,
          location: body.location ?? null,
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Notify Atenxion agent about appointment creation
      try {
        const { recordAtenxionTransaction } = await import('../services/atenxion.js');
        await recordAtenxionTransaction(body.patientId);
        console.log('Atenxion transaction recorded for appointment creation:', appointment.appointmentId);
      } catch (error) {
        console.warn('Failed to record Atenxion transaction for appointment creation:', error);
      }

      res.status(201).json(appointment);
    } catch (error) {
      handleError(error, next);
    }
  }
);

router.put(
  '/:appointmentId',
  requireRole('AdminAssistant', 'ITAdmin'),
  validate({ params: UpdateAppointmentParamsSchema, body: UpdateAppointmentBodySchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { appointmentId } = req.params as z.infer<typeof UpdateAppointmentParamsSchema>;
      const body = req.body as UpdateAppointmentInput;

      await assertUpdatable(prisma, appointmentId, body);

      const data: AppointmentUpdateData = {};
      if (body.patientId) data.patientId = body.patientId;
      if (body.doctorId) data.doctorId = body.doctorId;
      if (body.department) data.department = body.department;
      if (body.date) data.date = toDateOnly(body.date);
      if (typeof body.startTimeMin === 'number') data.startTimeMin = body.startTimeMin;
      if (typeof body.endTimeMin === 'number') data.endTimeMin = body.endTimeMin;
      if (body.reason !== undefined) data.reason = body.reason;
      if (body.location !== undefined) data.location = body.location;

      const appointment = await prisma.appointment.update({
        where: { appointmentId },
        data,
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Notify Atenxion agent about appointment update
      try {
        const { recordAtenxionTransaction } = await import('../services/atenxion.js');
        await recordAtenxionTransaction(appointment.patient.patientId);
        console.log('Atenxion transaction recorded for appointment update:', appointmentId);
      } catch (error) {
        console.warn('Failed to record Atenxion transaction for appointment update:', error);
      }

      res.json(appointment);
    } catch (error) {
      handleError(error, next);
    }
  }
);

const allowedTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  Scheduled: ['CheckedIn', 'Cancelled'],
  CheckedIn: ['InProgress', 'Cancelled'],
  InProgress: ['Completed'],
  Completed: [],
  Cancelled: [],
};

router.patch(
  '/:appointmentId/status',
  requireRole('Doctor', 'AdminAssistant'),
  validate({
    params: UpdateAppointmentParamsSchema,
    body: PatchStatusSchema,
  }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { appointmentId } = req.params as z.infer<typeof UpdateAppointmentParamsSchema>;
      const body = req.body as PatchStatusInput;

      const appointment = await prisma.appointment.findUnique({
        where: { appointmentId },
      });

      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      const user = req.user!;
      if (user.role === 'Doctor') {
        if (!user.doctorId) {
          throw new ForbiddenError('Doctor profile is not linked to this account');
        }
        if (appointment.doctorId !== user.doctorId) {
          throw new ForbiddenError('You can only update your own appointments');
        }
      }

      const targetStatus = body.status;
      if ((targetStatus === 'InProgress' || targetStatus === 'Completed') && user.role !== 'Doctor' && user.role !== 'ITAdmin') {
        throw new ForbiddenError('Only doctors can start or complete visits');
      }

      if (targetStatus === 'CheckedIn' && user.role === 'Doctor' && !user.doctorId) {
        throw new ForbiddenError('Doctor profile is not linked to this account');
      }

      if (body.status !== appointment.status) {
        const currentStatus = appointment.status as AppointmentStatus;
        const allowed = allowedTransitions[currentStatus] ?? [];
        if (!allowed.includes(body.status)) {
          throw new ConflictError('Invalid status transition');
        }
      }

      if (body.status !== 'Cancelled' && body.cancelReason) {
        throw new BadRequestError('cancelReason is only allowed when cancelling an appointment');
      }

      if (body.status === 'Completed') {
        const result = await prisma.$transaction(async (tx) => {
          const client = tx as AppPrismaTransactionClient;

          const updatedAppointment = await client.appointment.update({
            where: { appointmentId },
            data: {
              status: body.status,
              cancelReason: null,
            },
          });

          const appointmentDate = toDateOnly(
            updatedAppointment.date.toISOString().slice(0, 10)
          );

          const existingVisit = await client.visit.findFirst({
            where: {
              patientId: updatedAppointment.patientId,
              doctorId: updatedAppointment.doctorId,
              visitDate: appointmentDate,
            },
            select: { visitId: true },
          });

          if (existingVisit) {
            return existingVisit.visitId;
          }

          const visit = await client.visit.create({
            data: {
              patientId: updatedAppointment.patientId,
              doctorId: updatedAppointment.doctorId,
              visitDate: appointmentDate,
              department: updatedAppointment.department,
              reason: updatedAppointment.reason ?? undefined,
            },
            select: { visitId: true },
          });

          return visit.visitId;
        });

        // Notify Atenxion agent about appointment completion
        try {
          const { recordAtenxionTransaction } = await import('../services/atenxion.js');
          await recordAtenxionTransaction(appointment.patientId);
          console.log('Atenxion transaction recorded for appointment completion:', appointmentId);
        } catch (error) {
          console.warn('Failed to record Atenxion transaction for appointment completion:', error);
        }

        res.json({ visitId: result });
        return;
      }

      const updated = await prisma.appointment.update({
        where: { appointmentId },
        data: {
          status: body.status,
          cancelReason: body.status === 'Cancelled' ? body.cancelReason ?? null : null,
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Notify Atenxion agent about appointment status change
      try {
        const { recordAtenxionTransaction } = await import('../services/atenxion.js');
        await recordAtenxionTransaction(updated.patient.patientId);
        console.log('Atenxion transaction recorded for appointment status change:', appointmentId);
      } catch (error) {
        console.warn('Failed to record Atenxion transaction for appointment status change:', error);
      }

      res.json(updated);
    } catch (error) {
      handleError(error, next);
    }
  }
);

router.get(
  '/queue',
  requireRole('Doctor', 'AdminAssistant'),
  validate({ query: queueQuerySchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const { doctorId: requestedDoctorId, days } = req.query as z.infer<typeof queueQuerySchema>;
      let doctorId = requestedDoctorId;

      if (user.role === 'Doctor') {
        if (!user.doctorId) {
          throw new ForbiddenError('Doctor profile is not linked to this account');
        }
        doctorId = user.doctorId;
      }

      if (!doctorId) {
        return res.status(400).json({ error: 'doctorId is required' });
      }

      const doctor = await prisma.doctor.findUnique({ where: { doctorId } });
      if (!doctor) {
        throw new NotFoundError('Doctor not found');
      }

      const now = new Date();
      const windowDays = days ?? 1;
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + windowDays);

      const appointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          status: { in: ['Scheduled', 'CheckedIn', 'InProgress'] },
          date: { gte: start, lt: end },
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
        orderBy: [
          { date: 'asc' },
          { startTimeMin: 'asc' },
        ],
      });

      res.json({ data: appointments });
    } catch (error) {
      handleError(error, next);
    }
  }
);

router.get(
  '/',
  requireRole('Doctor', 'AdminAssistant'),
  validate({ query: listQuerySchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const query = req.query as ListQuery;
      const where: AppointmentWhereInput = {};

      if (query.date) {
        where.date = toDateOnly(query.date);
      } else {
        const dateFilter: DateTimeFilter = {};
        if (query.from) {
          dateFilter.gte = toDateOnly(query.from);
        }
        if (query.to) {
          const toDate = toDateOnly(query.to);
          dateFilter.lt = addDays(toDate, 1);
        }
        if (Object.keys(dateFilter).length > 0) {
          where.date = dateFilter;
        }
      }

      const user = req.user!;

      if (query.doctorId) {
        if (user.role === 'Doctor') {
          if (!user.doctorId) {
            throw new ForbiddenError('Doctor profile is not linked to this account');
          }
          if (user.doctorId !== query.doctorId) {
            throw new ForbiddenError('You can only view your own appointments');
          }
        }
        where.doctorId = query.doctorId;
      } else if (user.role === 'Doctor') {
        if (!user.doctorId) {
          throw new ForbiddenError('Doctor profile is not linked to this account');
        }
        where.doctorId = user.doctorId;
      }

      if (query.status) {
        where.status = query.status;
      }

      let take = query.limit ?? query.pageSize ?? 20;
      if (take > 100) take = 100;

      const findMany: AppointmentFindManyArgs = {
        where,
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
        orderBy: [
          { date: 'asc' },
          { startTimeMin: 'asc' },
        ],
        take,
      };

      if (query.cursor) {
        findMany.cursor = { appointmentId: query.cursor };
        findMany.skip = 1;
      } else if (query.page) {
        const pageSize = query.pageSize ?? take;
        const skip = (query.page - 1) * pageSize;
        if (skip > 0) {
          findMany.skip = skip;
        }
        findMany.take = pageSize;
      }

      const appointments = await prisma.appointment.findMany(findMany);
      const expectedPageSize = findMany.take ?? appointments.length;
      const nextCursor =
        appointments.length === expectedPageSize
          ? appointments[appointments.length - 1]?.appointmentId
          : undefined;

      res.json({ data: appointments, nextCursor });
    } catch (error) {
      handleError(error, next);
    }
  }
);

router.get(
  '/:appointmentId',
  requireRole('Doctor', 'AdminAssistant'),
  validate({ params: UpdateAppointmentParamsSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { appointmentId } = req.params as z.infer<typeof UpdateAppointmentParamsSchema>;

      const appointment = await prisma.appointment.findUnique({
        where: { appointmentId },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      if (req.user?.role === 'Doctor') {
        if (!req.user.doctorId) {
          throw new ForbiddenError('Doctor profile is not linked to this account');
        }
        if (appointment.doctorId !== req.user.doctorId) {
          throw new ForbiddenError('You can only view your own appointments');
        }
      }

      res.json(appointment);
    } catch (error) {
      handleError(error, next);
    }
  }
);

router.delete(
  '/:appointmentId',
  requireRole('AdminAssistant', 'ITAdmin'),
  validate({ params: UpdateAppointmentParamsSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { appointmentId } = req.params as z.infer<typeof UpdateAppointmentParamsSchema>;
      await prisma.appointment.delete({ where: { appointmentId } });
      res.status(204).send();
    } catch (error) {
      handleError(error, next);
    }
  }
);

function handleError(error: unknown, next: NextFunction) {
  if (isMissingAppointmentsTableError(error)) {
    next(createAppointmentsUnavailableError());
    return;
  }

  if (error instanceof HttpError) {
    next(error);
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    next(new NotFoundError('Appointment not found'));
    return;
  }

  if (error instanceof Error) {
    if (/not found/i.test(error.message)) {
      next(new NotFoundError(error.message));
      return;
    }
    next(new BadRequestError(error.message));
    return;
  }

  next(error as Error);
}

function convertBlackoutToSegment(
  startAt: Date,
  endAt: Date,
  dayStart: Date,
  dayEnd: Date
): TimeSegment | null {
  const clampedStart = Math.max(startAt.getTime(), dayStart.getTime());
  const clampedEnd = Math.min(endAt.getTime(), dayEnd.getTime());
  if (clampedEnd <= clampedStart) {
    return null;
  }

  const minute = 60 * 1000;
  const startMin = Math.max(0, Math.floor((clampedStart - dayStart.getTime()) / minute));
  const endMin = Math.min(1440, Math.ceil((clampedEnd - dayStart.getTime()) / minute));

  if (endMin <= startMin) {
    return null;
  }

  return { startMin, endMin };
}

function mergeSegments(segments: TimeSegment[]): TimeSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const sorted = [...segments]
    .filter((segment) => segment.endMin > segment.startMin)
    .sort((a, b) => (a.startMin === b.startMin ? a.endMin - b.endMin : a.startMin - b.startMin));

  if (!sorted.length) {
    return [];
  }

  const merged: TimeSegment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, current.endMin);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function calculateFreeSlots(
  windows: AvailabilityWindow[],
  blockers: TimeSegment[]
): TimeSegment[] {
  const freeSlots: TimeSegment[] = [];

  for (const window of windows) {
    freeSlots.push(...subtractWindow(window, blockers));
  }

  return freeSlots;
}

function subtractWindow(
  window: AvailabilityWindow,
  blockers: TimeSegment[]
): TimeSegment[] {
  const slots: TimeSegment[] = [];
  let currentStart = window.startMin;

  for (const blocker of blockers) {
    if (blocker.endMin <= window.startMin) {
      continue;
    }

    if (blocker.startMin >= window.endMin) {
      break;
    }

    const overlapStart = Math.max(blocker.startMin, window.startMin);
    const overlapEnd = Math.min(blocker.endMin, window.endMin);

    if (overlapStart > currentStart) {
      slots.push({ startMin: currentStart, endMin: overlapStart });
    }

    currentStart = Math.max(currentStart, overlapEnd);

    if (currentStart >= window.endMin) {
      break;
    }
  }

  if (currentStart < window.endMin) {
    slots.push({ startMin: currentStart, endMin: window.endMin });
  }

  return slots.filter((slot) => slot.endMin > slot.startMin);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export default router;
