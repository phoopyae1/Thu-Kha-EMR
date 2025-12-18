import { Router, type Response, type NextFunction } from "express";
import { PrismaClient, MedicationOrderStatus, PrescriptionStatus } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { NotFoundError, BadRequestError } from "../utils/httpErrors.js";

const prisma = new PrismaClient();
const router = Router();

// Middleware to allow either ITAdmin or Pharmacist authentication
function requireITAdminOrPharmacist(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  return requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== "ITAdmin" && req.user.role !== "Pharmacist")) {
      return res.status(403).json({ error: "ITAdmin or Pharmacist access required", msg: "Failed" });
    }
    return next();
  });
}

// Schema for updating medication order status
// Accepts simple status names: pending, approve, deliver, cancel, shipped
const UpdateMedicationOrderStatusSchema = z.object({
  orderId: z.string().uuid("orderId must be a valid UUID"),
  status: z.enum(["pending", "approve", "deliver", "cancel", "shipped"], {
    errorMap: () => ({ message: "Status must be one of: pending, approve, deliver, cancel, shipped" }),
  }),
  notes: z.string().max(500).optional(),
  pharmacistId: z.string().uuid("pharmacistId must be a valid UUID").optional(),
});

// Schema for updating prescription status
// Accepts simple status names: complete (DISPENSED) or partial (PARTIAL)
const UpdatePrescriptionStatusSchema = z.object({
  prescriptionId: z.string().uuid("prescriptionId must be a valid UUID"),
  status: z.enum(["complete", "partial"], {
    errorMap: () => ({ message: "Status must be one of: complete, partial" }),
  }),
  notes: z.string().max(500).optional(),
  pharmacistId: z.string().uuid("pharmacistId must be a valid UUID").optional(),
});

// Schema for viewing dispensing queue
// Accepts simple status names: pending, partial, complete (DISPENSED)
// Can also update prescription status if prescriptionId and status are provided
const ViewDispensingQueueSchema = z.object({
  // Filter parameters for viewing queue
  status: z.enum(["pending", "partial", "complete"], {
    errorMap: () => ({ message: "Status must be one of: pending, partial, complete" }),
  }).optional(),
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  // Update prescription status (same format as /prescription-status endpoint)
  prescriptionId: z.string().uuid("prescriptionId must be a valid UUID").optional(),
  notes: z.string().max(500).optional(),
});

// Map simple status names to enum values for medication orders
function mapStatusToEnum(status: string): MedicationOrderStatus {
  const statusMap: Record<string, MedicationOrderStatus> = {
    pending: MedicationOrderStatus.PENDING,
    approve: MedicationOrderStatus.APPROVED,
    deliver: MedicationOrderStatus.DELIVERED,
    cancel: MedicationOrderStatus.CANCELLED,
    shipped: MedicationOrderStatus.SHIPPED,
  };
  return statusMap[status.toLowerCase()] || MedicationOrderStatus.PENDING;
}

// Map simple status names to PrescriptionStatus enum values
function mapPrescriptionStatusToEnum(status: string): PrescriptionStatus {
  const statusMap: Record<string, PrescriptionStatus> = {
    complete: PrescriptionStatus.DISPENSED,
    partial: PrescriptionStatus.PARTIAL,
    pending: PrescriptionStatus.PENDING,
  };
  return statusMap[status.toLowerCase()] || PrescriptionStatus.PENDING;
}

