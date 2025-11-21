import { Router, type NextFunction, type Response } from 'express';
import { InvoiceStatus, PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';

import { requireAuth, requireRole, type AuthRequest } from '../modules/auth/index.js';
import { validate } from '../middleware/validate.js';
import {
  AddInvoiceItemSchema,
  CreateInvoiceSchema,
  DecimalString,
  PostPaymentSchema,
  UpdateInvoiceItemSchema,
  VoidInvoiceSchema,
  type CreateInvoiceInput,
  type InvoiceItemInput,
} from '../validation/billing.js';
import {
  addInvoiceItem,
  createInvoice,
  postPayment,
  removeInvoiceItem,
  updateInvoiceAdjustments,
  updateInvoiceItem,
  voidInvoice,
} from '../services/billingService.js';
import { NotFoundError } from '../utils/httpErrors.js';
import { postPharmacyCharges } from '../services/billingService.js';

const prisma = new PrismaClient();
const router = Router();

const ModifyInvoiceItemsSchema = z
  .object({
    add: z.array(AddInvoiceItemSchema).optional(),
    update: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          patch: UpdateInvoiceItemSchema,
        }),
      )
      .optional(),
    invoiceDiscountAmt: DecimalString.optional(),
    invoiceTaxAmt: DecimalString.optional(),
  })
  .refine(
    (data) =>
      Boolean(data.add?.length) ||
      Boolean(data.update?.length) ||
      typeof data.invoiceDiscountAmt !== 'undefined' ||
      typeof data.invoiceTaxAmt !== 'undefined',
    { message: 'No changes supplied' },
  );

const ListInvoicesQuerySchema = z.object({
  visitId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean) ?? [],
    ),
});

router.use(requireAuth);

