import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient, PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { PostPaymentSchema, CreateInvoiceSchema, type CreateInvoiceInput } from "../validation/billing.js";
import { postPayment, createInvoice } from "../services/billingService.js";
import { NotFoundError, BadRequestError } from "../utils/httpErrors.js";

const prisma = new PrismaClient();
const router = Router();

// Helper function to parse JWT payload
function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

// Middleware to allow either Cashier or ITAdmin authentication
function requireCashierOrITAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  return requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== "Cashier" && req.user.role !== "ITAdmin")) {
      return res.status(403).json({ error: "Cashier or ITAdmin access required", msg: "Failed" });
    }
    return next();
  });
}

// Validation schema for cashier agent
const CashierAgentSchema = z.object({
  cashierId: z.string().uuid(),
});

// Validation schema for billing assistant
const BillingAssistantSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

// Validation schema for create billing/payment
const CreateBillingSchema = z.object({
  patientName: z.string().min(1, "Patient name is required"),
  date: z.string().min(1, "Date is required").regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Date must be in YYYY-MM-DD format",
  }),
  time: z.string().optional().refine((val) => {
    if (!val) return true; // Optional, so empty is fine
    // Validate HH:MM or HH:MM:SS format
    return /^([0-1][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(val);
  }, {
    message: "Time must be in HH:MM or HH:MM:SS format",
  }),
  amount: z.union([z.string(), z.number()]).transform((value) => {
    if (typeof value === 'number') {
      return value.toString();
    }
    return value.trim();
  }).refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
    message: 'Invalid monetary amount',
  }),
  method: z.enum(['CASH', 'CARD', 'MOBILE_WALLET', 'BANK_TRANSFER', 'OTHER']),
  referenceNo: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

// Validation schema for create invoice
const CreateInvoiceForPatientSchema = z.object({
  patientName: z.string().min(1, "Patient name is required"),
  date: z.string().min(1, "Date is required").regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Date must be in YYYY-MM-DD format",
  }),
  time: z.string().optional().refine((val) => {
    if (!val) return true; // Optional, so empty is fine
    // Validate HH:MM or HH:MM:SS format
    return /^([0-1][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(val);
  }, {
    message: "Time must be in HH:MM or HH:MM:SS format",
  }),
  note: z.string().max(500).optional(),
  items: z.array(z.object({
    sourceType: z.enum(['SERVICE', 'PHARMACY', 'LAB', 'DOCTOR_FEE']),
    sourceRefId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    description: z.string().trim().min(1).optional(),
    quantity: z.coerce.number().int().positive().optional().default(1),
    unitPrice: z.union([z.string(), z.number()]).transform((value) => {
      if (typeof value === 'number') {
        return value.toString();
      }
      return value.trim();
    }).refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
      message: 'Invalid monetary amount',
    }),
    discountAmt: z.union([z.string(), z.number()]).transform((value) => {
      if (typeof value === 'number') {
        return value.toString();
      }
      return value.trim();
    }).refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
      message: 'Invalid monetary amount',
    }).optional(),
    taxAmt: z.union([z.string(), z.number()]).transform((value) => {
      if (typeof value === 'number') {
        return value.toString();
      }
      return value.trim();
    }).refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
      message: 'Invalid monetary amount',
    }).optional(),
  })).optional(),
  invoiceDiscountAmt: z.union([z.string(), z.number()]).transform((value) => {
    if (typeof value === 'number') {
      return value.toString();
    }
    return value.trim();
  }).refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
    message: 'Invalid monetary amount',
  }).optional(),
  invoiceTaxAmt: z.union([z.string(), z.number()]).transform((value) => {
    if (typeof value === 'number') {
      return value.toString();
    }
    return value.trim();
  }).refine((value) => /^-?\d+(\.\d{1,})?$/.test(value), {
    message: 'Invalid monetary amount',
  }).optional(),
});