// POST endpoint to update medication order status (following agent API style)
router.post(
  "/medication-order-status",
  requireITAdminOrPharmacist,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body
      const validationResult = UpdateMedicationOrderStatusSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { orderId, status, notes, pharmacistId } = validationResult.data;

      // Validate pharmacistId if provided (must match authenticated user)
      if (pharmacistId && pharmacistId !== user.userId) {
        return res.status(403).json({
          error: "pharmacistId does not match authenticated user",
          msg: "Failed",
        });
      }

      // Use pharmacistId from request body if provided, otherwise use authenticated user's userId
      const effectivePharmacistId = pharmacistId || user.userId;

      // Check if medication order exists
      const medicationOrder = await prisma.medicationOrder.findUnique({
        where: { orderId },
        select: {
          orderId: true,
          status: true,
          patientId: true,
        },
      });

      if (!medicationOrder) {
        return res.status(404).json({
          error: `Medication order not found with orderId: ${orderId}`,
          msg: "Failed",
        });
      }

      // Map simple status name to enum
      const newStatus = mapStatusToEnum(status);

      // Prepare update data
      const updateData: any = {
        status: newStatus,
        updatedById: effectivePharmacistId,
      };

      // If approving, set approvedById and approvedAt
      if (newStatus === MedicationOrderStatus.APPROVED) {
        updateData.approvedById = effectivePharmacistId;
        updateData.approvedAt = new Date();
      }

      // If notes provided, update notes
      if (notes !== undefined) {
        updateData.notes = notes;
      }

      // Update medication order
      const updatedOrder = await prisma.medicationOrder.update({
        where: { orderId },
        data: updateData,
        include: {
          patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
              contact: true,
            },
          },
          prescription: {
            include: {
              items: {
                include: {
                  drug: true,
                },
              },
              visit: {
                include: {
                  doctor: {
                    select: {
                      doctorId: true,
                      name: true,
                      department: true,
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
            },
          },
          updatedBy: {
            select: {
              userId: true,
              email: true,
            },
          },
        },
      });

      // Helper function to map status to readable text
      const getStatusText = (status: string): string => {
        const statusMap: Record<string, string> = {
          PENDING: "Pending",
          APPROVED: "Approved",
          SHIPPING: "Shipping",
          ON_THE_WAY: "On the way",
          SHIPPED: "Shipped",
          DELIVERED: "Delivered",
          CANCELLED: "Cancelled",
          REJECTED: "Rejected",
        };
        return statusMap[status] || status;
      };

      // Format response
      const firstPrescriptionItem = updatedOrder.prescription?.items?.[0];
      const drug = firstPrescriptionItem?.drug;

      const result = {
        msg: "Success",
        orderId: updatedOrder.orderId,
        status: getStatusText(updatedOrder.status || "PENDING"),
        statusCode: updatedOrder.status,
        drugName: updatedOrder.drugName || drug?.name || null,
        dosage: updatedOrder.dosage || firstPrescriptionItem?.dose || null,
        instructions: updatedOrder.instructions || firstPrescriptionItem?.notes || null,
        quantity: updatedOrder.quantity || firstPrescriptionItem?.quantityPrescribed || null,
        notes: updatedOrder.notes || null,
        createdAt: updatedOrder.createdAt.toISOString().split("T")[0],
        createdTime: updatedOrder.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        updatedAt: updatedOrder.updatedAt.toISOString().split("T")[0],
        updatedTime: updatedOrder.updatedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        approvedAt: updatedOrder.approvedAt ? updatedOrder.approvedAt.toISOString().split("T")[0] : null,
        approvedTime: updatedOrder.approvedAt
          ? updatedOrder.approvedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00"
          : null,

        // Patient Information
        patientId: updatedOrder.patientId,
        patientName: updatedOrder.patient.name,
        patientDob: updatedOrder.patient.dob.toISOString().split("T")[0],
        patientGender: updatedOrder.patient.gender,
        patientContact: updatedOrder.patient.contact,

        // Prescription Information
        prescriptionId: updatedOrder.prescriptionId || null,
        visitId: updatedOrder.prescription?.visit?.visitId || null,
        visitDate: updatedOrder.prescription?.visit?.visitDate
          ? updatedOrder.prescription.visit.visitDate.toISOString().split("T")[0]
          : null,

        // Doctor Information
        doctorId: updatedOrder.prescription?.visit?.doctor?.doctorId || null,
        doctorName: updatedOrder.prescription?.visit?.doctor?.name || null,
        doctorDepartment: updatedOrder.prescription?.visit?.doctor?.department || null,

        // Approval Information
        approvedBy: updatedOrder.approvedBy?.email || null,
        approvedByUserId: updatedOrder.approvedById || null,
        updatedBy: updatedOrder.updatedBy?.email || null,
        updatedByUserId: updatedOrder.updatedById || null,
        
        // Pharmacist Information
        pharmacistId: effectivePharmacistId,
      };

      res.json(result);
    } catch (error: unknown) {
      console.error("Update Medication Order Status Error:", error);

      if (error instanceof NotFoundError) {
        return res.status(404).json({
          error: error.message,
          msg: "Failed",
        });
      }

      if (error instanceof BadRequestError) {
        return res.status(400).json({
          error: error.message,
          msg: "Failed",
        });
      }

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update medication order status",
        msg: "Failed",
      });
    }
  }
);

