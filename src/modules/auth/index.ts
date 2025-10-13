import crypto from 'node:crypto';
import { Router, type Response, type NextFunction } from 'express';
import type { Request } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

type RoleName =
  | 'Doctor'
  | 'AdminAssistant'
  | 'Cashier'
  | 'ITAdmin'
  | 'Pharmacist'
  | 'PharmacyTech'
  | 'InventoryManager'
  | 'Nurse'
  | 'LabTech'
  | 'Patient';

export interface AuthUser {
  userId: string;
  role: RoleName;
  email: string;
  doctorId?: string;
  patientId?: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

const prisma = new PrismaClient();
const PASSWORD_MIN_LENGTH = 8;

const patientRegistrationSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH),
  dob: z.coerce.date(),
  gender: z.enum(['M', 'F']),
  contact: z.string().trim().min(1).optional(),
  insurance: z.string().trim().min(1).optional(),
  drugAllergies: z.string().trim().min(1).optional(),
});

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  return value?.trim() || null;
}

function decodeToken(token: string): {
  sub?: string;
  role?: unknown;
  email?: unknown;
  doctorId?: unknown;
} {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid token');
  }
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload);
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rawToken = parseBearerToken(req.get('authorization'));
    if (!rawToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = decodeToken(rawToken);
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string' || typeof payload.email !== 'string') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { userId: payload.sub },
      select: { userId: true, email: true, role: true, status: true, doctorId: true, patientId: true },
    });

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = {
      userId: user.userId,
      role: user.role as RoleName,
      email: user.email,
      doctorId: user.doctorId ?? undefined,
      patientId: user.patientId ?? undefined,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireRole(...roles: RoleName[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.role === 'ITAdmin') {
      return next();
    }

    if (roles.length === 0 || roles.includes(user.role)) {
      return next();
    }

    return res.status(403).json({ error: 'Forbidden' });
  };
}

export function requirePatient(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (user.role !== 'Patient' || !user.patientId) {
    return res.status(403).json({ error: 'Patient access required' });
  }

  return next();
}

const router = Router();

router.post('/patient/register', async (req: Request, res: Response) => {
  const parsed = patientRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const data = parsed.data;
  const normalizedEmail = data.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    return res.status(409).json({ error: 'An account already exists for that email address' });
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const patientRecord = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        name: data.name,
        dob: data.dob,
        gender: data.gender,
        contact: data.contact ?? null,
        insurance: data.insurance ?? null,
        drugAllergies: data.drugAllergies ?? null,
      },
    });

    await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: 'Patient',
        status: 'active',
        doctorId: null,
        patientId: patient.patientId,
      },
    });

    return patient;
  });

  res.status(201).json({
    message: 'Patient portal account created',
    patientId: patientRecord.patientId,
  });
});

router.post('/password/change', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as
    | {
        currentPassword?: unknown;
        newPassword?: unknown;
      }
    | undefined;

  if (typeof body?.currentPassword !== 'string' || typeof body?.newPassword !== 'string') {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  const currentPassword = body.currentPassword.trim();
  const newPassword = body.newPassword.trim();

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return res
      .status(400)
      .json({ error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters long` });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }

  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await prisma.user.findUnique({
    where: { userId },
    select: { passwordHash: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  let passwordValid = false;
  try {
    passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  } catch {
    passwordValid = false;
  }

  if (!passwordValid) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({ where: { userId }, data: { passwordHash } }),
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
  ]);

  res.json({ message: 'Password updated' });
});

router.post('/password/forgot', async (req: Request, res: Response) => {
  const body = req.body as { email?: unknown } | undefined;
  if (typeof body?.email !== 'string' || body.email.trim().length === 0) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const email = body.email.trim();
  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: 'active',
    },
    select: { userId: true },
  });

  const response: { message: string; resetToken?: string } = {
    message: 'If an account exists for that email, a reset link has been sent.',
  };

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    const now = new Date();

    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({
        where: { userId: user.userId, usedAt: null },
        data: { usedAt: now },
      }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.userId,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    if (process.env.NODE_ENV !== 'production') {
      response.resetToken = rawToken;
    }
  }

  res.json(response);
});

router.post('/password/reset', async (req: Request, res: Response) => {
  const body = req.body as { token?: unknown; password?: unknown } | undefined;
  if (typeof body?.token !== 'string' || typeof body?.password !== 'string') {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  const token = body.token.trim();
  const password = body.password.trim();

  if (!token) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return res
      .status(400)
      .json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const resetToken = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!resetToken) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({ where: { userId: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { tokenId: resetToken.tokenId },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
        NOT: { tokenId: resetToken.tokenId },
      },
      data: { usedAt: now },
    }),
  ]);

  res.json({ message: 'Password updated' });
});

router.post('/login', async (req: Request, res: Response) => {
  const body = req.body as { email?: unknown; password?: unknown } | undefined;
  const email = body?.email;
  const password = body?.password;

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim();
  if (!normalizedEmail || password.trim().length === 0) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
  });

  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  let passwordValid = false;
  try {
    passwordValid = await bcrypt.compare(password, user.passwordHash);
  } catch {
    passwordValid = false;
  }

  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.userId,
      role: user.role,
      email: user.email,
      doctorId: user.doctorId ?? null,
      patientId: user.patientId ?? null,
    }),
  ).toString('base64url');
  const accessToken = `${header}.${payload}.`;
  res.json({
    accessToken,
    user: {
      userId: user.userId,
      role: user.role,
      email: user.email,
      doctorId: user.doctorId,
      patientId: user.patientId,
    },
  });
});

export default router;

