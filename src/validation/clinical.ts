import { z } from 'zod';

export const CreateVitalsSchema = z.object({
  visitId: z.string().uuid(),
  patientId: z.string().uuid(),
  systolic: z.number().int().min(40).max(300).nullish(),
  diastolic: z.number().int().min(20).max(200).nullish(),
  heartRate: z.number().int().min(20).max(250).nullish(),
  temperature: z.number().min(30).max(45).nullish(),
  spo2: z.number().int().min(50).max(100).nullish(),
  heightCm: z.number().positive().max(250).nullish(),
  weightKg: z.number().positive().max(400).nullish(),
  notes: z.string().max(500).optional(),
});

export const CreateProblemSchema = z.object({
  patientId: z.string().uuid(),
  codeSystem: z.string().max(20).optional(),
  code: z.string().max(20).optional(),
  display: z.string().min(2).max(120),
  onsetDate: z.string().datetime().optional(),
  status: z.enum(['ACTIVE', 'RESOLVED']).optional(),
  resolvedDate: z.string().datetime().optional(),
});

export const UpdateProblemStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'RESOLVED']),
  resolvedDate: z.string().datetime().optional(),
});

export const CreateLabOrderSchema = z.object({
  visitId: z.string().uuid(),
  patientId: z.string().uuid(),
  priority: z.string().optional(),
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        testCode: z.string().min(1),
        testName: z.string().min(1),
        specimen: z.string().optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .min(1),
});

export const EnterLabResultSchema = z.object({
  labOrderItemId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  resultValue: z.string().optional(),
  resultValueNum: z.number().optional(),
  unit: z.string().optional(),
  referenceLow: z.number().optional(),
  referenceHigh: z.number().optional(),
  notes: z.string().max(300).optional(),
});

export type CreateVitalsInput = z.infer<typeof CreateVitalsSchema>;
export type CreateProblemInput = z.infer<typeof CreateProblemSchema>;
export type UpdateProblemStatusInput = z.infer<typeof UpdateProblemStatusSchema>;
export type CreateLabOrderInput = z.infer<typeof CreateLabOrderSchema>;
export type EnterLabResultInput = z.infer<typeof EnterLabResultSchema>;