// Update prescription status (Complete Dispense or Mark Partial)
router.post(
  "/prescription-status",
  requireITAdminOrPharmacist,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body
      const validationResult = UpdatePrescriptionStatusSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { prescriptionId, status, notes, pharmacistId } = validationResult.data;

      // Validate pharmacistId if provided (must match authenticated user)
      if (pharmacistId && pharmacistId !== user.userId) {
        return res.status(403).json({
          error: "pharmacistId does not match authenticated user",
          msg: "Failed",
        });
      }

      // Use pharmacistId from request body if provided, otherwise use authenticated user's userId
      const effectivePharmacistId = pharmacistId || user.userId;

      // Check if prescription exists
      const prescription = await prisma.prescription.findUnique({
        where: { prescriptionId },
        select: {
          prescriptionId: true,
          status: true,
          patientId: true,
        },
      });

      if (!prescription) {
        return res.status(404).json({
          error: `Prescription not found with prescriptionId: ${prescriptionId}`,
          msg: "Failed",
        });
      }

      // Map simple status name to enum
      const newStatus = mapPrescriptionStatusToEnum(status);

      // Prepare update data
      const updateData: any = {
        status: newStatus,
      };

      // If notes provided, update notes
      if (notes !== undefined) {
        updateData.notes = notes;
      }

      // Update prescription
      const updatedPrescription = await prisma.prescription.update({
        where: { prescriptionId },
        data: updateData,
        include: {
          patient: {
            select: {
              patientId: true,
              name: true,
              contact: true,
            },
          },
          doctor: {
            select: {
              doctorId: true,
              name: true,
              department: true,
            },
          },
          items: {
            include: {
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
          visit: {
            select: {
              visitId: true,
              visitDate: true,
              department: true,
              reason: true,
            },
          },
        },
      });

      // Format response
      const result = {
        msg: "Success",
        prescriptionId: updatedPrescription.prescriptionId,
        status: updatedPrescription.status,
        statusRequested: status, // "complete" or "partial"
        notes: updatedPrescription.notes || null,
        createdAt: updatedPrescription.createdAt.toISOString().split("T")[0],
        createdTime: updatedPrescription.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        updatedAt: updatedPrescription.updatedAt.toISOString().split("T")[0],
        updatedTime: updatedPrescription.updatedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",

        // Patient Information
        patientId: updatedPrescription.patientId,
        patientName: updatedPrescription.patient.name,
        patientContact: updatedPrescription.patient.contact || null,

        // Doctor Information
        doctorId: updatedPrescription.doctorId,
        doctorName: updatedPrescription.doctor.name,
        doctorDepartment: updatedPrescription.doctor.department,

        // Visit Information
        visitId: updatedPrescription.visitId,
        visitDate: updatedPrescription.visit?.visitDate
          ? updatedPrescription.visit.visitDate.toISOString().split("T")[0]
          : null,
        visitDepartment: updatedPrescription.visit?.department || null,
        visitReason: updatedPrescription.visit?.reason || null,

        // Prescription Items
        itemsCount: updatedPrescription.items.length,
        items: updatedPrescription.items.map((item: any) => ({
          itemId: item.itemId,
          drugId: item.drugId,
          drugName: item.drug?.name || null,
          drugStrength: item.drug?.strength || null,
          drugForm: item.drug?.form || null,
          dose: item.dose,
          route: item.route,
          frequency: item.frequency,
          durationDays: item.durationDays,
          quantityPrescribed: item.quantityPrescribed,
          prn: item.prn,
          notes: item.notes || null,
        })),

        // Pharmacist Information
        pharmacistId: effectivePharmacistId,
      };

      res.json(result);
    } catch (error: unknown) {
      console.error("Update Prescription Status Error:", error);

      if (error instanceof NotFoundError) {
        return res.status(404).json({
          error: error.message,
          msg: "Failed",
        });
      }

      if (error instanceof BadRequestError) {
        return res.status(400).json({
          error: error.message,
          msg: "Failed",
        });
      }

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to update prescription status",
        msg: "Failed",
      });
    }
  }
);

// View dispensing queue (prescriptions)
// Can also update prescription status if updatePrescriptionId and updateStatus are provided
// router.post(
//   "/dispensing-queue",
//   requireITAdminOrPharmacist,
//   async (req: AuthRequest, res: Response, next: NextFunction) => {
//     try {
//       const user = req.user;
//       if (!user) {
//         return res.status(401).json({
//           error: "Unauthorized",
//           msg: "Failed",
//         });
//       }

