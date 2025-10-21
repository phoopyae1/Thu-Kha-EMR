import { z } from 'zod';

export const RxItemSchema = z.object({
  drugId: z.string().uuid(),
  dose: z.string().min(1),
  route: z.string().min(1),
  frequency: z.string().min(1),
  durationDays: z.number().int().positive().max(365),
  quantityPrescribed: z.number().int().positive().max(1000),
  prn: z.boolean().optional().default(false),
  allowGeneric: z.boolean().optional().default(true),
  notes: z.string().max(300).optional(),
});

export const CreateRxSchema = z.object({
  patientId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(RxItemSchema).min(1).max(10),
});

export const ReceiveStockSchema = z.object({
  items: z
    .array(
      z.object({
        drugId: z.string().uuid(),
        batchNo: z.string().optional(),
        expiryDate: z.string().datetime().optional(),
        location: z.string().min(1),
        qtyOnHand: z.number().int().nonnegative(),
        unitCost: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

export const AdjustStockSchema = z.object({
  adjustments: z
    .array(
      z.object({
        stockItemId: z.string().uuid(),
        qtyOnHand: z.number().int().nonnegative(),
        reason: z.string().min(3).max(200).optional(),
      }),
    )
    .min(1),
});

export const DispenseItemSchema = z.object({
  prescriptionItemId: z.string().uuid(),
  stockItemId: z.string().uuid().nullable().optional(),
  drugId: z.string().uuid(),
  quantity: z.number().int().positive().max(500),
  unitPrice: z.number().nonnegative().optional(),
});

export type RxItemInput = z.infer<typeof RxItemSchema>;
export type CreateRxInput = z.infer<typeof CreateRxSchema>;
export type ReceiveStockInput = z.infer<typeof ReceiveStockSchema>['items'];
export type AdjustStockInput = z.infer<typeof AdjustStockSchema>['adjustments'];
export type DispenseItemInput = z.infer<typeof DispenseItemSchema>;
