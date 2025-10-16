import { z } from 'zod';

export const DecimalString = z
  .union([z.string(), z.number()])
  .transform((value) => {
    if (typeof value === 'number') {
      return value.toString();
    }
    return value.trim();
  })
  .refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
    message: 'Invalid monetary amount',
  });

const ItemSourceTypeEnum = z.enum(['SERVICE', 'PHARMACY', 'LAB', 'DOCTOR_FEE']);
const PaymentMethodEnum = z.enum(['CASH', 'CARD', 'MOBILE_WALLET', 'BANK_TRANSFER', 'OTHER']);

export const InvoiceItemInputSchema = z.object({
  sourceType: ItemSourceTypeEnum,
  sourceRefId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  description: z.string().trim().min(1).optional(),
  quantity: z.coerce.number().int().positive(),
  unitPrice: DecimalString,
  discountAmt: DecimalString.optional(),
  taxAmt: DecimalString.optional(),
});

export const CreateInvoiceSchema = z.object({
  visitId: z.string().uuid(),
  patientId: z.string().uuid(),
  note: z.string().max(500).optional(),
  items: z.array(InvoiceItemInputSchema).optional(),
  invoiceDiscountAmt: DecimalString.optional(),
  invoiceTaxAmt: DecimalString.optional(),
});

export const AddInvoiceItemSchema = InvoiceItemInputSchema;

export const UpdateInvoiceItemSchema = z
  .object({
    description: z.string().trim().min(1).optional(),
    quantity: z.coerce.number().int().positive().optional(),
    unitPrice: DecimalString.optional(),
    discountAmt: DecimalString.optional(),
    taxAmt: DecimalString.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const PostPaymentSchema = z.object({
  amount: DecimalString,
  method: PaymentMethodEnum,
  referenceNo: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export const VoidInvoiceSchema = z.object({
  reason: z.string().trim().min(1),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type InvoiceItemInput = z.infer<typeof InvoiceItemInputSchema>;
export type UpdateInvoiceItemInput = z.infer<typeof UpdateInvoiceItemSchema>;
export type PostPaymentInput = z.infer<typeof PostPaymentSchema>;
export type VoidInvoiceInput = z.infer<typeof VoidInvoiceSchema>;