//       // Validate request body
//       const validationResult = ViewDispensingQueueSchema.safeParse(req.body);
//       if (!validationResult.success) {
//         return res.status(400).json({
//           error: "Invalid request body",
//           details: validationResult.error.errors,
//           msg: "Failed",
//         });
//       }

//       const { status, patientId, doctorId, limit, offset, prescriptionId: updatePrescriptionId, notes } = validationResult.data;

//       // Update prescription status if prescriptionId and status are provided
//       // The status field is used for both filtering and updating
//       if (updatePrescriptionId && status && (status === "complete" || status === "partial")) {
//         console.log(`[POST /dispensing-queue] Updating prescription ${updatePrescriptionId} status to ${status}`);
        
//         // Check if prescription exists
//         const prescription = await prisma.prescription.findUnique({
//           where: { prescriptionId: updatePrescriptionId },
//           select: { prescriptionId: true, status: true },
//         });

//         if (!prescription) {
//           return res.status(404).json({
//             error: `Prescription not found with prescriptionId: ${updatePrescriptionId}`,
//             msg: "Failed",
//           });
//         }

//         // Map simple status name to enum
//         const newStatus = mapPrescriptionStatusToEnum(status);

//         // Prepare update data
//         const updateData: any = {
//           status: newStatus,
//           updatedAt: new Date(),
//         };

//         // If notes provided, update notes
//         if (notes !== undefined) {
//           updateData.notes = notes;
//         }

//         // Update prescription status
//         const updatedPrescription = await prisma.prescription.update({
//           where: { prescriptionId: updatePrescriptionId },
//           data: updateData,
//         });

//         console.log(`[POST /dispensing-queue] Prescription status updated from ${prescription.status} to ${updatedPrescription.status}`);
//       }

//       // Build where clause
//       const where: any = {};
      
//       if (status) {
//         // Map simple status name to enum value
//         where.status = mapPrescriptionStatusToEnum(status);
//       } else {
//         // Default to PENDING and PARTIAL if no status specified
//         where.status = { in: [PrescriptionStatus.PENDING, PrescriptionStatus.PARTIAL] };
//       }
      
//       if (patientId) {
//         where.patientId = patientId;
//       }
      
//       if (doctorId) {
//         where.doctorId = doctorId;
//       }

//       // Fetch prescriptions with related data
//       const prescriptions = await prisma.prescription.findMany({
//         where,
//         take: limit,
//         skip: offset,
//         orderBy: { createdAt: "desc" },
//         include: {
//           patient: {
//             select: {
//               patientId: true,
//               name: true,
//               contact: true,
//             },
//           },
//           doctor: {
//             select: {
//               doctorId: true,
//               name: true,
//               department: true,
//             },
//           },
//           items: {
//             include: {
//               drug: {
//                 select: {
//                   drugId: true,
//                   name: true,
//                   strength: true,
//                   form: true,
//                 },
//               },
//             },
//           },
//           visit: {
//             select: {
//               visitId: true,
//               visitDate: true,
//               department: true,
//               reason: true,
//             },
//           },
//         },
//       });

//       // Get total count for pagination
//       const totalCount = await prisma.prescription.count({ where });

//       // Get total count in system
//       const totalInSystem = await prisma.prescription.count({});

//       // Calculate status breakdown
//       const statusBreakdown = await prisma.prescription.groupBy({
//         by: ['status'],
//         _count: {
//           prescriptionId: true,
//         },
//       });

//       const statusCounts: Record<string, number> = {};
//       statusBreakdown.forEach((item) => {
//         statusCounts[item.status] = item._count.prescriptionId;
//       });

//       // Format response
//       const formattedPrescriptions = prescriptions.map((prescription: any, index: number) => {
//         const firstItem = prescription.items?.[0];
//         const firstDrug = firstItem?.drug;

//         return {
//           prescriptionId: prescription.prescriptionId,
//           status: prescription.status,
//           createdAt: prescription.createdAt.toISOString().split("T")[0],
//           createdTime: prescription.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
//           notes: prescription.notes || null,

//           // Patient Information
//           patientId: prescription.patientId,
//           patientName: prescription.patient.name,
//           patientContact: prescription.patient.contact || null,

//           // Doctor Information
//           doctorId: prescription.doctorId,
//           doctorName: prescription.doctor.name,
//           doctorDepartment: prescription.doctor.department,

//           // Visit Information
//           visitId: prescription.visitId,
//           visitDate: prescription.visit?.visitDate
//             ? prescription.visit.visitDate.toISOString().split("T")[0]
//             : null,
//           visitDepartment: prescription.visit?.department || null,
//           visitReason: prescription.visit?.reason || null,