router.post(
  '/invoices',
  requireRole('Cashier', 'ITAdmin', 'Doctor', 'Pharmacist'),
  validate({ body: CreateInvoiceSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as CreateInvoiceInput;
      const invoice = await createInvoice(payload);
      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/invoices',
  requireRole('Cashier', 'ITAdmin', 'Doctor', 'Pharmacist'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = ListInvoicesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { visitId, status } = parsed.data;
      const where: Prisma.InvoiceWhereInput = {};
      if (visitId) {
        where.visitId = visitId;
      }
      if (status && status.length) {
        const allowed = status.filter((value): value is InvoiceStatus =>
          (Object.values(InvoiceStatus) as string[]).includes(value),
        );
        if (allowed.length) {
          where.status = { in: allowed };
        }
      }
      const invoices = await prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          Patient: true,
        },
      });
      res.json({ data: invoices });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/invoices/:invoiceId',
  requireRole('Cashier', 'ITAdmin', 'Doctor', 'Pharmacist'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceId: req.params.invoiceId },
        include: {
          items: true,
          payments: { include: { allocations: true } },
          Patient: true,
          Visit: true,
        },
      });
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }
      res.json(invoice);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/invoices/:invoiceId/items',
  requireRole('Cashier', 'ITAdmin', 'Doctor'),
  validate({ body: ModifyInvoiceItemsSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoiceId = req.params.invoiceId;
      const body = req.body as z.infer<typeof ModifyInvoiceItemsSchema>;
      const results: unknown[] = [];
      if (body.add) {
        for (const item of body.add as InvoiceItemInput[]) {
          results.push(await addInvoiceItem(invoiceId, item));
        }
      }
      if (body.update) {
        for (const entry of body.update) {
          results.push(await updateInvoiceItem(entry.itemId, entry.patch));
        }
      }
      if (typeof body.invoiceDiscountAmt !== 'undefined' || typeof body.invoiceTaxAmt !== 'undefined') {
        const invoice = await updateInvoiceAdjustments(
          invoiceId,
          body.invoiceDiscountAmt,
          body.invoiceTaxAmt,
        );
        results.push(invoice);
      }
      res.json({ updated: results.length ? results : null });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/items/:itemId',
  requireRole('Cashier', 'ITAdmin', 'Doctor'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await removeInvoiceItem(req.params.itemId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/invoices/:invoiceId/payments',
  requireRole('Cashier', 'ITAdmin', 'Doctor'),
  validate({ body: PostPaymentSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { amount, method, referenceNo, note } = req.body as z.infer<typeof PostPaymentSchema>;
      const payment = await postPayment(req.params.invoiceId, amount, method, referenceNo, note);
      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/invoices/:invoiceId/void',
  requireRole('Cashier', 'ITAdmin', 'Doctor', 'AdminAssistant'),
  validate({ body: VoidInvoiceSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof VoidInvoiceSchema>;
      const invoice = await voidInvoice(req.params.invoiceId, body.reason);
      res.json(invoice);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/invoices/:invoiceId',
  requireRole('ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoiceId = req.params.invoiceId;
      
      // Check if invoice exists
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceId },
      });
      
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }
      
      // Delete invoice (cascade will handle related items and payments)
      await prisma.invoice.delete({
        where: { invoiceId },
      });
      
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/services',
  requireRole('ITAdmin', 'Cashier', 'Doctor', 'Pharmacist'),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const services = await prisma.serviceCatalog.findMany({
        orderBy: { name: 'asc' },
      });
      res.json({ data: services });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/services',
  requireRole('ITAdmin'),
  validate({
    body: z.object({
      code: z.string().trim().min(1),
      name: z.string().trim().min(1),
      defaultPrice: DecimalString,
      isActive: z.boolean().optional(),
    }),
  }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { code, name, defaultPrice, isActive = true } = req.body as {
        code: string;
        name: string;
        defaultPrice: string;
        isActive?: boolean;
      };
      const service = await prisma.serviceCatalog.create({
        data: {
          code,
          name,
          defaultPrice,
          isActive,
        },
      });
      res.status(201).json(service);
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  '/services/:serviceId',
  requireRole('ITAdmin'),
  validate({
    body: z.object({
      name: z.string().trim().min(1),
      defaultPrice: DecimalString,
      isActive: z.boolean().optional(),
    }),
  }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { name: string; defaultPrice: string; isActive?: boolean };
      const updated = await prisma.serviceCatalog.update({
        where: { serviceId: req.params.serviceId },
        data: {
          name: body.name,
          defaultPrice: body.defaultPrice,
          isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
        },
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/services/:serviceId',
  requireRole('ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await prisma.serviceCatalog.delete({ where: { serviceId: req.params.serviceId } });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/post-pharmacy/:prescriptionId',
  requireRole('Pharmacist', 'PharmacyTech', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoice = await postPharmacyCharges(req.params.prescriptionId);
      res.json({ invoiceId: invoice?.invoiceId ?? null });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/invoices/:invoiceId/receipt',
  requireRole('Cashier', 'ITAdmin', 'Doctor', 'Pharmacist'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceId: req.params.invoiceId },
        include: {
          items: true,
          Patient: true,
          Visit: true,
        },
      });
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }
      const createdAt = new Date(invoice.createdAt);
      const receiptHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${invoice.invoiceNo}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; }
      h1 { font-size: 20px; margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #ddd; padding: 8px; font-size: 13px; }
      th { background: #f4f4f5; text-align: left; }
      tfoot td { font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>Invoice ${invoice.invoiceNo}</h1>
    <p><strong>Patient:</strong> ${invoice.Patient?.name ?? 'Unknown'}</p>
    <p><strong>Visit Date:</strong> ${createdAt.toLocaleString('en-GB', {
        timeZone: 'Asia/Yangon',
      })}</p>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.items
          .map(
            (item) => `
            <tr>
              <td>${item.description}</td>
              <td>${item.quantity}</td>
              <td>${item.unitPrice.toString()}</td>
              <td>${item.lineTotal.toString()}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Subtotal</td>
          <td>${invoice.subTotal.toString()}</td>
        </tr>
        <tr>
          <td colspan="3">Discount</td>
          <td>${invoice.discountAmt.toString()}</td>
        </tr>
        <tr>
          <td colspan="3">Tax</td>
          <td>${invoice.taxAmt.toString()}</td>
        </tr>
        <tr>
          <td colspan="3">Grand Total</td>
          <td>${invoice.grandTotal.toString()}</td>
        </tr>
        <tr>
          <td colspan="3">Amount Due</td>
          <td>${invoice.amountDue.toString()}</td>
        </tr>
      </tfoot>
    </table>
  </body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(receiptHtml);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
