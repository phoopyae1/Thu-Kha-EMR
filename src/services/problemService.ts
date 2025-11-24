import { PrismaClient, ProblemStatus, type Problem } from '@prisma/client';
import type {
  CreateProblemInput,
  UpdateProblemStatusInput,
} from '../validation/clinical.js';

const prisma = new PrismaClient();

export async function addProblem(userId: string, payload: CreateProblemInput): Promise<Problem> {
  // Get doctorId from user
  const user = await prisma.user.findUnique({
    where: { userId },
    select: { doctorId: true },
  });

  const problem = await prisma.problem.create({
    data: {
      patientId: payload.patientId,
      codeSystem: payload.codeSystem ?? null,
      code: payload.code ?? null,
      display: payload.display,
      onsetDate: payload.onsetDate ? new Date(payload.onsetDate) : null,
      status: (payload.status as ProblemStatus) ?? ProblemStatus.ACTIVE,
      resolvedDate: payload.resolvedDate ? new Date(payload.resolvedDate) : null,
      createdBy: userId,
    },
  });

  // Notify Atenxion agent about problem creation
  try {
    const { recordAtenxionTransaction } = await import('./atenxion.js');
    await recordAtenxionTransaction(user?.doctorId || userId);
    console.log('Atenxion transaction recorded for problem creation:', problem.problemId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for problem creation:', error);
  }

  return problem;
}

export async function listProblems(
  patientId: string,
  status?: string,
): Promise<Problem[]> {
  const normalizedStatus = status ? status.trim() : '';
  const where: { patientId: string; status?: ProblemStatus } = { patientId };
  if (normalizedStatus) {
    const maybeStatus = normalizedStatus.toUpperCase() as ProblemStatus;
    if (Object.values(ProblemStatus).includes(maybeStatus)) {
      where.status = maybeStatus;
    }
  }

  return prisma.problem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateProblemStatus(
  problemId: string,
  status: UpdateProblemStatusInput['status'],
  resolvedDate?: string,
): Promise<Problem> {
  return prisma.problem.update({
    where: { problemId },
    data: {
      status: status as ProblemStatus,
      resolvedDate: resolvedDate ? new Date(resolvedDate) : null,
    },
  });
}