//           // Prescription Items
//           itemsCount: prescription.items.length,
//           items: prescription.items.map((item: any) => ({
//             itemId: item.itemId,
//             drugId: item.drugId,
//             drugName: item.drug?.name || null,
//             drugStrength: item.drug?.strength || null,
//             drugForm: item.drug?.form || null,
//             dose: item.dose,
//             route: item.route,
//             frequency: item.frequency,
//             durationDays: item.durationDays,
//             quantityPrescribed: item.quantityPrescribed,
//             prn: item.prn,
//             notes: item.notes || null,
//           })),
//         };
//       });

//       // Build response with flat numbered fields
//       const result: any = {
//         msg: "Success",
//         totalPrescriptions: totalCount,
//         totalPrescriptionsInSystem: totalInSystem,
//         returnedPrescriptions: formattedPrescriptions.length,
//         pagination: {
//           limit,
//           offset,
//           hasMore: offset + limit < totalCount,
//         },
//         statusBreakdown: statusCounts,
//         prescriptions: formattedPrescriptions,
//       };

//       // Add numbered prescription fields for flat response
//       formattedPrescriptions.forEach((prescription: any, index: number) => {
//         const prefix = `prescription${index + 1}`;
//         result[`${prefix}PrescriptionId`] = prescription.prescriptionId;
//         result[`${prefix}Status`] = prescription.status;
//         result[`${prefix}PatientId`] = prescription.patientId;
//         result[`${prefix}PatientName`] = prescription.patientName;
//         result[`${prefix}PatientContact`] = prescription.patientContact;
//         result[`${prefix}DoctorId`] = prescription.doctorId;
//         result[`${prefix}DoctorName`] = prescription.doctorName;
//         result[`${prefix}DoctorDepartment`] = prescription.doctorDepartment;
//         result[`${prefix}VisitId`] = prescription.visitId;
//         result[`${prefix}VisitDate`] = prescription.visitDate;
//         result[`${prefix}CreatedAt`] = prescription.createdAt;
//         result[`${prefix}CreatedTime`] = prescription.createdTime;
//         result[`${prefix}ItemsCount`] = prescription.itemsCount;

//         // Add first item details (for flat response)
//         if (prescription.items.length > 0) {
//           const firstItem = prescription.items[0];
//           result[`${prefix}Item1ItemId`] = firstItem.itemId;
//           result[`${prefix}Item1DrugId`] = firstItem.drugId;
//           result[`${prefix}Item1DrugName`] = firstItem.drugName;
//           result[`${prefix}Item1DrugStrength`] = firstItem.drugStrength;
//           result[`${prefix}Item1DrugForm`] = firstItem.drugForm;
//           result[`${prefix}Item1Dose`] = firstItem.dose;
//           result[`${prefix}Item1Route`] = firstItem.route;
//           result[`${prefix}Item1Frequency`] = firstItem.frequency;
//           result[`${prefix}Item1DurationDays`] = firstItem.durationDays;
//           result[`${prefix}Item1Quantity`] = firstItem.quantityPrescribed;
//           result[`${prefix}Item1Prn`] = firstItem.prn;
//           result[`${prefix}Item1Notes`] = firstItem.notes;
//         }
//       });

//       res.json(result);
//     } catch (error: unknown) {
//       console.error("View Dispensing Queue Error:", error);

//       if (error instanceof NotFoundError) {
//         return res.status(404).json({
//           error: error.message,
//           msg: "Failed",
//         });
//       }

//       if (error instanceof BadRequestError) {
//         return res.status(400).json({
//           error: error.message,
//           msg: "Failed",
//         });
//       }

//       res.status(500).json({
//         error:
//           error instanceof Error
//             ? error.message
//             : "Failed to fetch dispensing queue",
//         msg: "Failed",
//       });
//     }
//   }
// );

