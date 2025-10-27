import { type Prisma } from '@prisma/client';

export const medicationOrderSelect = {
  orderId: true,
  patientId: true,
  prescriptionId: true,
  drugName: true,
  dosage: true,
  instructions: true,
  quantity: true,
  status: true,
  notes: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  prescription: {
    select: {
      prescriptionId: true,
      status: true,
      createdAt: true,
      doctor: {
        select: {
          doctorId: true,
          name: true,
          department: true,
        },
      },
      items: {
        select: {
          itemId: true,
          dose: true,
          route: true,
          frequency: true,
          durationDays: true,
          quantityPrescribed: true,
          prn: true,
          notes: true,
          drug: {
            select: {
              drugId: true,
              name: true,
              strength: true,
              form: true,
            },
          },
        },
      },
    },
  },
  approvedBy: {
    select: {
      userId: true,
      email: true,
      role: true,
    },
  },
  updatedBy: {
    select: {
      userId: true,
      email: true,
      role: true,
    },
  },
} satisfies Prisma.MedicationOrderSelect;

export type MedicationOrderWithRelations = Prisma.MedicationOrderGetPayload<{
  select: typeof medicationOrderSelect;
}>;
