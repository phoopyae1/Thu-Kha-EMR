import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import {
  PrismaClient,
  PrescriptionStatus,
  MedicationOrderStatus,
  type Prisma,
} from '@prisma/client';
import { z } from 'zod';

import { requireAuth, requireRole, type AuthRequest } from '../modules/auth/index.js';
import { validate } from '../middleware/validate.js';
import {
  AdjustStockSchema,
  CreateRxSchema,
  DispenseItemSchema,
  ReceiveStockSchema,
  type CreateRxInput,
  type DispenseItemInput,
} from '../validation/pharmacy.js';
import {
  addDispenseItem,
  adjustStock,
  completeDispense,
  createPrescription,
  getPharmacyQueue,
  listLowStockInventory,
  listStockItems,
  receiveStock,
  startDispense,
} from '../services/pharmacyService.js';
import { InvoiceScanError, scanInvoice as analyzeInvoice } from '../services/invoiceScanner.js';
import { postPharmacyCharges } from '../services/billingService.js';
import { medicationOrderSelect } from '../services/medicationOrderService.js';

const prisma = new PrismaClient();
const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

const CreateDrugSchema = z.object({
  drugId: z.string().uuid().optional(),
  name: z.string().min(1),
  genericName: z.string().optional(),
  form: z.string().min(1),
  strength: z.string().min(1),
  routeDefault: z.string().optional(),
  isActive: z.boolean().optional(),
});

const CompleteDispenseSchema = z.object({
  status: z.enum(['COMPLETED', 'PARTIAL']),
});

const SearchInventorySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(50).optional(),
  includeAll: z.coerce.boolean().optional(),
});

const MedicationOrderStatusEnum = z.nativeEnum(MedicationOrderStatus);

const MedicationOrderListQuerySchema = z.object({
  status: z
    .union([MedicationOrderStatusEnum, z.array(MedicationOrderStatusEnum)])
    .optional(),
  patientId: z.string().uuid().optional(),
});

const MedicationOrderUpdateSchema = z.object({
  status: MedicationOrderStatusEnum.optional(),
  notes: z.string().trim().max(500).optional(),
});

const MedicationOrderParamsSchema = z.object({
  orderId: z.string().uuid(),
});

const ListStockSchema = z.object({
  drugId: z.string().uuid(),
});

const LowStockQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  threshold: z.coerce.number().int().nonnegative().optional(),
});

router.use(requireAuth);

router.post(
  '/drugs',
  requireRole('ITAdmin', 'InventoryManager'),
  validate({ body: CreateDrugSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof CreateDrugSchema>;
      const drug = await prisma.drug.create({ data: body });
      res.status(201).json(drug);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/inventory/receive',
  requireRole('ITAdmin', 'InventoryManager', 'Pharmacist'),
  validate({ body: ReceiveStockSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as z.infer<typeof ReceiveStockSchema>;
      const created = await receiveStock(payload.items);
      res.status(201).json({ items: created });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/inventory/invoice/scan',
  requireRole('ITAdmin', 'InventoryManager', 'Pharmacist', 'PharmacyTech'),
  upload.single('invoice'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'Invoice file is required.' });
      }
      const result = await analyzeInvoice(file.buffer, file.mimetype);
      res.json({ data: result });
    } catch (error) {
      if (error instanceof InvoiceScanError) {
        return res
          .status(error.statusCode ?? 502)
          .json({ error: error.message, details: error.details ?? null });
      }
      next(error);
    }
  },
);

