import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient, LabOrderStatus } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

// Validation schema for lab tech agent
const LabTechAgentSchema = z.object({
  labTechId: z.string().uuid().optional(),
});

// Validation schema for lab orders view
const LabOrdersViewSchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

// Validation schema for lab results view
const LabResultsViewSchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  labEngineerId: z.string().uuid().optional(), // userId of the lab engineer who entered the result
  startDate: z.string().optional(), // Filter by resultedAt date
  endDate: z.string().optional(), // Filter by resultedAt date
  testCode: z.string().optional(), // Filter by test code
  testName: z.string().optional(), // Filter by test name
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

// Helper function to format time from minutes
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

// Lab Tech Profile API - Returns lab tech profile information and statistics
router.post(
  "/lab-profile",
  requireAuth,
  requireRole("LabTech"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body for labTechId (optional)
      const validationResult = LabTechAgentSchema.safeParse(req.body || {});
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      // Use provided labTechId or default to authenticated user's userId
      const labTechId = validationResult.data.labTechId || user.userId;

      // Verify the labTechId matches the authenticated user's userId (only allow access to own profile)
      if (user.userId !== labTechId) {
        return res.status(403).json({
          error: "Forbidden: You can only access your own profile",
          msg: "Failed",
        });
      }

      // Get user info
      const userRecord = await prisma.user.findUnique({
        where: { userId: labTechId },
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
          error: "Lab tech not found",
          msg: "Failed",
        });
      }

      // Get statistics - lab-related information
      const [
        totalLabOrders,
        totalLabResults,
        pendingLabOrders,
        inProgressLabOrders,
        completedLabOrders,
        cancelledLabOrders,
        myLabResults,
      ] = await Promise.all([
        prisma.labOrder.count(),
        prisma.labResult.count(),
        prisma.labOrder.count({
          where: {
            status: LabOrderStatus.ORDERED,
          },
        }),
        prisma.labOrder.count({
          where: {
            status: LabOrderStatus.IN_PROGRESS,
          },
        }),
        prisma.labOrder.count({
          where: {
            status: LabOrderStatus.COMPLETED,
          },
        }),
        prisma.labOrder.count({
          where: {
            status: LabOrderStatus.CANCELLED,
          },
        }),
        prisma.labResult.count({
          where: {
            resultedBy: labTechId,
          },
        }),
      ]);

      // Get recent statistics (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [
        recentLabOrders,
        recentLabResults,
        recentMyLabResults,
        recentPendingLabOrders,
        recentCompletedLabOrders,
      ] = await Promise.all([
        prisma.labOrder.count({
          where: {
            createdAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.labResult.count({
          where: {
            resultedAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.labResult.count({
          where: {
            resultedBy: labTechId,
            resultedAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.labOrder.count({
          where: {
            createdAt: { gte: thirtyDaysAgo },
            status: LabOrderStatus.ORDERED,
          },
        }),
        prisma.labOrder.count({
          where: {
            createdAt: { gte: thirtyDaysAgo },
            status: LabOrderStatus.COMPLETED,
          },
        }),
      ]);

      // Get status breakdown for lab orders
      const labOrderStatusCounts = await prisma.labOrder.groupBy({
        by: ["status"],
        _count: {
          labOrderId: true,
        },
      });

      const labOrderStatusMap: Record<string, number> = {};
      labOrderStatusCounts.forEach((item) => {
        labOrderStatusMap[item.status] = item._count.labOrderId;
      });

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

        // Lab Statistics
        totalLabOrders: totalLabOrders,
        totalLabResults: totalLabResults,
        pendingLabOrders: pendingLabOrders,
        inProgressLabOrders: inProgressLabOrders,
        completedLabOrders: completedLabOrders,
        cancelledLabOrders: cancelledLabOrders,
        myLabResults: myLabResults,

        // Status Breakdown
        labOrderStatusBreakdown: labOrderStatusMap,

        // Recent Statistics (last 30 days)
        recentLabOrdersLast30Days: recentLabOrders,
        recentLabResultsLast30Days: recentLabResults,
        recentMyLabResultsLast30Days: recentMyLabResults,
        recentPendingLabOrdersLast30Days: recentPendingLabOrders,
        recentCompletedLabOrdersLast30Days: recentCompletedLabOrders,
      };

      res.json(result);
    } catch (error) {
      console.error("Lab Tech Agent Profile Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch lab tech profile",
        msg: "Failed",
      });
    }
  }
);



export default router;

