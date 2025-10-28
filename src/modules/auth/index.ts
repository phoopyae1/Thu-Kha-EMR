import crypto from 'node:crypto';
import { Router, type Response, type NextFunction } from 'express';
import type { Request } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

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
    console.log(payload);
    let user:
      | {
          userId: string;
          email: string;
          role: string;
          status: string;
          doctorId: string | null;
        }
      | null = null;

    // Normal tokens include sub/role/email → lookup by userId
    if (
      typeof payload.sub === 'string' &&
      typeof payload.role === 'string' &&
      typeof payload.email === 'string'
    ) {
      user = await prisma.user.findUnique({
        where: { userId: payload.sub },
        select: { userId: true, email: true, role: true, status: true, doctorId: true },
      });
    } else if (typeof payload.email === 'string') {
      // Fallback: accept system tokens that only carry email
      user = await prisma.user.findFirst({
        where: { email: { equals: String(payload.email), mode: 'insensitive' }, status: 'active' },
        select: { userId: true, email: true, role: true, status: true, doctorId: true },
      });
    }

    if (!user || user.status !== 'active') {
      // Allowlisted system accounts (email-only tokens)
      if (typeof payload.email === 'string') {
        const systemEmails = (process.env.SYSTEM_EMAILS || 'system@atenxion.ai')
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        const emailLower = payload.email.toLowerCase();
        if (systemEmails.includes(emailLower)) {
          req.user = {
            userId: 'system',
            role: 'ITAdmin',
            email: emailLower,
            doctorId: undefined,
          };
          return next();
        }
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = {
      userId: user.userId,
      role: user.role as RoleName,
      email: user.email,
      doctorId: user.doctorId ?? undefined,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function   requireRole(...roles: RoleName[]) {
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

const router = Router();

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
    },
  });
});

export default router;

