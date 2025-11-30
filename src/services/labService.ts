import {
  LabItemStatus,
  LabOrderStatus,
  PrismaClient,
  type LabOrder,
  type LabOrderItem,
  type LabResult,
} from '@prisma/client';
import type {
  CreateLabOrderInput,
  EnterLabResultInput,
} from '../validation/clinical.js';

const prisma = new PrismaClient();

type LabOrderWithItems = LabOrder & { items: LabOrderItem[] };

type ListLabOrderFilters = {
  patientId?: string;
  visitId?: string;
  status?: string;
};

export async function createLabOrder(
  doctorId: string,
  payload: CreateLabOrderInput,
): Promise<LabOrderWithItems> {
  const order = await prisma.labOrder.create({
    data: {
      visitId: payload.visitId,
      patientId: payload.patientId,
      doctorId,
      priority: payload.priority ?? null,
      notes: payload.notes ?? null,
      items: {
        create: payload.items.map((item) => ({
          testCode: item.testCode,
          testName: item.testName,
          specimen: item.specimen ?? null,
          notes: item.notes ?? null,
        })),
      },
    },
    include: { items: true },
  });

  // Notify Atenxion agent about lab order creation
  try {
    const { recordAtenxionTransactionForDoctor } = await import('./atenxion.js');
    await recordAtenxionTransactionForDoctor(doctorId);
    console.log('Atenxion transaction recorded for lab order creation:', order.labOrderId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for lab order creation:', error);
  }

  return order;
}

export async function listLabOrders(filters: ListLabOrderFilters) {
  const where: Record<string, unknown> = {};
  if (filters.patientId) {
    where.patientId = filters.patientId;
  }
  if (filters.visitId) {
    where.visitId = filters.visitId;
  }
  if (filters.status) {
    const normalized = filters.status.trim().toUpperCase();
    if (normalized && Object.values(LabOrderStatus).includes(normalized as LabOrderStatus)) {
      where.status = normalized;
    }
  }

  const orders = await prisma.labOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: { results: { orderBy: { resultedAt: 'desc' } } },
      },
      results: { orderBy: { resultedAt: 'desc' } },
    },
  });

  // Fetch patient names for all unique patient IDs
  const uniquePatientIds = [...new Set(orders.map((o) => o.patientId))];
  const patients = await prisma.patient.findMany({
    where: { patientId: { in: uniquePatientIds } },
    select: { patientId: true, name: true },
  });
  const patientMap = new Map(patients.map((p) => [p.patientId, p.name]));

  // Group orders by doctor and assign numbered order IDs (1, 2, 3, etc. per doctor)
  const ordersByDoctor = new Map<string, typeof orders>();
  orders.forEach((order) => {
    const doctorId = order.doctorId || 'unknown';
    if (!ordersByDoctor.has(doctorId)) {
      ordersByDoctor.set(doctorId, []);
    }
    ordersByDoctor.get(doctorId)!.push(order);
  });

  // Sort each doctor's orders by creation date (most recent first) and assign numbers
  const orderIdMap = new Map<string, string>();
  ordersByDoctor.forEach((doctorOrders, doctorId) => {
    const sortedOrders = doctorOrders.sort((a, b) => {
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    sortedOrders.forEach((order, index) => {
      orderIdMap.set(order.labOrderId, String(index + 1));
    });
  });

  // Add orderId and patientName fields to each order
  return orders.map((order) => ({
    ...order,
    orderId: orderIdMap.get(order.labOrderId) || null,
    patientName: patientMap.get(order.patientId) || null,
  }));
}

export function computeAbnormal(
  num?: number | null,
  low?: number | null,
  high?: number | null,
): string | null {
  if (typeof num !== 'number' || Number.isNaN(num)) {
    return null;
  }
  if (typeof low === 'number' && !Number.isNaN(low) && num < low) {
    return 'L';
  }
  if (typeof high === 'number' && !Number.isNaN(high) && num > high) {
    return 'H';
  }
  return null;
}

async function resolvePatientId(
  labOrderItemId: string,
  fallbackPatientId?: string,
): Promise<{ labOrderId: string; patientId: string }> {
  const item = await prisma.labOrderItem.findUnique({
    where: { labOrderItemId },
    include: { LabOrder: true },
  });
  if (!item || !item.LabOrder) {
    const error = new Error('Lab order item not found');
    (error as any).statusCode = 404;
    throw error;
  }

  return {
    labOrderId: item.labOrderId,
    patientId: fallbackPatientId ?? item.LabOrder.patientId,
  };
}

async function resolveReferenceDefaults(testCode: string) {
  if (!testCode) {
    return { unit: null, refLow: null, refHigh: null };
  }
  const entry = await prisma.labCatalog.findUnique({ where: { testCode } });
  return {
    unit: entry?.unit ?? null,
    refLow: entry?.refLow ?? null,
    refHigh: entry?.refHigh ?? null,
  };
}

export async function enterLabResult(
  labTechUserId: string,
  payload: EnterLabResultInput,
): Promise<LabResult> {
  const { labOrderId, patientId } = await resolvePatientId(
    payload.labOrderItemId,
    payload.patientId,
  );

  const orderItem = await prisma.labOrderItem.findUnique({
    where: { labOrderItemId: payload.labOrderItemId },
  });
  if (!orderItem) {
    const error = new Error('Lab order item not found');
    (error as any).statusCode = 404;
    throw error;
  }

  let referenceLow = payload.referenceLow ?? null;
  let referenceHigh = payload.referenceHigh ?? null;
  let unit = payload.unit ?? null;

  if (referenceLow == null || referenceHigh == null || unit == null) {
    const defaults = await resolveReferenceDefaults(orderItem.testCode);
    referenceLow = referenceLow ?? (defaults.refLow ? Number(defaults.refLow) : null);
    referenceHigh = referenceHigh ?? (defaults.refHigh ? Number(defaults.refHigh) : null);
    unit = unit ?? defaults.unit;
  }

  const abnormalFlag = computeAbnormal(
    payload.resultValueNum ?? null,
    referenceLow,
    referenceHigh,
  );

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.labResult.create({
      data: {
        labOrderId,
        labOrderItemId: payload.labOrderItemId,
        patientId,
        resultValue: payload.resultValue ?? null,
        resultValueNum: payload.resultValueNum ?? null,
        unit,
        referenceLow,
        referenceHigh,
        abnormalFlag,
        resultedBy: labTechUserId,
        notes: payload.notes ?? null,
      },
    });

    await tx.labOrderItem.update({
      where: { labOrderItemId: payload.labOrderItemId },
      data: { status: LabItemStatus.RESULTED },
    });

    const siblingItems = await tx.labOrderItem.findMany({
      where: { labOrderId },
      select: { labOrderItemId: true, status: true },
    });

    const allResulted = siblingItems.every((item) => item.status === LabItemStatus.RESULTED);

    const currentOrder = await tx.labOrder.findUnique({
      where: { labOrderId },
      select: { status: true },
    });

    if (currentOrder && currentOrder.status !== LabOrderStatus.CANCELLED) {
      await tx.labOrder.update({
        where: { labOrderId },
        data: {
          status: allResulted ? LabOrderStatus.COMPLETED : LabOrderStatus.IN_PROGRESS,
        },
      });
    }

    return created;
  });

  // Notify Atenxion agent about lab result creation
  try {
    const { recordAtenxionTransaction } = await import('../services/atenxion.js');
    await recordAtenxionTransaction(patientId);
    console.log('Atenxion transaction recorded for lab result creation:', result.labResultId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for lab result creation:', error);
  }

  return result;
}

