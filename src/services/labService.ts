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

type LabOrderWithItems = LabOrder & { 
  items: LabOrderItem[]; 
  orderId?: string | null;
  patientName?: string | null;
};

type ListLabOrderFilters = {
  patientId?: string;
  visitId?: string;
  status?: string;
  doctorId?: string;
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
    include: { 
      items: {
        include: { results: { orderBy: { resultedAt: 'desc' } } },
      },
      results: { orderBy: { resultedAt: 'desc' } },
    },
  });

  // Notify Atenxion agent about lab order creation
  try {
    const { recordAtenxionTransactionForDoctor } = await import('./atenxion.js');
    await recordAtenxionTransactionForDoctor(doctorId);
    console.log('Atenxion transaction recorded for lab order creation:', order.labOrderId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for lab order creation:', error);
  }

  // Calculate orderId and fetch patientName to match the format returned by listLabOrders
  // Fetch ALL orders for this doctor to calculate sequential order number
  const allDoctorOrders = await prisma.labOrder.findMany({
    where: { doctorId },
    select: { labOrderId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  
  // Find the index of this order in the doctor's orders (1-based)
  const orderIndex = allDoctorOrders.findIndex((o) => o.labOrderId === order.labOrderId);
  const orderId = orderIndex >= 0 ? String(orderIndex + 1) : null;
  
  // Fetch patient name
  const patient = await prisma.patient.findUnique({
    where: { patientId: order.patientId },
    select: { name: true },
  });
  const patientName = patient?.name || null;

  // Return order with orderId and patientName added
  return {
    ...order,
    orderId,
    patientName,
  } as LabOrderWithItems;
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
  if (filters.doctorId) {
    where.doctorId = filters.doctorId;
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

  // Get all unique doctor IDs from the filtered orders
  const uniqueDoctorIds = Array.from(new Set(orders.map((o) => o.doctorId).filter(Boolean) as string[]));
  
  // For each doctor, fetch ALL their orders (ignoring filters) to calculate sequential order IDs
  // This ensures order IDs are sequential based on all orders for that doctor, not just filtered results
  // Order IDs are calculated purely by creation date, independent of patient names
  // Each doctor's orders are numbered independently: Doctor A's orders are 1,2,3... Doctor B's orders are 1,2,3...
  const orderIdMap = new Map<string, string>();
  
  for (const doctorId of uniqueDoctorIds) {
    if (!doctorId || typeof doctorId !== 'string') continue;
    
    // Fetch ALL orders for this doctor (no filters) to get the correct sequential numbering
    // This ensures the order ID reflects the position among ALL orders for this doctor
    // Orders are sorted by creation date ascending (oldest first) so the first order gets 1, second gets 2, etc.
    const allDoctorOrders = await prisma.labOrder.findMany({
      where: { doctorId },
      select: { labOrderId: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, // Sort by creation date ascending (oldest first) for sequential numbering
    });
    
    // Assign sequential numbers (1, 2, 3, ...) based on creation order
    // The first order created for this doctor gets 1, second gets 2, etc.
    // This numbering is unique per doctor and independent of patient names
    allDoctorOrders.forEach((order, index) => {
      orderIdMap.set(order.labOrderId, String(index + 1));
    });
  }
  
  // Verify that all orders have been assigned an orderId
  // If an order doesn't have a doctorId or wasn't found in the map, log a warning
  const ordersWithoutOrderId = orders.filter((o) => !orderIdMap.has(o.labOrderId));
  if (ordersWithoutOrderId.length > 0) {
    console.warn(`Warning: ${ordersWithoutOrderId.length} orders were not assigned an orderId. This may indicate missing doctorId.`);
  }

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

  // Get ALL orders for this doctor (sorted by creation date ascending) to calculate sequential order number
  // This ensures the order ID reflects the position among ALL orders for this doctor
  const doctorOrders = order?.doctorId
    ? await prisma.labOrder.findMany({
        where: { doctorId: order.doctorId },
        orderBy: { createdAt: 'asc' }, // Sort ascending to get sequential numbering (1, 2, 3, ...)
        select: { labOrderId: true, createdAt: true },
      })
    : [];

  // Find the index of this order in the doctor's orders (1-based)
  // The first order created gets 1, second gets 2, etc.
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