// Schema for pharmacist profile operations
// Can be used to get profile (empty body or with pharmacistId) or update profile (with status)
const PharmacistProfileSchema = z.object({
  pharmacistId: z.string().uuid("pharmacistId must be a valid UUID").optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

// POST endpoint for pharmacist profile (get or update)
router.post(
  "/pharmacist-profile",
  requireAuth,
  requireRole('Pharmacist'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Verify user is a Pharmacist
      if (user.role !== "Pharmacist") {
        return res.status(403).json({
          error: "Pharmacist access required",
          msg: "Failed",
        });
      }

      // Validate request body
      const validationResult = PharmacistProfileSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { pharmacistId, status } = validationResult.data;

      // Determine target pharmacist ID
      let targetPharmacistId: string;
      
      if (pharmacistId) {
        // Authorization: Pharmacists can only access their own profile
        if (pharmacistId !== user.userId) {
          return res.status(403).json({
            error: "pharmacistId does not match authenticated user. You can only access your own profile.",
            msg: "Failed",
          });
        }
        targetPharmacistId = pharmacistId;
      } else {
        // Use authenticated user's ID
        targetPharmacistId = user.userId;
      }

      // Check if pharmacist exists
      const pharmacist = await prisma.user.findUnique({
        where: { userId: targetPharmacistId },
        select: {
          userId: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          doctorId: true,
          doctor: {
            select: {
              doctorId: true,
              name: true,
              department: true,
            },
          },
        },
      });

      if (!pharmacist) {
        return res.status(404).json({
          error: `Pharmacist not found with pharmacistId: ${targetPharmacistId}`,
          msg: "Failed",
        });
      }

      // Verify user is a pharmacist (unless ITAdmin)
      if (pharmacist.role !== "Pharmacist") {
        return res.status(400).json({
          error: `User with ID ${targetPharmacistId} is not a pharmacist (role: ${pharmacist.role})`,
          msg: "Failed",
        });
      }

      // If status is provided, update the profile
      if (status !== undefined) {
        // Authorization: Pharmacists can only update their own profile
        if (targetPharmacistId !== user.userId) {
          return res.status(403).json({
            error: "Cannot update other pharmacists' profiles. You can only update your own profile.",
            msg: "Failed",
          });
        }

        const updatedPharmacist = await prisma.user.update({
          where: { userId: targetPharmacistId },
          data: { status },
          select: {
            userId: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            doctorId: true,
            doctor: {
              select: {
                doctorId: true,
                name: true,
                department: true,
              },
            },
          },
        });

        // Get statistics
        const dispenseCount = await prisma.dispense.count({
          where: { pharmacistId: updatedPharmacist.userId },
        });

        const completedDispenseCount = await prisma.dispense.count({
          where: {
            pharmacistId: updatedPharmacist.userId,
            status: "COMPLETED",
          },
        });

        const result = {
          msg: "Success",
          pharmacistId: updatedPharmacist.userId,
          email: updatedPharmacist.email,
          role: updatedPharmacist.role,
          status: updatedPharmacist.status,
          createdAt: updatedPharmacist.createdAt.toISOString().split("T")[0],
          createdTime: updatedPharmacist.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
          updatedAt: updatedPharmacist.updatedAt.toISOString().split("T")[0],
          updatedTime: updatedPharmacist.updatedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
          doctorId: updatedPharmacist.doctorId || null,
          doctorName: updatedPharmacist.doctor?.name || null,
          doctorDepartment: updatedPharmacist.doctor?.department || null,
          totalDispenses: dispenseCount,
          completedDispenses: completedDispenseCount,
        };

        return res.json(result);
      }

      // Otherwise, just return the profile
      // Get statistics
      const dispenseCount = await prisma.dispense.count({
        where: { pharmacistId: pharmacist.userId },
      });

      const completedDispenseCount = await prisma.dispense.count({
        where: {
          pharmacistId: pharmacist.userId,
          status: "COMPLETED",
        },
      });

      const result = {
        msg: "Success",
        pharmacistId: pharmacist.userId,
        email: pharmacist.email,
        role: pharmacist.role,
        status: pharmacist.status,
        createdAt: pharmacist.createdAt.toISOString().split("T")[0],
        createdTime: pharmacist.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        updatedAt: pharmacist.updatedAt.toISOString().split("T")[0],
        updatedTime: pharmacist.updatedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        doctorId: pharmacist.doctorId || null,
        doctorName: pharmacist.doctor?.name || null,
        doctorDepartment: pharmacist.doctor?.department || null,
        totalDispenses: dispenseCount,
        completedDispenses: completedDispenseCount,
      };

      res.json(result);
    } catch (error: unknown) {
      console.error("Pharmacist Profile Error:", error);

      if (error instanceof NotFoundError) {
        return res.status(404).json({
          error: error.message,
          msg: "Failed",
        });
      }

      if (error instanceof BadRequestError) {
        return res.status(400).json({
          error: error.message,
          msg: "Failed",
        });
      }

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to process pharmacist profile request",
        msg: "Failed",
      });
    }
  }
);

export default router;
