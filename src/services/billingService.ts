import {
  InvoiceStatus,
  ItemSourceType,
  PaymentMethod,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { BadRequestError, NotFoundError } from '../utils/httpErrors.js';
import type {
  CreateInvoiceInput,
  InvoiceItemInput,
  UpdateInvoiceItemInput,
} from '../validation/billing.js';

const prisma = new PrismaClient();
const { Decimal } = Prisma;

type TransactionClient = Prisma.TransactionClient | PrismaClient;

function toDecimal(value: string | undefined): Prisma.Decimal {
  if (typeof value === 'undefined') {
    return new Decimal(0);
  }
  return new Decimal(value);
}

function normalizeMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function ensureNonNegative(value: Prisma.Decimal, message: string) {
  if (value.lessThan(0)) {
    throw new BadRequestError(message);
  }
}

function formatYangonDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.format(date).split('-');
  return parts.join('');
}

async function buildInvoiceItemData(
  tx: TransactionClient,
  invoiceId: string,
  payload: InvoiceItemInput,
) {
  let description = payload.description?.trim();
  if (!description && payload.sourceType === ItemSourceType.SERVICE && payload.serviceId) {
    const service = await tx.serviceCatalog.findUnique({
      where: { serviceId: payload.serviceId },
    });
    if (!service) {
      throw new NotFoundError('Service not found');
    }
    description = service.name;
  }

  if (!description) {
    throw new BadRequestError('Description is required');
  }

  const quantity = payload.quantity;
  const unitPrice = normalizeMoney(toDecimal(payload.unitPrice));
  const discountAmt = normalizeMoney(toDecimal(payload.discountAmt));
  const taxAmt = normalizeMoney(toDecimal(payload.taxAmt));

  ensureNonNegative(discountAmt, 'Discount cannot be negative');
  ensureNonNegative(taxAmt, 'Tax cannot be negative');

  const base = normalizeMoney(unitPrice.mul(quantity));
  ensureNonNegative(base, 'Base amount cannot be negative');

  if (discountAmt.greaterThan(base)) {
    throw new BadRequestError('Discount cannot exceed line base amount');
  }

  const lineTotal = normalizeMoney(base.minus(discountAmt).plus(taxAmt));
  ensureNonNegative(lineTotal, 'Line total cannot be negative');

  return {
    invoiceId,
    sourceType: payload.sourceType,
    sourceRefId: payload.sourceRefId ?? null,
    serviceId: payload.serviceId ?? null,
    description,
    quantity,
    unitPrice,
    discountAmt,
    taxAmt,
    lineTotal,
  } satisfies Prisma.InvoiceItemUncheckedCreateInput;
}

async function assertInvoiceEditable(invoice: { status: InvoiceStatus }) {
  if (invoice.status === InvoiceStatus.VOID || invoice.status === InvoiceStatus.REFUNDED) {
    throw new BadRequestError('Invoice is void and cannot be modified');
  }
}

export async function generateInvoiceNo(tx: TransactionClient = prisma) {
  const dateCode = formatYangonDate(new Date());
  const prefix = `INV-${dateCode}-`;
  const count = await tx.invoice.count({
    where: { invoiceNo: { startsWith: prefix } },
  });
  const sequence = (count + 1).toString().padStart(4, '0');
  return `${prefix}${sequence}`;
}

export async function computeTotals(invoiceId: string, tx: TransactionClient = prisma) {
  const invoice = await tx.invoice.findUnique({
    where: { invoiceId },
    include: {
      items: true,
      payments: { include: { allocations: true } },
    },
  });

  if (!invoice) {
    throw new NotFoundError('Invoice not found');
  }

  const zero = new Decimal(0);
  const subTotal = invoice.items.reduce((sum, item) => sum.plus(item.lineTotal), zero);
  const normalizedSubTotal = normalizeMoney(subTotal);

  const invoiceDiscount = normalizeMoney(invoice.discountAmt ?? zero);
  const invoiceTax = normalizeMoney(invoice.taxAmt ?? zero);

  let grandTotal = normalizeMoney(normalizedSubTotal.minus(invoiceDiscount).plus(invoiceTax));
  if (grandTotal.lessThan(0)) {
    grandTotal = zero;
  }

  const amountPaid = invoice.payments.reduce((acc, payment) => {
    const allocated = payment.allocations.reduce(
      (sum, allocation) => sum.plus(allocation.amount),
      zero,
    );
    return acc.plus(allocated);
  }, zero);
  const normalizedPaid = normalizeMoney(amountPaid);

  let amountDue = normalizeMoney(grandTotal.minus(normalizedPaid));
  if (amountDue.lessThan(0)) {
    amountDue = zero;
  }

  let status = invoice.status;
  if (status === InvoiceStatus.VOID || status === InvoiceStatus.REFUNDED) {
    amountDue = zero;
  } else if (invoice.items.length === 0 && normalizedPaid.equals(zero)) {
    status = InvoiceStatus.DRAFT;
  } else if (amountDue.equals(grandTotal)) {
    status = InvoiceStatus.PENDING;
  } else if (amountDue.greaterThan(zero)) {
    status = InvoiceStatus.PARTIALLY_PAID;
  } else {
    status = InvoiceStatus.PAID;
  }

  return tx.invoice.update({
    where: { invoiceId },
    data: {
      subTotal: normalizedSubTotal,
      discountAmt: invoiceDiscount,
      taxAmt: invoiceTax,
      grandTotal,
      amountPaid: normalizedPaid,
      amountDue,
      status,
    },
  });
}

