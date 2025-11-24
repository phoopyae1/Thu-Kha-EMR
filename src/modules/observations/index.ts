import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma, Observation } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthRequest } from '../auth/index.js';
import { logDataChange } from '../audit/index.js';

const prisma = new PrismaClient();
const router = Router();

const observationSchema = z.object({
  noteText: z.string().optional(),
  bpSystolic: z.coerce.number().int().optional(),
  bpDiastolic: z.coerce.number().int().optional(),
  heartRate: z.coerce.number().int().optional(),
  temperatureC: z.coerce.number().optional(),
  spo2: z.coerce.number().int().optional(),
  bmi: z.coerce.number().optional(),
}).refine(
  (data) => {
    // At least one field must be provided
    return (
      data.noteText?.trim() ||
      data.bpSystolic !== undefined ||
      data.bpDiastolic !== undefined ||
      data.heartRate !== undefined ||
      data.temperatureC !== undefined ||
      data.spo2 !== undefined ||
      data.bmi !== undefined
    );
  },
  { message: 'At least one observation field must be provided' }
);

router.post('/visits/:id/observations', requireAuth, requireRole('Doctor'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  
  try {
    const visit = await prisma.visit.findUnique({ where: { visitId: id } });
    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }
    
    const parsed = observationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    
    // Provide default noteText if not provided
    const observationData = {
      ...parsed.data,
      noteText: parsed.data.noteText?.trim() || 'Vitals recorded',
    };
    
    const obs = await prisma.observation.create({
      data: {
        visitId: id,
        patientId: visit.patientId,
        doctorId: visit.doctorId,
        ...observationData,
      },
    });
    
    await logDataChange(req.user!.userId, 'observation', obs.obsId, undefined, obs);
    
    // Notify Atenxion agent about observation creation
    try {
      const { recordAtenxionTransaction } = await import('../../services/atenxion.js');
      await recordAtenxionTransaction(visit.doctorId);
      console.log('Atenxion transaction recorded for observation creation:', obs.obsId);
    } catch (error) {
      console.warn('Failed to record Atenxion transaction for observation creation:', error);
    }
    
    res.status(201).json(obs);
  } catch (error) {
    console.error('Error creating observation:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create observation';
    res.status(500).json({ error: errorMessage });
  }
});

router.get('/visits/:id/observations', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  const visit = await prisma.visit.findUnique({ where: { visitId: id }, select: { patientId: true, visitDate: true } });
  if (!visit) return res.sendStatus(404);

  const querySchema = z.object({
    scope: z.enum(['visit', 'patient']).default('visit'),
    author: z.enum(['me', 'any']).default('any'),
    before: z.enum(['visit', 'none']).default('none'),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().positive().max(50).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { scope, author, before, order, limit = 20, offset = 0 } = parsed.data;

  if (scope === 'patient' && author === 'me' && before === 'visit') {
    if (!req.user!.doctorId) {
      return res.status(403).json({ error: 'User does not have an associated doctor ID' });
    }
    const orderSql = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const rows = await prisma.$queryRaw<Observation[]>(Prisma.sql`
      SELECT o.* FROM "Observation" o
      JOIN "Visit" v ON o."visitId" = v."visitId"
      WHERE o."patientId" = ${visit.patientId}
        AND o."doctorId" = ${req.user!.doctorId}
        AND v."visitDate" < ${visit.visitDate}
      ORDER BY o."createdAt" ${orderSql}
      LIMIT ${limit} OFFSET ${offset}
    `);
    return res.json(rows);
  }

  const where: any = {};
  if (scope === 'visit') {
    where.visitId = id;
  } else {
    where.patientId = visit.patientId;
    if (before === 'visit') {
      where.visit = { visitDate: { lt: visit.visitDate } };
    }
  }
  if (author === 'me') {
    if (!req.user!.doctorId) {
      return res.status(403).json({ error: 'User does not have an associated doctor ID' });
    }
    where.doctorId = req.user!.doctorId;
  }
  const observations = await prisma.observation.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  });
  res.json(observations);
});

router.get('/patients/:patientId/observations', requireAuth, async (req: AuthRequest, res: Response) => {
  const { patientId } = req.params;
  try {
    z.string().uuid().parse(patientId);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }

  const querySchema = z.object({
    author: z.enum(['me', 'any']).default('any'),
    before_visit: z.string().uuid().optional(),
    exclude_visit: z.string().uuid().optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().positive().max(50).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { author, before_visit, exclude_visit, order, limit = 20, offset = 0 } = parsed.data;

  let beforeDate: Date | undefined;
  if (before_visit) {
    const v = await prisma.visit.findUnique({ where: { visitId: before_visit }, select: { visitDate: true, patientId: true } });
    if (!v || v.patientId !== patientId) {
      return res.status(400).json({ error: 'invalid before_visit' });
    }
    beforeDate = v.visitDate;
  }

  if (author === 'me' && beforeDate) {
    if (!req.user!.doctorId) {
      return res.status(403).json({ error: 'User does not have an associated doctor ID' });
    }
    const orderSql = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const excludeSql = exclude_visit ? Prisma.sql`AND o."visitId" <> ${exclude_visit}` : Prisma.empty;
    const rows = await prisma.$queryRaw<Observation[]>(Prisma.sql`
      SELECT o.* FROM "Observation" o
      JOIN "Visit" v ON o."visitId" = v."visitId"
      WHERE o."patientId" = ${patientId}
        AND o."doctorId" = ${req.user!.doctorId}
        ${excludeSql}
        AND v."visitDate" < ${beforeDate}
      ORDER BY o."createdAt" ${orderSql}
      LIMIT ${limit} OFFSET ${offset}
    `);
    return res.json(rows);
  }

  const where: any = { patientId };
  if (exclude_visit) where.visitId = { not: exclude_visit };
  if (beforeDate) {
    where.visit = { visitDate: { lt: beforeDate } };
  }
  if (author === 'me') {
    if (!req.user!.doctorId) {
      return res.status(403).json({ error: 'User does not have an associated doctor ID' });
    }
    where.doctorId = req.user!.doctorId;
  }
  const observations = await prisma.observation.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  });
  res.json(observations);
});

export default router;
