import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthRequest } from '../auth/index.js';
import { DEFAULT_AVAILABILITY_WINDOWS } from '../../services/appointmentService.js';

const prisma = new PrismaClient();
const router = Router();

const querySchema = z.object({
  department: z.string().optional(),
  q: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  department: z.string().min(1),
});

const doctorIdSchema = z.object({
  doctorId: z.string().uuid({ message: 'doctorId must be a valid UUID' }),
});

const availabilitySchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startMin: z.coerce.number().int().min(0).max(24 * 60 - 1),
    endMin: z.coerce.number().int().min(1).max(24 * 60),
  })
  .refine((data) => data.endMin > data.startMin, {
    message: 'endMin must be greater than startMin',
    path: ['endMin'],
  });

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query' });
  }
  const { department, q } = parsed.data;
  const where: any = {};
  if (department) {
    where.department = { contains: department, mode: 'insensitive' };
  }
  if (q) {
    where.name = { contains: q, mode: 'insensitive' };
  }
  const doctors = await prisma.doctor.findMany({ where, orderBy: { name: 'asc' } });
  res.json(doctors);
});

router.post('/', requireAuth, requireRole('ITAdmin'), async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const doctor = await prisma.doctor.create({ data: parsed.data });
  res.status(201).json(doctor);
});

router.get(
  '/:doctorId/availability',
  requireAuth,
  async (req: Request, res: Response) => {
    const params = doctorIdSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ message: 'Invalid doctorId' });
    }

    const { doctorId } = params.data;

    const doctor = await prisma.doctor.findUnique({
      where: { doctorId },
      select: { doctorId: true },
    });

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const availability = await prisma.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: [{ dayOfWeek: 'asc' }, { startMin: 'asc' }],
    });

    res.json({
      doctorId,
      availability,
      defaultAvailability: DEFAULT_AVAILABILITY_WINDOWS.map((window) => ({ ...window })),
    });
  }
);

router.post(
  '/:doctorId/availability',
  requireAuth,
  requireRole('ITAdmin'),
  async (req: AuthRequest, res: Response) => {
    const params = doctorIdSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ message: 'Invalid doctorId' });
    }

    const { doctorId } = params.data;

    const doctor = await prisma.doctor.findUnique({
      where: { doctorId },
      select: { doctorId: true },
    });

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const parsedBody = availabilitySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.flatten() });
    }

    const { dayOfWeek, startMin, endMin } = parsedBody.data;

    const overlap = await prisma.doctorAvailability.findFirst({
      where: {
        doctorId,
        dayOfWeek,
        startMin: { lt: endMin },
        endMin: { gt: startMin },
      },
    });

    if (overlap) {
      return res
        .status(409)
        .json({ message: 'Availability overlaps with an existing window' });
    }

    const created = await prisma.doctorAvailability.create({
      data: {
        doctorId,
        dayOfWeek,
        startMin,
        endMin,
      },
    });

    res.status(201).json(created);
  }
);

router.delete(
  '/:doctorId',
  requireAuth,
  requireRole('ITAdmin', 'AdminAssistant'),
  async (req: AuthRequest, res: Response) => {
    const params = doctorIdSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ message: 'Invalid doctorId' });
    }

    const { doctorId } = params.data;

    const doctor = await prisma.doctor.findUnique({
      where: { doctorId },
      select: { doctorId: true },
    });

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    await prisma.doctor.delete({
      where: { doctorId },
    });

    res.status(204).end();
  }
);

export default router;
