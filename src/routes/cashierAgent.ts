import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

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

export default router;

