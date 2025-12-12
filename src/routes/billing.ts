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
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin', 'Pharmacist'),
  validate({ body: CreateInvoiceSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as CreateInvoiceInput;
      const invoice = await createInvoice(payload);
      
      // Notify Atenxion agent about invoice creation (cashier-specific)
      if (req.user?.role === 'Cashier' && req.user?.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(req.user.userId);
          console.log("Atenxion transaction recorded for invoice creation:", invoice.invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice creation:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      // Notify Atenxion agent about invoice creation (admin-specific)
      if (req.user?.role === 'ITAdmin' && req.user?.userId) {
        try {
          const { recordAtenxionTransactionForAdmin } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForAdmin(req.user.userId);
          console.log("Atenxion transaction recorded for invoice creation (admin):", invoice.invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice creation (admin):", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/invoices',
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin', 'Pharmacist'),
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
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin', 'Pharmacist'),
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
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin'),
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
      
      // Notify Atenxion agent about invoice update (cashier-specific)
      if (req.user?.role === 'Cashier' && req.user?.userId && results.length > 0) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(req.user.userId);
          console.log("Atenxion transaction recorded for invoice update:", invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice update:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      res.json({ updated: results.length ? results : null });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/items/:itemId',
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await removeInvoiceItem(req.params.itemId);
      
      // Notify Atenxion agent about invoice item deletion (cashier-specific)
      if (req.user?.role === 'Cashier' && req.user?.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(req.user.userId);
          console.log("Atenxion transaction recorded for invoice item deletion:", req.params.itemId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice item deletion:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/invoices/:invoiceId/payments',
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin'),
  validate({ body: PostPaymentSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { amount, method, referenceNo, note } = req.body as z.infer<typeof PostPaymentSchema>;
      const payment = await postPayment(req.params.invoiceId, amount, method, referenceNo, note);
      
      // Notify Atenxion agent about payment creation (cashier-specific)
      if (req.user?.role === 'Cashier' && req.user?.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(req.user.userId);
          console.log("Atenxion transaction recorded for payment creation:", payment.paymentId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for payment creation:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/invoices/:invoiceId/void',
  // Commented out 'Doctor' - doctors should not have access to billing
  requireRole('Cashier', 'ITAdmin', 'AdminAssistant'),
  validate({ body: VoidInvoiceSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof VoidInvoiceSchema>;
      const invoice = await voidInvoice(req.params.invoiceId, body.reason);
      
      // Notify Atenxion agent about invoice void (cashier-specific)
      if (req.user?.role === 'Cashier' && req.user?.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(req.user.userId);
          console.log("Atenxion transaction recorded for invoice void:", invoice.invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice void:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      res.json(invoice);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/invoices/:invoiceId',
  requireRole('Cashier', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const invoiceId = req.params.invoiceId;
      
      // Validate invoiceId format (UUID)
      if (!invoiceId || typeof invoiceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
        return res.status(400).json({
          code: 400,
          message: 'Invalid invoice ID format',
        });
      }
      
      // Check if invoice exists
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceId },
        select: { invoiceId: true, invoiceNo: true, status: true },
      });
      
      if (!invoice) {
        return res.status(404).json({
          code: 404,
          message: `Invoice not found. It may have already been deleted.`,
        });
      }
      
      // Prevent deletion of paid invoices (cashiers should void instead)
      if (invoice.status === 'PAID') {
        return res.status(400).json({
          code: 400,
          message: 'Cannot delete a paid invoice. Please void it instead.',
        });
      }
      
      // Prevent deletion of void invoices (already voided)
      if (invoice.status === 'VOID') {
        return res.status(400).json({
          code: 400,
          message: 'Cannot delete a void invoice.',
        });
      }
      
      // Delete invoice (cascade will handle related items and payments)
      await prisma.invoice.delete({
        where: { invoiceId },
      });
      
      // Notify Atenxion agent about invoice deletion (cashier-specific)
      if (req.user?.role === 'Cashier' && req.user?.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(req.user.userId);
          console.log("Atenxion transaction recorded for invoice deletion:", invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice deletion:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }
      
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/services',
  // Commented out 'Doctor' - doctors should not have access to billing services
  requireRole('ITAdmin', 'Cashier', 'Pharmacist'),
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
  // Commented out 'Doctor' - doctors should not have access to billing receipts
  requireRole('Cashier', 'ITAdmin', 'Pharmacist'),
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