// Cashier Profile API - Returns cashier profile information and statistics
router.post(
  "/cashier-profile",
  requireAuth,
  requireRole("Cashier"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body for cashierId
      const validationResult = CashierAgentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { cashierId } = validationResult.data;

      // Verify the cashierId matches the authenticated user's userId
      if (user.userId !== cashierId) {
        return res.status(403).json({
          error: "Forbidden: You can only access your own profile",
          msg: "Failed",
        });
      }

      // Get user info
      const userRecord = await prisma.user.findUnique({
        where: { userId: cashierId },
        select: {
          userId: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!userRecord) {
        return res.status(404).json({
          error: "Cashier not found",
          msg: "Failed",
        });
      }

      // Get statistics - billing information accessible to cashiers
      // Note: Payment model doesn't have cashierId field, so we show overall billing stats
      const [totalInvoices, totalPayments, totalRevenue, paidInvoices, pendingInvoices] = await Promise.all([
        prisma.invoice.count(),
        prisma.payment.count(),
        prisma.payment.aggregate({
          _sum: {
            amount: true,
          },
        }),
        prisma.invoice.count({
          where: {
            status: 'PAID',
          },
        }),
        prisma.invoice.count({
          where: {
            status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          },
        }),
      ]);

      // Get recent statistics (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [recentInvoices, recentPayments, recentRevenue, recentPaidInvoices] = await Promise.all([
        prisma.invoice.count({
          where: {
            createdAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.payment.count({
          where: {
            paidAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.payment.aggregate({
          where: {
            paidAt: { gte: thirtyDaysAgo },
          },
          _sum: {
            amount: true,
          },
        }),
        prisma.invoice.count({
          where: {
            createdAt: { gte: thirtyDaysAgo },
            status: 'PAID',
          },
        }),
      ]);

      // Build flat response structure
      const result: any = {
        status: "Success",
        userId: userRecord.userId,
        userEmail: userRecord.email,
        userRole: userRecord.role,
        userStatus: userRecord.status,
        userCreatedAt: userRecord.createdAt.toISOString().split("T")[0],
        userCreatedTime: userRecord.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        userUpdatedAt: userRecord.updatedAt.toISOString().split("T")[0],

        // Statistics
        totalInvoices: totalInvoices,
        totalPayments: totalPayments,
        totalRevenue: totalRevenue._sum.amount ? Number(totalRevenue._sum.amount) : 0,
        paidInvoices: paidInvoices,
        pendingInvoices: pendingInvoices,
        recentInvoicesLast30Days: recentInvoices,
        recentPaymentsLast30Days: recentPayments,
        recentRevenueLast30Days: recentRevenue._sum.amount ? Number(recentRevenue._sum.amount) : 0,
        recentPaidInvoicesLast30Days: recentPaidInvoices,
      };

      res.json(result);
    } catch (error) {
      console.error("Cashier Agent Profile Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch cashier profile",
        msg: "Failed",
      });
    }
  }
);

// Billing Assistant API - Returns detailed billing information with patient, doctor, and fee breakdowns
router.post(
  "/billing-assistant",
  requireCashierOrITAdmin,
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
      const validationResult = BillingAssistantSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { invoiceId, patientId, doctorId, status, limit, offset } = validationResult.data;

      // Build where clause
      const where: any = {};
      if (invoiceId) {
        where.invoiceId = invoiceId;
      }
      if (patientId) {
        where.patientId = patientId;
      }
      if (doctorId) {
        where.Visit = { doctorId };
      }
      if (status) {
        where.status = status.toUpperCase();
      }

      // Fetch invoices with related data
      const invoices = await prisma.invoice.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          Patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
              contact: true,
              insurance: true,
            },
          },
          Visit: {
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
          items: {
            select: {
              itemId: true,
              sourceType: true,
              sourceRefId: true,
              serviceId: true,
              description: true,
              quantity: true,
              unitPrice: true,
              discountAmt: true,
              taxAmt: true,
              lineTotal: true,
              Service: {
                select: {
                  serviceId: true,
                  code: true,
                  name: true,
                  defaultPrice: true,
                },
              },
            },
          },
          payments: {
            select: {
              paymentId: true,
              method: true,
              amount: true,
              paidAt: true,
              referenceNo: true,
              note: true,
            },
            orderBy: { paidAt: 'desc' },
          },
        },
      });

      // Format response with detailed billing information
      const result = invoices.map((invoice: any) => {
        const patient = invoice.Patient;
        const visit = invoice.Visit;
        const doctor = visit?.doctor;

        return {
          // Invoice Information
          invoiceId: invoice.invoiceId,
          invoiceNo: invoice.invoiceNo,
          status: invoice.status,
          currency: invoice.currency,
          createdAt: invoice.createdAt.toISOString(),
          updatedAt: invoice.updatedAt.toISOString(),
          note: invoice.note,

          // Patient Information
          patientId: patient.patientId,
          patientName: patient.name,
          patientDob: patient.dob.toISOString().split("T")[0],
          patientGender: patient.gender,
          patientContact: patient.contact,
          patientInsurance: patient.insurance,

          // Doctor Information
          doctorId: doctor?.doctorId || null,
          doctorName: doctor?.name || null,
          doctorDepartment: doctor?.department || null,

          // Visit Information
          visitId: visit?.visitId || null,
          visitDate: visit?.visitDate ? visit.visitDate.toISOString().split("T")[0] : null,
          visitDepartment: visit?.department || null,
          visitReason: visit?.reason || null,

          // Financial Summary
          subTotal: Number(invoice.subTotal),
          discountAmt: Number(invoice.discountAmt),
          taxAmt: Number(invoice.taxAmt),
          grandTotal: Number(invoice.grandTotal),
          amountPaid: Number(invoice.amountPaid),
          amountDue: Number(invoice.amountDue),

          // Invoice Items (Fees Breakdown)
          items: invoice.items.map((item: any) => ({
            itemId: item.itemId,
            sourceType: item.sourceType,
            sourceRefId: item.sourceRefId,
            serviceId: item.serviceId,
            serviceCode: item.Service?.code || null,
            serviceName: item.Service?.name || null,
            serviceDefaultPrice: item.Service?.defaultPrice ? Number(item.Service.defaultPrice) : null,
            description: item.description,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            discountAmt: Number(item.discountAmt),
            taxAmt: Number(item.taxAmt),
            lineTotal: Number(item.lineTotal),
          })),

          // Payments
          payments: invoice.payments.map((payment: any) => ({
            paymentId: payment.paymentId,
            method: payment.method,
            amount: Number(payment.amount),
            paidAt: payment.paidAt.toISOString(),
            referenceNo: payment.referenceNo,
            note: payment.note,
          })),
        };
      });

      // Get total count for pagination
      const totalCount = await prisma.invoice.count({ where });

      res.json({
        status: "Success",
        data: result,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      });
    } catch (error) {
      console.error("Billing Assistant Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch billing information",
        msg: "Failed",
      });
    }
  }
);