export async function createInvoice(payload: CreateInvoiceInput) {
  return prisma.$transaction(async (tx) => {
    const invoiceNo = await generateInvoiceNo(tx);
    const discountAmt = normalizeMoney(toDecimal(payload.invoiceDiscountAmt));
    const taxAmt = normalizeMoney(toDecimal(payload.invoiceTaxAmt));
    ensureNonNegative(discountAmt, 'Invoice discount cannot be negative');
    ensureNonNegative(taxAmt, 'Invoice tax cannot be negative');
    const invoice = await tx.invoice.create({
      data: {
        invoiceNo,
        visitId: payload.visitId,
        patientId: payload.patientId,
        note: payload.note ?? null,
        discountAmt,
        taxAmt,
      },
    });

    if (payload.items?.length) {
      for (const item of payload.items) {
        const data = await buildInvoiceItemData(tx, invoice.invoiceId, item);
        await tx.invoiceItem.create({ data });
      }
    }

    const result = await computeTotals(invoice.invoiceId, tx);
    
    // Notify Atenxion agent about invoice creation
    try {
      const { recordAtenxionTransaction } = await import('./atenxion.js');
      await recordAtenxionTransaction(payload.patientId);
      console.log('Atenxion transaction recorded for invoice creation:', invoice.invoiceId);
    } catch (error) {
      console.warn('Failed to record Atenxion transaction for invoice creation:', error);
    }
    
    return result;
  });
}

export async function addInvoiceItem(invoiceId: string, item: InvoiceItemInput) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { invoiceId } });
    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }
    await assertInvoiceEditable(invoice);
    const data = await buildInvoiceItemData(tx, invoiceId, item);
    const created = await tx.invoiceItem.create({ data });
    await computeTotals(invoiceId, tx);
    return created;
  });
}

export async function updateInvoiceItem(itemId: string, patch: UpdateInvoiceItemInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceItem.findUnique({
      where: { itemId },
      include: { Invoice: true },
    });

    if (!existing) {
      throw new NotFoundError('Invoice item not found');
    }

    await assertInvoiceEditable(existing.Invoice);

    const quantity = patch.quantity ?? existing.quantity;
    const unitPrice = patch.unitPrice ? normalizeMoney(toDecimal(patch.unitPrice)) : existing.unitPrice;
    const discountAmt = patch.discountAmt
      ? normalizeMoney(toDecimal(patch.discountAmt))
      : existing.discountAmt;
    const taxAmt = patch.taxAmt ? normalizeMoney(toDecimal(patch.taxAmt)) : existing.taxAmt;

    ensureNonNegative(discountAmt, 'Discount cannot be negative');
    ensureNonNegative(taxAmt, 'Tax cannot be negative');

    const base = normalizeMoney(unitPrice.mul(quantity));
    ensureNonNegative(base, 'Base amount cannot be negative');

    if (discountAmt.greaterThan(base)) {
      throw new BadRequestError('Discount cannot exceed line base amount');
    }

    const lineTotal = normalizeMoney(base.minus(discountAmt).plus(taxAmt));
    ensureNonNegative(lineTotal, 'Line total cannot be negative');

    const updated = await tx.invoiceItem.update({
      where: { itemId },
      data: {
        description: patch.description?.trim() ?? existing.description,
        quantity,
        unitPrice,
        discountAmt,
        taxAmt,
        lineTotal,
      },
    });

    await computeTotals(existing.invoiceId, tx);
    return updated;
  });
}

export async function removeInvoiceItem(itemId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceItem.findUnique({
      where: { itemId },
      include: { Invoice: true },
    });
    if (!existing) {
      throw new NotFoundError('Invoice item not found');
    }
    await assertInvoiceEditable(existing.Invoice);
    await tx.invoiceItem.delete({ where: { itemId } });
    await computeTotals(existing.invoiceId, tx);
  });
}

