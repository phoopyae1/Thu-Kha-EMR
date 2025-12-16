import { PrismaClient, PrescriptionStatus, DispenseStatus } from '@prisma/client';
import type {
  AdjustStockInput,
  CreateRxInput,
  DispenseItemInput,
  ReceiveStockInput,
} from '../validation/pharmacy.js';

const prisma = new PrismaClient();

export async function allocateFEFO(drugId: string, location: string, neededQty: number) {
  const batches = await prisma.stockItem.findMany({
    where: { drugId, location, qtyOnHand: { gt: 0 } },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  });
  const picks: Array<{ stockItemId: string; qty: number }> = [];
  let remaining = neededQty;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.qtyOnHand, remaining);
    if (take > 0) {
      picks.push({ stockItemId: batch.stockItemId, qty: take });
      remaining -= take;
    }
  }
  return { picks, remaining };
}

export async function checkAllergy(patientId: string, drugNames: string[]): Promise<string[]> {
  try {
    // @ts-ignore Optional table depending on deployment state.
    const allergies = (await prisma.patientAllergy?.findMany({ where: { patientId } })) ?? [];
    const alerts: string[] = [];
    for (const allergy of allergies) {
      const substance = String(allergy.substance ?? '').toLowerCase();
      if (!substance) continue;
      for (const drugName of drugNames) {
        if (drugName.toLowerCase().includes(substance)) {
          alerts.push(allergy.substance);
          break;
        }
      }
    }
    return alerts;
  } catch {
    return [];
  }
}

export async function createPrescription(
  visitId: string,
  doctorId: string,
  patientId: string,
  payload: CreateRxInput,
) {
  const drugIds = payload.items.map((item) => item.drugId);
  const drugs = await prisma.drug.findMany({ where: { drugId: { in: drugIds } } });
  const drugNames = drugs.map((drug) => `${drug.name} ${drug.strength}`.trim());

  const allergyHits = patientId ? await checkAllergy(patientId, drugNames) : [];

  const prescription = await prisma.prescription.create({
    data: {
      visitId,
      doctorId,
      patientId,
      notes: payload.notes ?? null,
      items: {
        create: payload.items.map((item) => ({
          drugId: item.drugId,
          dose: item.dose,
          route: item.route,
          frequency: item.frequency,
          durationDays: item.durationDays,
          quantityPrescribed: item.quantityPrescribed,
          prn: Boolean(item.prn),
          allowGeneric: item.allowGeneric ?? true,
          notes: item.notes ?? null,
        })),
      },
    },
    include: { items: true },
  });

  // Notify Atenxion agent about prescription creation (doctor-specific)
  try {
    const { recordAtenxionTransactionForDoctor } = await import('./atenxion.js');
    await recordAtenxionTransactionForDoctor(doctorId);
    console.log('Atenxion transaction recorded for prescription creation:', prescription.prescriptionId);
  } catch (error) {
    console.warn('Failed to record Atenxion transaction for prescription creation:', error);
  }

  return { prescription, allergyHits };
}

export async function receiveStock(items: ReceiveStockInput) {
  return prisma.$transaction((tx) =>
    Promise.all(
      items.map((item) =>
        tx.stockItem.create({
          data: {
            drugId: item.drugId,
            batchNo: item.batchNo ?? null,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            location: item.location,
            qtyOnHand: item.qtyOnHand,
            unitCost: item.unitCost ?? null,
          },
        }),
      ),
    ),
  );
}