router.get(
  '/inventory/stock',
  requireRole('Pharmacist', 'PharmacyTech', 'InventoryManager', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = ListStockSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const items = await listStockItems(parsed.data.drugId);
      res.json({ data: items });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/inventory/adjust',
  requireRole('ITAdmin', 'InventoryManager'),
  validate({ body: AdjustStockSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as z.infer<typeof AdjustStockSchema>;
      const updated = await adjustStock(payload.adjustments);
      res.status(200).json({ items: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/inventory/search',
  requireRole('Pharmacist', 'PharmacyTech', 'InventoryManager', 'ITAdmin', 'Doctor', 'Nurse'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = SearchInventorySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { q, limit = 10, includeAll = false } = parsed.data;

      const where: Prisma.DrugWhereInput = {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { genericName: { contains: q, mode: 'insensitive' } },
          { strength: { contains: q, mode: 'insensitive' } },
        ],
      };

      if (!includeAll) {
        where.stocks = { some: { qtyOnHand: { gt: 0 } } };
      }

      const drugs = await prisma.drug.findMany({
        where,
        include: {
          stocks: {
            ...(includeAll ? {} : { where: { qtyOnHand: { gt: 0 } } }),
            select: { qtyOnHand: true },
          },
        },
        orderBy: [{ name: 'asc' }],
        take: limit,
      });

      const data = drugs.map((drug) => ({
        drugId: drug.drugId,
        name: drug.name,
        genericName: drug.genericName ?? null,
        strength: drug.strength,
        form: drug.form,
        routeDefault: drug.routeDefault ?? null,
        qtyOnHand: drug.stocks.reduce((total, stock) => total + stock.qtyOnHand, 0),
      }));

      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/inventory/low-stock',
  requireRole('InventoryManager', 'ITAdmin', 'Pharmacist'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = LowStockQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { limit = 5, threshold = 10 } = parsed.data;
      const data = await listLowStockInventory(limit, threshold);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/visits/:visitId/prescriptions',
  requireRole('Doctor', 'Pharmacist'),
  validate({ body: CreateRxSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const visitId = req.params.visitId;
      const payload = req.body as CreateRxInput;

      const visit = await prisma.visit.findUnique({
        where: { visitId },
        select: { visitId: true, patientId: true, doctorId: true },
      });

      if (!visit) {
        return res.status(404).json({ error: 'Visit not found' });
      }

      if (req.user?.doctorId && req.user.doctorId !== visit.doctorId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const patientId = payload.patientId ?? visit.patientId;
      const { prescription, allergyHits } = await createPrescription(
        visitId,
        visit.doctorId,
        patientId,
        payload,
      );

      res.status(201).json({ prescription, allergyHits });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/prescriptions',
  requireRole('Pharmacist', 'PharmacyTech', 'InventoryManager', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const raw = typeof req.query.status === 'string' ? req.query.status.split(',') : undefined;
      const statuses = (raw ?? ['PENDING']).reduce((acc: PrescriptionStatus[], value: string) => {
        const normalized = value.trim().toUpperCase();
        if ((Object.values(PrescriptionStatus) as string[]).includes(normalized)) {
          acc.push(normalized as PrescriptionStatus);
        }
        return acc;
      }, []);

      console.log(`[GET /pharmacy/prescriptions] Fetching queue with statuses:`, statuses);
      const queue = await getPharmacyQueue(statuses.length ? statuses : [PrescriptionStatus.PENDING]);
      console.log(`[GET /pharmacy/prescriptions] Found ${queue.length} prescriptions`);
      
      // Log specific prescription if requested
      const checkPrescriptionId = req.query.checkPrescriptionId as string | undefined;
      if (checkPrescriptionId) {
        const found = queue.find(p => p.prescriptionId === checkPrescriptionId);
        console.log(`[GET /pharmacy/prescriptions] Prescription ${checkPrescriptionId} in queue:`, found ? `YES (status: ${found.status})` : 'NO');
      }
      
      res.json({ data: queue });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/prescriptions/:prescriptionId/dispenses',
  requireRole('Pharmacist', 'PharmacyTech'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const dispense = await startDispense(req.params.prescriptionId, req.user.userId);
      res.status(201).json(dispense);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/dispenses/:dispenseId/items',
  requireRole('Pharmacist', 'PharmacyTech'),
  validate({ body: DispenseItemSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as DispenseItemInput;
      const item = await addDispenseItem(req.params.dispenseId, payload);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/dispenses/:dispenseId/complete',
  requireRole('Pharmacist'),
  validate({ body: CompleteDispenseSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof CompleteDispenseSchema>;
      console.log(`[PATCH /dispenses/:dispenseId/complete] Request for dispenseId: ${req.params.dispenseId}, status: ${body.status}`);
      
      const result = await completeDispense(req.params.dispenseId, body.status);
      console.log(`[PATCH /dispenses/:dispenseId/complete] Result:`, result);
      
      let invoiceId: string | null = null;
      if (body.status === 'COMPLETED') {
        try {
          const invoice = await postPharmacyCharges(result.prescriptionId);
          invoiceId = invoice?.invoiceId ?? null;
          console.log(`[PATCH /dispenses/:dispenseId/complete] Invoice created: ${invoiceId}`);
        } catch (invoiceError) {
          console.error(`[PATCH /dispenses/:dispenseId/complete] Error creating invoice:`, invoiceError);
          // Don't fail the whole request if invoice creation fails
        }
      }
      
      // Verify the prescription status was actually updated - use a fresh query
      // Add a small delay to ensure transaction is fully committed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const verifyPrescription = await prisma.prescription.findUnique({
        where: { prescriptionId: result.prescriptionId },
        select: { status: true, updatedAt: true },
      });
      
      console.log(`[PATCH /dispenses/:dispenseId/complete] Verification - prescription status in DB: ${verifyPrescription?.status}, expected: ${result.prescriptionStatus}`);
      console.log(`[PATCH /dispenses/:dispenseId/complete] Prescription updatedAt: ${verifyPrescription?.updatedAt}`);
      
      if (verifyPrescription?.status !== result.prescriptionStatus) {
        console.error(`[PATCH /dispenses/:dispenseId/complete] MISMATCH! DB has ${verifyPrescription?.status} but expected ${result.prescriptionStatus}`);
        // Try to update it again directly
        console.log(`[PATCH /dispenses/:dispenseId/complete] Attempting direct update...`);
        try {
          const directUpdate = await prisma.prescription.update({
            where: { prescriptionId: result.prescriptionId },
            data: { status: result.prescriptionStatus },
          });
          console.log(`[PATCH /dispenses/:dispenseId/complete] Direct update result: ${directUpdate.status}`);
        } catch (directUpdateError) {
          console.error(`[PATCH /dispenses/:dispenseId/complete] Direct update failed:`, directUpdateError);
        }
      } else {
        console.log(`[PATCH /dispenses/:dispenseId/complete] Status verification PASSED`);
      }
      
      res.json({ ...result, invoiceId, verifiedStatus: verifyPrescription?.status });
    } catch (error) {
      console.error(`[PATCH /dispenses/:dispenseId/complete] Error:`, error);
      next(error);
    }
  },
);

router.get(
  '/medication-orders',
  requireRole('Pharmacist', 'PharmacyTech', 'ITAdmin', 'AdminAssistant'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = MedicationOrderListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { status, patientId } = parsed.data;
      const statuses = Array.isArray(status) ? status : status ? [status] : [];

      const orders = await prisma.medicationOrder.findMany({
        where: {
          ...(patientId ? { patientId } : {}),
          ...(statuses.length ? { status: { in: statuses } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: medicationOrderSelect,
      });

      res.json({ data: orders });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/medication-orders/:orderId',
  requireRole('Pharmacist', 'ITAdmin', 'AdminAssistant'),
  validate({ params: MedicationOrderParamsSchema, body: MedicationOrderUpdateSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params as z.infer<typeof MedicationOrderParamsSchema>;
      const { status, notes } = req.body as z.infer<typeof MedicationOrderUpdateSchema>;

      if (!status && notes === undefined) {
        return res.status(400).json({ error: 'No updates supplied' });
      }

      const existing = await prisma.medicationOrder.findUnique({
        where: { orderId },
        select: {
          orderId: true,
          status: true,
          approvedAt: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Medication order not found' });
      }

      const updateData: Prisma.MedicationOrderUpdateInput = {};

      if (status) {
        updateData.status = status;
        if (status === MedicationOrderStatus.APPROVED) {
          updateData.approvedAt = existing.approvedAt ?? new Date();
          if (req.user) {
            updateData.approvedBy = { connect: { userId: req.user.userId } };
          }
        }
      }

      if (notes !== undefined) {
        const trimmed = notes.trim();
        updateData.notes = trimmed.length > 0 ? trimmed : null;
      }

      if (req.user) {
        updateData.updatedBy = { connect: { userId: req.user.userId } };
      }

      const order = await prisma.medicationOrder.update({
        where: { orderId },
        data: updateData,
        select: medicationOrderSelect,
      });

      res.json(order);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/medication-orders/:orderId',
  requireRole('ITAdmin', 'AdminAssistant'),
  validate({ params: MedicationOrderParamsSchema }),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params as z.infer<typeof MedicationOrderParamsSchema>;

      // Check if medication order exists
      const existing = await prisma.medicationOrder.findUnique({
        where: { orderId },
        select: { orderId: true },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Medication order not found' });
      }

      // Delete the medication order
      await prisma.medicationOrder.delete({
        where: { orderId },
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