export async function updateInvoiceAdjustments(
  invoiceId: string,
  invoiceDiscountAmt?: string,
  invoiceTaxAmt?: string,
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { invoiceId } });
    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }
    await assertInvoiceEditable(invoice);
    const discountAmt =
      typeof invoiceDiscountAmt !== 'undefined'
        ? normalizeMoney(toDecimal(invoiceDiscountAmt))
        : invoice.discountAmt;
    const taxAmt =
      typeof invoiceTaxAmt !== 'undefined' ? normalizeMoney(toDecimal(invoiceTaxAmt)) : invoice.taxAmt;

    if (discountAmt.lessThan(0) || taxAmt.lessThan(0)) {
      throw new BadRequestError('Discount and tax must be non-negative');
    }

    await tx.invoice.update({
      where: { invoiceId },
      data: {
        discountAmt,
        taxAmt,
      },
    });
    return computeTotals(invoiceId, tx);
  });
}

export async function postPayment(
  invoiceId: string,
  amount: string,
  method: PaymentMethod,
  referenceNo?: string,
  note?: string,
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { invoiceId } });
    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }
    await assertInvoiceEditable(invoice);

    const paymentAmount = normalizeMoney(toDecimal(amount));
    if (paymentAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestError('Payment amount must be greater than zero');
    }

    const payment = await tx.payment.create({
      data: {
        invoiceId,
        method,
        amount: paymentAmount,
        referenceNo: referenceNo ?? null,
        note: note ?? null,
      },
    });

    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.paymentId,
        invoiceId,
        amount: paymentAmount,
      },
    });

    await computeTotals(invoiceId, tx);
    return payment;
  });
}

export async function voidInvoice(invoiceId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { invoiceId } });
    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }
    if (invoice.status === InvoiceStatus.VOID) {
      return invoice;
    }

    await tx.invoice.update({
      where: { invoiceId },
      data: {
        status: InvoiceStatus.VOID,
        amountDue: new Decimal(0),
        note: reason ? `${invoice.note ? `${invoice.note}\n` : ''}Voided: ${reason}` : invoice.note,
      },
    });

    return computeTotals(invoiceId, tx);
  });
}

export async function ensurePharmacyChargeForDispenseItem(dispenseItemId: string) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.dispenseItem.findUnique({
      where: { dispenseItemId: dispenseItemId },
      include: {
        drug: true,
        dispense: {
          include: {
            prescription: true,
          },
        },
      },
    });

    if (!item || !item.dispense.prescription) {
      throw new NotFoundError('Dispense item not found');
    }

    const prescription = item.dispense.prescription;
    let invoice = await tx.invoice.findFirst({
      where: {
        visitId: prescription.visitId,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!invoice) {
      invoice = await tx.invoice.create({
        data: {
          invoiceNo: await generateInvoiceNo(tx),
          visitId: prescription.visitId,
          patientId: prescription.patientId,
          status: InvoiceStatus.DRAFT,
        },
      });
    }

    if (invoice.status === InvoiceStatus.VOID || invoice.status === InvoiceStatus.PAID) {
      return invoice;
    }

    const existingCharge = await tx.invoiceItem.findFirst({
      where: {
        invoiceId: invoice.invoiceId,
        sourceType: ItemSourceType.PHARMACY,
        sourceRefId: dispenseItemId,
      },
    });

    if (existingCharge) {
      return invoice;
    }

    const description = `${item.drug.name} x ${item.quantity}`;
    const unitPrice = normalizeMoney(item.unitPrice ?? new Decimal(0));
    ensureNonNegative(unitPrice, 'Unit price cannot be negative');
    const lineTotal = normalizeMoney(unitPrice);

    await tx.invoiceItem.create({
      data: {
        invoiceId: invoice.invoiceId,
        sourceType: ItemSourceType.PHARMACY,
        sourceRefId: dispenseItemId,
        serviceId: null,
        description,
        quantity: 1,
        unitPrice,
        discountAmt: new Decimal(0),
        taxAmt: new Decimal(0),
        lineTotal,
      },
    });

    await computeTotals(invoice.invoiceId, tx);
    return tx.invoice.findUnique({ where: { invoiceId: invoice.invoiceId } });
  });
}

export async function postPharmacyCharges(prescriptionId: string) {
  const dispenses = await prisma.dispense.findMany({
    where: { prescriptionId, status: 'COMPLETED' },
    include: { items: true },
  });

  let invoiceId: string | null = null;
  for (const dispense of dispenses) {
    for (const item of dispense.items) {
      const invoice = await ensurePharmacyChargeForDispenseItem(item.dispenseItemId);
      invoiceId = invoice?.invoiceId ?? invoiceId;
    }
  }

  if (!invoiceId) {
    return null;
  }

  return prisma.invoice.findUnique({
    where: { invoiceId },
    include: {
      items: true,
      payments: true,
    },
  });
}
