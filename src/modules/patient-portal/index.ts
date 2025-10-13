import { Router, type Request, type Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

const registrationSchema = z.object({
  patientId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/accounts', async (req: Request, res: Response) => {
  const parsed = registrationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { patientId, email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const patient = await prisma.patient.findUnique({
    where: { patientId },
    select: { patientId: true },
  });

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const account = await prisma.patientPortalAccount.create({
      data: {
        patientId: patient.patientId,
        email: normalizedEmail,
        passwordHash,
      },
      select: {
        accountId: true,
        patientId: true,
        email: true,
        status: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      message: 'Patient portal account created',
      account,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'An account already exists for this patient or email' });
    }

    console.error('patient portal account creation failed', {
      patientId,
      email: normalizedEmail,
      error,
    });

    return res.status(500).json({ error: 'Unable to create patient portal account' });
  }
});

export default router;