export async function getLabOrderDetail(labOrderId: string) {
  // First get the order to find its doctorId
  const order = await prisma.labOrder.findUnique({
    where: { labOrderId },
    select: { doctorId: true },
  });

  // Get all orders for this doctor to calculate the order number
  const doctorOrders = order?.doctorId
    ? await prisma.labOrder.findMany({
        where: { doctorId: order.doctorId },
        orderBy: { createdAt: 'desc' },
        select: { labOrderId: true, createdAt: true },
      })
    : [];

  // Find the index of this order in the doctor's orders (1-based)
  const orderIndex = doctorOrders.findIndex((o) => o.labOrderId === labOrderId);
  const orderId = orderIndex >= 0 ? String(orderIndex + 1) : null;
  
  const orderDetail = await prisma.labOrder.findUnique({
    where: { labOrderId },
    include: {
      items: {
        include: { results: { orderBy: { resultedAt: 'desc' } } },
      },
      results: { orderBy: { resultedAt: 'desc' } },
    },
  });

  if (!orderDetail) {
    return null;
  }

  return {
    ...orderDetail,
    orderId,
  };
}

export async function deleteLabOrder(labOrderId: string) {
  // Delete the lab order (cascade will delete items and results)
  await prisma.labOrder.delete({
    where: { labOrderId },
  });
}

export async function generateLabReportPdf(labOrderId: string) {
  // Placeholder implementation. A real implementation would build a PDF buffer.
  return Buffer.from(`PDF report for lab order ${labOrderId}`);
}
