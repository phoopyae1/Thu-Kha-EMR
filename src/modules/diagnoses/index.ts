import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthRequest } from '../auth/index.js';
import { logDataChange } from '../audit/index.js';

const prisma = new PrismaClient();
const router = Router();

const diagnosisSchema = z.object({
  diagnosis: z.string().min(1),
});

router.post('/visits/:id/diagnoses', requireAuth, requireRole('Doctor'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    z.string().uuid().parse(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }
  const parsed = diagnosisSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const diag = await prisma.diagnosis.create({ data: { visitId: id, diagnosis: parsed.data.diagnosis } });
  await logDataChange(req.user!.userId, 'diagnosis', diag.diagId, undefined, diag);
  
  // Notify Atenxion agent about diagnosis creation (doctor-specific)
  try {
    const visit = await prisma.visit.findUnique({
      where: { visitId: id },
      select: { doctorId: true },
    });
    if (visit?.doctorId) {
      const { recordAtenxionTransactionForDoctor } = await import('../../services/atenxion.js');
      await recordAtenxionTransactionForDoctor(visit.doctorId);
      console.log('Atenxion transaction recorded for diagnosis creation:', diag.diagId);
    }
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for diagnosis creation:', error);
  }
  
  res.status(201).json(diag);
});

router.get('/', requireAuth, requireRole('Doctor'), async (req: Request, res: Response) => {
  const querySchema = z.object({
    q: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { q, from, to, limit = 20, offset = 0 } = parsed.data;
  const where: any = {};
  if (q) {
    where.diagnosis = { contains: q, mode: 'insensitive' };
  }
  if (from || to) {
    where.createdAt = {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    };
  }
  const diagnoses = await prisma.diagnosis.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
  res.json(diagnoses);
});

export default router;