// Create Billing/Payment API - Creates a payment for an invoice (cash, card, mobile wallet, bank transfer, etc.)
router.post(
  "/create-billing",
  requireCashierOrITAdmin,
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
      const validationResult = CreateBillingSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientName, date, time, amount, method, referenceNo, note } = validationResult.data;

      // Find patient by name (case-insensitive, exact match)
      const patientRecord = await prisma.patient.findFirst({
        where: {
          name: {
            equals: patientName,
            mode: 'insensitive',
          },
        },
        select: {
          patientId: true,
          name: true,
        },
      });

      if (!patientRecord) {
        return res.status(404).json({
          error: `Patient not found with name: ${patientName}`,
          msg: "Failed",
        });
      }

      // Combine date and time to create visitDate
      let visitDate: Date;
      try {
        const dateTimeString = time ? `${date} ${time}` : date;
        visitDate = new Date(dateTimeString);
        if (isNaN(visitDate.getTime())) {
          return res.status(400).json({
            error: "Invalid date/time format. Date must be YYYY-MM-DD and time must be HH:MM or HH:MM:SS",
            msg: "Failed",
          });
        }
      } catch (error) {
        return res.status(400).json({
          error: "Invalid date/time format. Date must be YYYY-MM-DD and time must be HH:MM or HH:MM:SS",
          msg: "Failed",
        });
      }

      // Find visit by patientId and visitDate (match by date, ignoring time component for date-only inputs)
      const visitDateStart = new Date(visitDate);
      visitDateStart.setHours(0, 0, 0, 0);
      const visitDateEnd = new Date(visitDate);
      visitDateEnd.setHours(23, 59, 59, 999);

      const visitRecord = await prisma.visit.findFirst({
        where: {
          patientId: patientRecord.patientId,
          visitDate: {
            gte: visitDateStart,
            lte: visitDateEnd,
          },
        },
        select: {
          visitId: true,
          visitDate: true,
        },
        orderBy: {
          visitDate: 'desc',
        },
      });

      if (!visitRecord) {
        const dateTimeDisplay = time ? `${date} ${time}` : date;
        return res.status(404).json({
          error: `Visit not found for patient "${patientName}" on ${dateTimeDisplay}`,
          msg: "Failed",
        });
      }

      // Find invoice by visitId
      const invoiceRecord = await prisma.invoice.findFirst({
        where: {
          visitId: visitRecord.visitId,
        },
        select: {
          invoiceId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!invoiceRecord) {
        const dateTimeDisplay = time ? `${date} ${time}` : date;
        return res.status(404).json({
          error: `Invoice not found for patient "${patientName}" visit on ${dateTimeDisplay}`,
          msg: "Failed",
        });
      }

      const invoiceId = invoiceRecord.invoiceId;

      // Convert method string to PaymentMethod enum
      const paymentMethod = method as PaymentMethod;

      // Create payment using billing service
      const payment = await postPayment(
        invoiceId,
        amount,
        paymentMethod,
        referenceNo,
        note
      );

      // Fetch updated invoice with related data for response
      const invoice = await prisma.invoice.findUnique({
        where: { invoiceId },
        include: {
          Patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
              contact: true,
              insurance: true,
            },
          },
          Visit: {
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
          payments: {
            select: {
              paymentId: true,
              method: true,
              amount: true,
              paidAt: true,
              referenceNo: true,
              note: true,
            },
            orderBy: { paidAt: 'desc' },
          },
        },
      });

      if (!invoice) {
        return res.status(404).json({
          error: "Invoice not found",
          msg: "Failed",
        });
      }

      const patient = invoice.Patient;
      const visit = invoice.Visit;
      const doctor = visit?.doctor;

      // Build flat response structure
      const result: any = {
        msg: "Success",
        paymentId: payment.paymentId,
        invoiceId: invoice.invoiceId,
        invoiceNo: invoice.invoiceNo,
        searchedPatientName: patientName,
        searchedDate: date,
        searchedTime: time || null,
        paymentMethod: payment.method,
        paymentAmount: Number(payment.amount),
        paymentPaidAt: payment.paidAt.toISOString().split("T")[0],
        paymentPaidTime: payment.paidAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        paymentReferenceNo: payment.referenceNo || null,
        paymentNote: payment.note || null,

        // Invoice Information
        invoiceStatus: invoice.status,
        invoiceCurrency: invoice.currency,
        invoiceCreatedAt: invoice.createdAt.toISOString().split("T")[0],
        invoiceCreatedTime: invoice.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        invoiceNote: invoice.note || null,

        // Financial Summary
        subTotal: Number(invoice.subTotal),
        discountAmt: Number(invoice.discountAmt),
        taxAmt: Number(invoice.taxAmt),
        grandTotal: Number(invoice.grandTotal),
        amountPaid: Number(invoice.amountPaid),
        amountDue: Number(invoice.amountDue),

        // Patient Information
        patientId: patient.patientId,
        patientName: patient.name,
        patientDob: patient.dob.toISOString().split("T")[0],
        patientGender: patient.gender,
        patientContact: patient.contact,
        patientInsurance: patient.insurance || null,

        // Doctor Information
        doctorId: doctor?.doctorId || null,
        doctorName: doctor?.name || null,
        doctorDepartment: doctor?.department || null,

        // Visit Information
        visitId: visit?.visitId || null,
        visitDate: visit?.visitDate ? visit.visitDate.toISOString().split("T")[0] : null,
        visitDepartment: visit?.department || null,
        visitReason: visit?.reason || null,

        // Cashier Information
        cashierId: user.userId,
        cashierEmail: user.email,
        cashierRole: user.role,
      };

      // Add all payments for this invoice
      result.totalPayments = invoice.payments.length;
      invoice.payments.forEach((pay: any, index: number) => {
        const prefix = `payment${index + 1}`;
        result[`${prefix}PaymentId`] = pay.paymentId;
        result[`${prefix}Method`] = pay.method;
        result[`${prefix}Amount`] = Number(pay.amount);
        result[`${prefix}PaidAt`] = pay.paidAt.toISOString().split("T")[0];
        result[`${prefix}PaidTime`] = pay.paidAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";
        if (pay.referenceNo) result[`${prefix}ReferenceNo`] = pay.referenceNo;
        if (pay.note) result[`${prefix}Note`] = pay.note;
      });

      // Notify Atenxion agent about payment creation (cashier-specific)
      if (user.role === 'Cashier' && user.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(user.userId);
          console.log("Atenxion transaction recorded for payment creation:", payment.paymentId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for payment creation:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }

      res.status(201).json(result);
    } catch (error) {
      console.error("Create Billing Error:", error);
      
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
            : "Failed to create payment",
        msg: "Failed",
      });
    }
  }
);

