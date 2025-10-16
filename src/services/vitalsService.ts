import { PrismaClient, type Vitals } from '@prisma/client';
import type { CreateVitalsInput } from '../validation/clinical.js';

const prisma = new PrismaClient();

type VitalsResponse = Omit<Vitals, 'temperature' | 'heightCm' | 'weightKg' | 'bmi'> & {
  temperature: number | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
};

function calculateBmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (weightKg == null || heightCm == null || heightCm === 0) {
    return null;
  }
  const heightMeters = heightCm / 100;
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) {
    return null;
  }
  const bmi = weightKg / (heightMeters * heightMeters);
  if (!Number.isFinite(bmi)) {
    return null;
  }
  return Number(bmi.toFixed(2));
}

function serializeVitals(vitals: Vitals): VitalsResponse {
  return {
    ...vitals,
    temperature: vitals.temperature ? Number(vitals.temperature) : null,
    heightCm: vitals.heightCm ? Number(vitals.heightCm) : null,
    weightKg: vitals.weightKg ? Number(vitals.weightKg) : null,
    bmi: vitals.bmi ? Number(vitals.bmi) : null,
  };
}

export async function createVitals(userId: string, payload: CreateVitalsInput): Promise<VitalsResponse> {
  const bmi = calculateBmi(payload.weightKg ?? null, payload.heightCm ?? null);

  const vitals = await prisma.vitals.create({
    data: {
      visitId: payload.visitId,
      patientId: payload.patientId,
      recordedBy: userId,
      systolic: payload.systolic ?? null,
      diastolic: payload.diastolic ?? null,
      heartRate: payload.heartRate ?? null,
      temperature: payload.temperature ?? null,
      spo2: payload.spo2 ?? null,
      heightCm: payload.heightCm ?? null,
      weightKg: payload.weightKg ?? null,
      bmi: bmi ?? null,
      notes: payload.notes ?? null,
    },
  });

  return serializeVitals(vitals);
}

export async function listVitals(
  patientId: string,
  opts: { limit?: number } = {},
): Promise<VitalsResponse[]> {
  const vitals = await prisma.vitals.findMany({
    where: { patientId },
    orderBy: { recordedAt: 'desc' },
    take: opts.limit ?? 50,
  });

  return vitals.map(serializeVitals);
}

export { calculateBmi };