export async function listStockItems(drugId: string) {
  return prisma.stockItem.findMany({
    where: { drugId },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function adjustStock(adjustments: AdjustStockInput) {
  return prisma.$transaction((tx) =>
    Promise.all(
      adjustments.map((adjustment) =>
        tx.stockItem.update({
          where: { stockItemId: adjustment.stockItemId },
          data: { qtyOnHand: adjustment.qtyOnHand },
        }),
      ),
    ),
  );
}

export async function listLowStockInventory(limit = 5, threshold = 10) {
  const drugs = await prisma.drug.findMany({
    where: { isActive: true },
    include: {
      stocks: {
        select: { location: true, qtyOnHand: true },
      },
    },
  });

  const summaries = drugs
    .map((drug) => {
      const totalsByLocation = new Map<string, number>();
      for (const stock of drug.stocks) {
        const current = totalsByLocation.get(stock.location) ?? 0;
        totalsByLocation.set(stock.location, current + stock.qtyOnHand);
      }

      const locations = Array.from(totalsByLocation.entries())
        .map(([location, qtyOnHand]) => ({ location, qtyOnHand }))
        .sort((a, b) => a.qtyOnHand - b.qtyOnHand);

      const totalOnHand = locations.reduce((sum, entry) => sum + entry.qtyOnHand, 0);

      return {
        drugId: drug.drugId,
        name: drug.name,
        genericName: drug.genericName ?? null,
        strength: drug.strength,
        form: drug.form,
        totalOnHand,
        locations,
      };
    })
    .filter((item) => item.totalOnHand <= threshold)
    .sort((a, b) => a.totalOnHand - b.totalOnHand)
    .slice(0, limit);

  return summaries;
}

export async function getPharmacyQueue(
  status: PrescriptionStatus[] = [PrescriptionStatus.PENDING],
) {
  return prisma.prescription.findMany({
    where: { status: { in: status } },
    orderBy: { createdAt: 'desc' },
    include: { items: true, patient: true, doctor: true },
  });
}

export async function startDispense(prescriptionId: string, pharmacistId: string) {
  return prisma.dispense.create({
    data: {
      prescriptionId,
      pharmacistId,
      status: 'READY',
    },
  });
}

export async function addDispenseItem(
  dispenseId: string,
  item: DispenseItemInput,
) {
  return prisma.dispenseItem.create({
    data: {
      dispenseId,
      prescriptionItemId: item.prescriptionItemId,
      stockItemId: item.stockItemId ?? null,
      drugId: item.drugId,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? null,
    },
  });
}

export async function completeDispense(
  dispenseId: string,
  status: Extract<DispenseStatus, 'COMPLETED' | 'PARTIAL'>,
) {
  console.log(`[completeDispense] Starting for dispenseId: ${dispenseId}, status: ${status}`);
  
  try {
    const result = await prisma.$transaction(async (tx) => {
    const dispense = await tx.dispense.findUnique({
      where: { dispenseId },
      include: {
        items: true,
        prescription: {
          include: { items: true },
        },
      },
    });

    if (!dispense) {
      console.error(`[completeDispense] Dispense not found: ${dispenseId}`);
      throw new Error('NOT_FOUND');
    }

    console.log(`[completeDispense] Found dispense for prescriptionId: ${dispense.prescriptionId}, current prescription status: ${dispense.prescription.status}`);
    console.log(`[completeDispense] Dispense items count: ${dispense.items.length}`);

    // Update stock for allocated items
    for (const item of dispense.items) {
      if (!item.stockItemId) continue;
      const updated = await tx.stockItem.update({
        where: { stockItemId: item.stockItemId },
        data: { qtyOnHand: { decrement: item.quantity } },
      });
      if (updated.qtyOnHand < 0) {
        console.error(`[completeDispense] Out of stock for stockItemId: ${item.stockItemId}`);
        throw new Error('OUT_OF_STOCK_RACE');
      }
    }

    // Calculate totals across all dispenses for this prescription FIRST
    // This includes the current dispense items before we update the dispense status
    const totalsBefore = await tx.dispenseItem.groupBy({
      by: ['prescriptionItemId'],
      _sum: { quantity: true },
      where: {
        dispense: {
          prescriptionId: dispense.prescriptionId,
        },
      },
    });
    console.log(`[completeDispense] Totals before status update:`, totalsBefore);

    // Update dispense status
    await tx.dispense.update({
      where: { dispenseId },
      data: {
        status,
        dispensedAt: new Date(),
      },
    });
    console.log(`[completeDispense] Updated dispense status to: ${status}`);

    // Use the totals we calculated before updating status
    const totals = totalsBefore;

    console.log(`[completeDispense] Totals calculated:`, totals);

    // Check if all prescription items are fully met
    const allMet = dispense.prescription.items.every((rxItem) => {
      const sum = totals.find((t) => t.prescriptionItemId === rxItem.itemId)?._sum.quantity ?? 0;
      const met = sum >= rxItem.quantityPrescribed;
      console.log(`[completeDispense] Item ${rxItem.itemId}: required ${rxItem.quantityPrescribed}, dispensed ${sum}, met: ${met}`);
      return met;
    });

    // Determine final status based on dispense status and items met
    // If dispense status is COMPLETED and all items are met, mark as DISPENSED
    // Otherwise mark as PARTIAL
    let finalStatus: PrescriptionStatus;
    if (status === DispenseStatus.COMPLETED && allMet) {
      finalStatus = PrescriptionStatus.DISPENSED;
    } else {
      finalStatus = PrescriptionStatus.PARTIAL;
    }
    
    console.log(`[completeDispense] Dispense status: ${status}, all items met: ${allMet}, final prescription status will be: ${finalStatus}`);

    // Always update prescription status when dispense is completed
    console.log(`[completeDispense] Updating prescription status from ${dispense.prescription.status} to ${finalStatus}`);
    
    const updatedPrescription = await tx.prescription.update({
      where: { prescriptionId: dispense.prescriptionId },
      data: { 
        status: finalStatus,
        // Explicitly set updatedAt to ensure the record is marked as updated
        updatedAt: new Date(),
      },
    });

    console.log(`[completeDispense] Prescription status updated to ${updatedPrescription.status}`);

    // Verify the update succeeded - read it back within the transaction
    const verifyInTx = await tx.prescription.findUnique({
      where: { prescriptionId: dispense.prescriptionId },
      select: { status: true },
    });

    if (!verifyInTx || verifyInTx.status !== finalStatus) {
      console.error(`[completeDispense] Prescription status update FAILED within transaction! Expected ${finalStatus}, got ${verifyInTx?.status}`);
      throw new Error(`Status update failed: expected ${finalStatus}, got ${verifyInTx?.status || 'null'}`);
    }

    console.log(`[completeDispense] Verified prescription status is ${finalStatus} within transaction`);

      return { ok: true, prescriptionStatus: finalStatus, prescriptionId: dispense.prescriptionId };
    }, {
      timeout: 10000, // 10 second timeout
      isolationLevel: 'ReadCommitted', // Ensure we can see committed changes
    });

    console.log(`[completeDispense] Transaction completed successfully. Result:`, result);
    
    // Double-check the status was actually saved after transaction commits
    const finalCheck = await prisma.prescription.findUnique({
      where: { prescriptionId: result.prescriptionId },
      select: { status: true, updatedAt: true },
    });
    
    console.log(`[completeDispense] Final check after transaction: status=${finalCheck?.status}, updatedAt=${finalCheck?.updatedAt}`);
    
    if (finalCheck?.status !== result.prescriptionStatus) {
      console.error(`[completeDispense] CRITICAL: Status mismatch after transaction! Expected ${result.prescriptionStatus}, got ${finalCheck?.status}`);
      // Try one more time to update
      const retryUpdate = await prisma.prescription.update({
        where: { prescriptionId: result.prescriptionId },
        data: { status: result.prescriptionStatus },
      });
      console.log(`[completeDispense] Retry update result: ${retryUpdate.status}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[completeDispense] Transaction failed:`, error);
    throw error;
  }
}