// Create Invoice API - Creates a new invoice for a visit/patient
router.post(
  "/create-invoice",
  requireCashierOrITAdmin,
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
      const validationResult = CreateInvoiceForPatientSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientName, date, time, note, items, invoiceDiscountAmt, invoiceTaxAmt } = validationResult.data;

      // Find patient by name (case-insensitive, exact match)
      const patientRecord = await prisma.patient.findFirst({
        where: {
          name: {
            equals: patientName,
            mode: 'insensitive',
          },
        },
        select: {
          patientId: true,
          name: true,
        },
      });

      if (!patientRecord) {
        return res.status(404).json({
          error: `Patient not found with name: ${patientName}`,
          msg: "Failed",
        });
      }

      // Combine date and time to create visitDate
      let visitDate: Date;
      try {
        const dateTimeString = time ? `${date} ${time}` : date;
        visitDate = new Date(dateTimeString);
        if (isNaN(visitDate.getTime())) {
          return res.status(400).json({
            error: "Invalid date/time format. Date must be YYYY-MM-DD and time must be HH:MM or HH:MM:SS",
            msg: "Failed",
          });
        }
      } catch (error) {
        return res.status(400).json({
          error: "Invalid date/time format. Date must be YYYY-MM-DD and time must be HH:MM or HH:MM:SS",
          msg: "Failed",
        });
      }

      // Find visit by patientId and visitDate (match by date, ignoring time component for date-only inputs)
      const visitDateStart = new Date(visitDate);
      visitDateStart.setHours(0, 0, 0, 0);
      const visitDateEnd = new Date(visitDate);
      visitDateEnd.setHours(23, 59, 59, 999);

      const visitRecord = await prisma.visit.findFirst({
        where: {
          patientId: patientRecord.patientId,
          visitDate: {
            gte: visitDateStart,
            lte: visitDateEnd,
          },
        },
        select: {
          visitId: true,
          visitDate: true,
        },
        orderBy: {
          visitDate: 'desc',
        },
      });

      if (!visitRecord) {
        const dateTimeDisplay = time ? `${date} ${time}` : date;
        return res.status(404).json({
          error: `Visit not found for patient "${patientName}" on ${dateTimeDisplay}`,
          msg: "Failed",
        });
      }

      // Build CreateInvoiceInput payload
      const payload: CreateInvoiceInput = {
        visitId: visitRecord.visitId,
        patientId: patientRecord.patientId,
        note: note,
        items: items,
        invoiceDiscountAmt: invoiceDiscountAmt,
        invoiceTaxAmt: invoiceTaxAmt,
      };

      // Create invoice using billing service
      const invoice = await createInvoice(payload);

      // Fetch created invoice with related data for response
      const invoiceWithDetails = await prisma.invoice.findUnique({
        where: { invoiceId: invoice.invoiceId },
        include: {
          Patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
              contact: true,
              insurance: true,
            },
          },
          Visit: {
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
          items: {
            select: {
              itemId: true,
              sourceType: true,
              sourceRefId: true,
              serviceId: true,
              description: true,
              quantity: true,
              unitPrice: true,
              discountAmt: true,
              taxAmt: true,
              lineTotal: true,
              Service: {
                select: {
                  serviceId: true,
                  code: true,
                  name: true,
                  defaultPrice: true,
                },
              },
            },
          },
          payments: {
            select: {
              paymentId: true,
              method: true,
              amount: true,
              paidAt: true,
              referenceNo: true,
              note: true,
            },
            orderBy: { paidAt: 'desc' },
          },
        },
      });

      if (!invoiceWithDetails) {
        return res.status(404).json({
          error: "Invoice not found after creation",
          msg: "Failed",
        });
      }

      const patient = invoiceWithDetails.Patient;
      const visit = invoiceWithDetails.Visit;
      const doctor = visit?.doctor;

      // Build flat response structure
      const result: any = {
        msg: "Success",
        invoiceId: invoice.invoiceId,
        invoiceNo: invoice.invoiceNo,
        searchedPatientName: patientName,
        searchedDate: date,
        searchedTime: time || null,
        invoiceStatus: invoice.status,
        invoiceCurrency: invoice.currency,
        invoiceCreatedAt: invoice.createdAt.toISOString().split("T")[0],
        invoiceCreatedTime: invoice.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        invoiceNote: invoice.note || null,

        // Financial Summary
        subTotal: Number(invoice.subTotal),
        discountAmt: Number(invoice.discountAmt),
        taxAmt: Number(invoice.taxAmt),
        grandTotal: Number(invoice.grandTotal),
        amountPaid: Number(invoice.amountPaid),
        amountDue: Number(invoice.amountDue),

        // Patient Information
        patientId: patient.patientId,
        patientName: patient.name,
        patientDob: patient.dob.toISOString().split("T")[0],
        patientGender: patient.gender,
        patientContact: patient.contact,
        patientInsurance: patient.insurance || null,

        // Doctor Information
        doctorId: doctor?.doctorId || null,
        doctorName: doctor?.name || null,
        doctorDepartment: doctor?.department || null,

        // Visit Information
        visitId: visit?.visitId || null,
        visitDate: visit?.visitDate ? visit.visitDate.toISOString().split("T")[0] : null,
        visitDepartment: visit?.department || null,
        visitReason: visit?.reason || null,

        // Cashier Information
        cashierId: user.userId,
        cashierEmail: user.email,
        cashierRole: user.role,

        // Invoice Items
        totalItems: invoiceWithDetails.items.length,
        items: invoiceWithDetails.items.map((item: any) => ({
          itemId: item.itemId,
          sourceType: item.sourceType,
          sourceRefId: item.sourceRefId,
          serviceId: item.serviceId,
          serviceCode: item.Service?.code || null,
          serviceName: item.Service?.name || null,
          serviceDefaultPrice: item.Service?.defaultPrice ? Number(item.Service.defaultPrice) : null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountAmt: Number(item.discountAmt),
          taxAmt: Number(item.taxAmt),
          lineTotal: Number(item.lineTotal),
        })),

        // Payments (empty for new invoice)
        totalPayments: invoiceWithDetails.payments.length,
        payments: invoiceWithDetails.payments.map((payment: any) => ({
          paymentId: payment.paymentId,
          method: payment.method,
          amount: Number(payment.amount),
          paidAt: payment.paidAt.toISOString(),
          referenceNo: payment.referenceNo,
          note: payment.note,
        })),
      };

      // Add numbered item fields for flat response
      invoiceWithDetails.items.forEach((item: any, index: number) => {
        const prefix = `item${index + 1}`;
        result[`${prefix}ItemId`] = item.itemId;
        result[`${prefix}SourceType`] = item.sourceType;
        result[`${prefix}Description`] = item.description;
        result[`${prefix}Quantity`] = item.quantity;
        result[`${prefix}UnitPrice`] = Number(item.unitPrice);
        result[`${prefix}LineTotal`] = Number(item.lineTotal);
        if (item.sourceRefId) result[`${prefix}SourceRefId`] = item.sourceRefId;
        if (item.serviceId) result[`${prefix}ServiceId`] = item.serviceId;
        if (item.Service?.code) result[`${prefix}ServiceCode`] = item.Service.code;
        if (item.Service?.name) result[`${prefix}ServiceName`] = item.Service.name;
        if (item.discountAmt) result[`${prefix}DiscountAmt`] = Number(item.discountAmt);
        if (item.taxAmt) result[`${prefix}TaxAmt`] = Number(item.taxAmt);
      });

      // Notify Atenxion agent about invoice creation (cashier-specific)
      if (user.role === 'Cashier' && user.userId) {
        try {
          const { recordAtenxionTransactionForCashier } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForCashier(user.userId);
          console.log("Atenxion transaction recorded for invoice creation:", invoice.invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice creation:", error);
          // Don't fail the request if Atenxion notification fails
        }
      }

      // Notify Atenxion agent about invoice creation (admin-specific)
      if (user.role === 'ITAdmin' && user.userId) {
        try {
          const { recordAtenxionTransactionForAdmin } = await import('../services/atenxion.js');
          await recordAtenxionTransactionForAdmin(user.userId);
          console.log("Atenxion transaction recorded for invoice creation (admin):", invoice.invoiceId);
        } catch (error) {
          console.warn("Failed to record Atenxion transaction for invoice creation (admin):", error);
          // Don't fail the request if Atenxion notification fails
        }
      }

      res.status(201).json(result);
    } catch (error) {
      console.error("Create Invoice Error:", error);
      
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
            : "Failed to create invoice",
        msg: "Failed",
      });
    }
  }
);

export default router;

