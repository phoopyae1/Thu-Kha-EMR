import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcrypt";
import { assertCreatable } from "../services/appointmentService.js";
import { toDateOnly } from "../utils/time.js";

const prisma = new PrismaClient();
const router = Router();

// Validation schema for admin agent (empty body for simple GET-like POST requests)
const AdminAgentSchema = z.object({}).optional();

// Validation schema for creating user account
const roleSchema = z.enum([
  'Doctor',
  'AdminAssistant',
  'Cashier',
  'ITAdmin',
  'Pharmacist',
  'PharmacyTech',
  'InventoryManager',
  'Nurse',
  'LabTech',
]);

const CreateAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: roleSchema,
  doctorId: z.string().uuid().optional(),
});

const CreateDoctorSchema = z.object({
  name: z.string().min(1),
  department: z.string().min(1),
});

const CreateDoctorAccountSchema = z.object({
  doctorName: z.string().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

const CreateUserAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: roleSchema.refine((val) => val !== 'Doctor', {
    message: 'Use doctor-account-create endpoint for Doctor role',
  }),
});

const CreateAppointmentForPatientSchema = z.object({
  patientName: z.string().min(1),
  dr: z.string().min(1), // doctor name
  drDep: z.string().min(1), // doctor department
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in format YYYY-MM-DD'),
  time: z.string().optional(), // start time (alternative to startTime)
  startTime: z.string().optional(), // start time
  endTime: z.string().min(1),
  reason: z.string().min(1), // Reason for visit
  location: z.string().optional(),
}).superRefine((data, ctx) => {
  // Either time or startTime must be provided
  if (!data.time && !data.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['time'],
      message: 'Either time or startTime must be provided',
    });
  }
});

const ViewAllMedicationOrdersSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

const ViewAllLabOrdersSchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

const ViewAllLabResultsSchema = z.object({
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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// Helper function to parse time string to minutes (supports formats like "2:30pm", "14:30", "2:30 pm")
function parseTimeToMinutes(timeStr: string): number {
  // Remove spaces and convert to lowercase
  const cleanTime = timeStr.trim().toLowerCase();
  
  // Handle formats like "2:30pm", "14:30", "2:30 pm", "2:30 PM"
  const timeRegex = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/;
  const match = cleanTime.match(timeRegex);
  
  if (!match) {
    throw new Error(
      `Invalid time format: ${timeStr}. Use format like "2:30pm" or "14:30"`
    );
  }
  
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3];
  
  // Validate minutes
  if (minutes >= 60) {
    throw new Error(
      `Invalid minutes: ${minutes}. Minutes must be less than 60`
    );
  }
  
  // Handle AM/PM
  if (period === "pm" && hours !== 12) {
    hours += 12;
  } else if (period === "am" && hours === 12) {
    hours = 0;
  }
  
  // Validate hours
  if (hours >= 24) {
    throw new Error(`Invalid time: ${timeStr}. Hours must be less than 24`);
  }
  
  return hours * 60 + minutes;
}

// Helper function to format minutes to HH:MM
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}`;
}

async function ensureDoctorAssignment(doctorId: string, excludeUserId?: string) {
  const doctor = await prisma.doctor.findUnique({ where: { doctorId } });
  if (!doctor) {
    const error = new Error('Doctor not found');
    (error as any).statusCode = 404;
    throw error;
  }
  const existing = await prisma.user.findFirst({
    where: {
      doctorId,
      NOT: excludeUserId ? { userId: excludeUserId } : undefined,
    },
  });
  if (existing) {
    const error = new Error('Doctor is already linked to another account');
    (error as any).statusCode = 409;
    throw error;
  }
}

// User Access API - Returns all user accounts in the system with their roles and emails
router.post(
  "/user-access",
  requireAuth,
  requireRole("ITAdmin"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body (optional, empty body is allowed)
      const validationResult = AdminAgentSchema.safeParse(req.body || {});
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      // Get all doctors (including those without user accounts)
      const doctors = await prisma.doctor.findMany({
        include: {
          user: {
            select: {
              userId: true,
              email: true,
              role: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });

      // Get all users with their linked doctor information
      const users = await prisma.user.findMany({
        include: {
          doctor: {
            select: {
              doctorId: true,
              name: true,
              department: true,
            },
          },
        },
        orderBy: [
          { role: "asc" },
          { email: "asc" },
        ],
      });

      // Count total users
      const totalUsers = users.length;

      // Count total doctors (including those without accounts)
      const totalDoctors = doctors.length;

      // Count by role
      const roleCounts: Record<string, number> = {};
      users.forEach((u) => {
        roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
      });

      // Count doctors without user accounts
      const doctorsWithoutAccounts = doctors.filter(d => !d.user).length;

      // Build flat response structure
      const result: any = {
        status: "Success",
        totalUsers: totalUsers,
        totalDoctors: totalDoctors,
        doctorsWithoutAccounts: doctorsWithoutAccounts,
      };

      // Add role counts
      Object.entries(roleCounts).forEach(([role, count]) => {
        result[`total${role}`] = count;
      });

      // Add all doctors (including those without accounts)
      // Only doctors are shown here, so we use simple field names
      doctors.forEach((doctor, index) => {
        const prefix = `doctor${index + 1}`;
        result[`${prefix}Id`] = doctor.doctorId;
        result[`${prefix}Name`] = doctor.name;
        result[`${prefix}Department`] = doctor.department;
        result[`${prefix}CreatedAt`] = doctor.createdAt.toISOString().split("T")[0];
        result[`${prefix}CreatedTime`] = doctor.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";
        
        // User account info (if exists)
        result[`${prefix}HasUserAccount`] = !!doctor.user;
        result[`${prefix}UserId`] = doctor.user?.userId || null;
        result[`${prefix}Email`] = doctor.user?.email || null;
        result[`${prefix}UserRole`] = doctor.user?.role || null;
        result[`${prefix}UserStatus`] = doctor.user?.status || null;
        result[`${prefix}UserCreatedAt`] = doctor.user?.createdAt 
          ? doctor.user.createdAt.toISOString().split("T")[0] 
          : null;
        result[`${prefix}UserCreatedTime`] = doctor.user?.createdAt 
          ? doctor.user.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00"
          : null;
        result[`${prefix}UserUpdatedAt`] = doctor.user?.updatedAt 
          ? doctor.user.updatedAt.toISOString().split("T")[0] 
          : null;
      });

      // Add each user account's information
      // Only show doctor-related fields for users with Doctor role
      users.forEach((userAccount, index) => {
        const prefix = `user${index + 1}`;
        result[`${prefix}UserId`] = userAccount.userId;
        result[`${prefix}Email`] = userAccount.email;
        result[`${prefix}Role`] = userAccount.role;
        result[`${prefix}Status`] = userAccount.status;
        result[`${prefix}CreatedAt`] = userAccount.createdAt.toISOString().split("T")[0];
        result[`${prefix}CreatedTime`] = userAccount.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";
        result[`${prefix}UpdatedAt`] = userAccount.updatedAt.toISOString().split("T")[0];
        
        // Doctor information (only for users with Doctor role)
        if (userAccount.role === 'Doctor' && userAccount.doctor) {
          result[`${prefix}IsLinkedToDoctor`] = true;
          result[`${prefix}DoctorId`] = userAccount.doctor.doctorId;
          result[`${prefix}DoctorName`] = userAccount.doctor.name;
          result[`${prefix}DoctorDepartment`] = userAccount.doctor.department;
        } else {
          result[`${prefix}IsLinkedToDoctor`] = false;
        }
      });

      res.json(result);
    } catch (error) {
      console.error("Admin Agent User Access Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch user access information",
        msg: "Failed",
      });
    }
  }
);

// Create Doctor API - Creates a new doctor profile
router.post(
  "/doctor-create",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = CreateDoctorSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { name, department } = validationResult.data;

      // Create doctor
      const created = await prisma.doctor.create({
        data: {
          name: name.trim(),
          department: department.trim(),
        },
      });

      // Build flat response structure
      const result: any = {
        msg: "Success",
        doctorId: created.doctorId,
        name: created.name,
        department: created.department,
        createdAt: created.createdAt.toISOString().split("T")[0],
        createdTime: created.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
      };

      res.status(201).json(result);
    } catch (error) {
      console.error("Admin Agent Create Doctor Error:", error);
      
      // Handle specific error cases
      if (error instanceof Error) {
        const statusCode = (error as any).statusCode;
        if (statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            msg: "Failed",
          });
        }
      }
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create doctor",
        msg: "Failed",
      });
    }
  }
);

// Create Doctor Account API - Creates a user account for an existing doctor who doesn't have one
router.post(
  "/doctor-account-create",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = CreateDoctorAccountSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorName, email, password } = validationResult.data;
      const normalizedEmail = normalizeEmail(email);

      // Find doctor by name (exact match, case-insensitive)
      const trimmedName = doctorName.trim();
      
      // Get all doctors and filter for exact name match (case-insensitive)
      const allDoctors = await prisma.doctor.findMany({
        include: {
          user: {
            select: {
              userId: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      });

      // Filter to exact match (case-insensitive)
      const exactMatches = allDoctors.filter(d => d.name.toLowerCase() === trimmedName.toLowerCase());

      if (exactMatches.length === 0) {
        return res.status(404).json({
          error: `Doctor not found with name: ${doctorName}`,
          msg: "Failed",
        });
      }

      if (exactMatches.length > 1) {
        return res.status(400).json({
          error: `Multiple doctors found with name "${doctorName}". Please use a more specific name or use doctorId instead.`,
          msg: "Failed",
          matches: exactMatches.map(d => ({
            doctorId: d.doctorId,
            name: d.name,
            department: d.department,
          })),
        });
      }

      const doctor = exactMatches[0];

      // Check if doctor already has an account
      if (doctor.user) {
        return res.status(409).json({
          error: "Doctor already has a user account",
          msg: "Failed",
        });
      }

      // Check if email is already in use
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        return res.status(409).json({
          error: "Email is already in use",
          msg: "Failed",
        });
      }

      // Ensure doctor assignment (validate no other user is linked to this doctor)
      await ensureDoctorAssignment(doctor.doctorId);

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user account linked to the doctor
      const created = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: 'Doctor',
          status: 'active',
          doctorId: doctor.doctorId,
        },
        include: {
          doctor: {
            select: {
              doctorId: true,
              name: true,
              department: true,
            },
          },
        },
      });

      // Build flat response structure
      const result: any = {
        msg: "Success",
        userId: created.userId,
        email: created.email,
        role: created.role,
        status: created.status,
        createdAt: created.createdAt.toISOString().split("T")[0],
        createdTime: created.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        updatedAt: created.updatedAt.toISOString().split("T")[0],
        
        // Doctor information
        doctorId: created.doctor?.doctorId || null,
        doctorName: created.doctor?.name || null,
        doctorDepartment: created.doctor?.department || null,
        isLinkedToDoctor: true,
      };

      res.status(201).json(result);
    } catch (error) {
      console.error("Admin Agent Create Doctor Account Error:", error);
      
      // Handle specific error cases
      if (error instanceof Error) {
        const statusCode = (error as any).statusCode;
        if (statusCode === 404) {
          return res.status(404).json({
            error: error.message,
            msg: "Failed",
          });
        }
        if (statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            msg: "Failed",
          });
        }
      }
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create doctor account",
        msg: "Failed",
      });
    }
  }
);

// Create User Account API - Creates a user account for non-doctor roles
router.post(
  "/user-account-create",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = CreateUserAccountSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { email, password, role } = validationResult.data;
      const normalizedEmail = normalizeEmail(email);

      // Check if email is already in use
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        return res.status(409).json({
          error: "Email is already in use",
          msg: "Failed",
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user account
      const created = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role,
          status: 'active',
          doctorId: null, // Non-doctor accounts don't have doctorId
        },
        select: {
          userId: true,
          email: true,
          role: true,
          status: true,
          doctorId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Build flat response structure
      const result: any = {
        msg: "Success",
        userId: created.userId,
        email: created.email,
        role: created.role,
        status: created.status,
        createdAt: created.createdAt.toISOString().split("T")[0],
        createdTime: created.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        updatedAt: created.updatedAt.toISOString().split("T")[0],
        doctorId: null,
        isLinkedToDoctor: false,
      };

      res.status(201).json(result);
    } catch (error) {
      console.error("Admin Agent Create User Account Error:", error);
      
      // Handle specific error cases
      if (error instanceof Error) {
        // Check for Prisma unique constraint errors
        if ((error as any).code === 'P2002') {
          return res.status(409).json({
            error: "Email is already in use",
            msg: "Failed",
          });
        }
      }
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create user account",
        msg: "Failed",
      });
    }
  }
);

// Create appointment for patient
router.post(
  "/appointment-create",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = CreateAppointmentForPatientSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientName, dr, drDep, date, time, startTime, endTime, reason, location } = validationResult.data;

      // Find patient by name (case-insensitive exact match)
      const allPatients = await prisma.patient.findMany({
        select: { patientId: true, name: true },
      });

      const trimmedPatientName = patientName.trim();
      const matchingPatients = allPatients.filter(
        (p) => p.name.toLowerCase().trim() === trimmedPatientName.toLowerCase()
      );

      if (matchingPatients.length === 0) {
        return res.status(404).json({
          error: `Patient not found with name: ${patientName}`,
          msg: "Failed",
        });
      }

      if (matchingPatients.length > 1) {
        return res.status(409).json({
          error: `Multiple patients found with name: ${patientName}. Please use patient ID instead.`,
          msg: "Failed",
        });
      }

      const patient = matchingPatients[0];

      // Find doctor by name and department (case-insensitive)
      const doctors = await prisma.doctor.findMany({
        where: {
          name: {
            contains: dr.trim(),
            mode: "insensitive",
          },
          department: {
            contains: drDep.trim(),
            mode: "insensitive",
          },
        },
        select: { doctorId: true, name: true, department: true },
      });

      if (doctors.length === 0) {
        return res.status(404).json({
          error: `Doctor not found with name: ${dr} and department: ${drDep}`,
          msg: "Failed",
        });
      }

      if (doctors.length > 1) {
        return res.status(409).json({
          error: `Multiple doctors found with name: ${dr} and department: ${drDep}. Please be more specific.`,
          msg: "Failed",
        });
      }

      const doctor = doctors[0];

      // Parse start time (use time or startTime, prefer startTime)
      const startTimeStr = startTime || time;
      if (!startTimeStr) {
        return res.status(400).json({
          error: "Either time or startTime must be provided",
          msg: "Failed",
        });
      }

      let startTimeMin: number;
      try {
        startTimeMin = parseTimeToMinutes(startTimeStr);
      } catch (timeError) {
        return res.status(400).json({
          error:
            timeError instanceof Error
              ? timeError.message
              : "Invalid time format",
          msg: "Failed",
        });
      }

      // Parse end time
      let endTimeMin: number;
      try {
        endTimeMin = parseTimeToMinutes(endTime);
      } catch (timeError) {
        return res.status(400).json({
          error:
            timeError instanceof Error
              ? timeError.message
              : "Invalid end time format",
          msg: "Failed",
        });
      }

      // Validate that end time is after start time
      if (endTimeMin <= startTimeMin) {
        return res.status(400).json({
          error: "End time must be after start time",
          msg: "Failed",
        });
      }

      // Convert date to Date object and normalize to date-only
      const appointmentDate = toDateOnly(date);

      // Check if time slot is available (availability, blackouts, overlaps)
      try {
        await assertCreatable(prisma as any, {
          patientId: patient.patientId,
          doctorId: doctor.doctorId,
          department: doctor.department,
          date: appointmentDate.toISOString().split("T")[0],
          startTimeMin,
          endTimeMin,
          reason: reason || undefined,
          location: location || undefined,
        });
      } catch (validationError: any) {
        // Handle specific validation errors
        const statusCode = validationError.status || validationError.statusCode;
        
        if (statusCode === 404) {
          return res.status(404).json({
            error: validationError.message || "Resource not found",
            msg: "Failed",
          });
        }
        if (statusCode === 409) {
          return res.status(409).json({
            error: validationError.message || "Time slot is already occupied",
            msg: "Failed",
          });
        }
        if (statusCode === 422) {
          return res.status(422).json({
            error: validationError.message || "Time slot is not available",
            msg: "Failed",
          });
        }
        // Re-throw unexpected errors
        throw validationError;
      }

      // Create the appointment
      const appointment = await prisma.appointment.create({
        data: {
          patientId: patient.patientId,
          doctorId: doctor.doctorId,
          department: doctor.department,
          date: appointmentDate,
          startTimeMin,
          endTimeMin,
          reason: reason || null,
          location: location || null,
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Notify Atenxion agent about appointment creation
      try {
        const { recordAtenxionTransaction } = await import(
          "../services/atenxion.js"
        );
        await recordAtenxionTransaction(patient.patientId);
        console.log(
          "Atenxion transaction recorded for appointment creation:",
          appointment.appointmentId
        );
      } catch (error) {
        console.warn(
          "Failed to record Atenxion transaction for appointment creation:",
          error
        );
      }

      // Return flat response
      const result: any = {
        msg: "Success",
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        patientName: appointment.patient.name,
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
        department: appointment.department,
        appointmentDate: appointment.date.toISOString().split("T")[0],
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        duration: `${appointment.endTimeMin - appointment.startTimeMin} minutes`,
        reason: appointment.reason,
        location: appointment.location,
        appointmentStatus: "Scheduled",
        createdAt: appointment.createdAt.toISOString(),
        message: "Appointment created successfully",
      };

      res.status(201).json(result);
    } catch (error) {
      console.error("Admin Agent Create Appointment Error:", error);
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create appointment",
        msg: "Failed",
      });
    }
  }
);

// View all medication orders
router.post(
  "/medication-orders",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = ViewAllMedicationOrdersSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientId, status, startDate, endDate, limit, offset } = validationResult.data;

      // Build where clause
      const where: any = {};
      
      if (patientId) {
        where.patientId = patientId;
      }
      
      if (status) {
        where.status = status.toUpperCase();
      }
      
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      // Fetch medication orders with related data
      const orders = await prisma.medicationOrder.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
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

      // Get total count for pagination
      const totalCount = await prisma.medicationOrder.count({ where });

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
      const formattedOrders = orders.map((order: any) => {
        const firstPrescriptionItem = order.prescription?.items?.[0];
        const drug = firstPrescriptionItem?.drug;

        return {
          // Order Information
          orderId: order.orderId,
          status: getStatusText(order.status || "PENDING"),
          statusCode: order.status,
          drugName: order.drugName || drug?.name || null,
          dosage: order.dosage || firstPrescriptionItem?.dose || null,
          instructions: order.instructions || firstPrescriptionItem?.notes || null,
          quantity: order.quantity || firstPrescriptionItem?.quantityPrescribed || null,
          notes: order.notes || null,
          createdAt: order.createdAt.toISOString().split("T")[0],
          createdTime: order.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
          updatedAt: order.updatedAt.toISOString().split("T")[0],
          approvedAt: order.approvedAt ? order.approvedAt.toISOString().split("T")[0] : null,

          // Patient Information
          patientId: order.patientId,
          patientName: order.patient.name,
          patientDob: order.patient.dob.toISOString().split("T")[0],
          patientGender: order.patient.gender,
          patientContact: order.patient.contact,

          // Prescription Information
          prescriptionId: order.prescriptionId || null,
          visitId: order.prescription?.visit?.visitId || null,
          visitDate: order.prescription?.visit?.visitDate
            ? order.prescription.visit.visitDate.toISOString().split("T")[0]
            : null,

          // Doctor Information
          doctorId: order.prescription?.visit?.doctor?.doctorId || null,
          doctorName: order.prescription?.visit?.doctor?.name || null,
          doctorDepartment: order.prescription?.visit?.doctor?.department || null,

          // Approval Information
          approvedBy: order.approvedBy?.email || null,
          approvedByUserId: order.approvedById || null,
          updatedBy: order.updatedBy?.email || null,
          updatedByUserId: order.updatedById || null,
        };
      });

      // Calculate summary statistics
      const allOrdersCount = await prisma.medicationOrder.count({});
      const statusBreakdown = await prisma.medicationOrder.groupBy({
        by: ['status'],
        _count: {
          orderId: true,
        },
      });

      const statusCounts: Record<string, number> = {};
      statusBreakdown.forEach((item) => {
        statusCounts[item.status] = item._count.orderId;
      });

      // Build response
      const result: any = {
        msg: "Success",
        totalOrders: totalCount,
        totalOrdersInSystem: allOrdersCount,
        returnedOrders: formattedOrders.length,
        pagination: {
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
        statusBreakdown: statusCounts,
        orders: formattedOrders,
      };

      // Add numbered order fields for flat response
      formattedOrders.forEach((order, index) => {
        const prefix = `order${index + 1}`;
        result[`${prefix}OrderId`] = order.orderId;
        result[`${prefix}Status`] = order.status;
        result[`${prefix}StatusCode`] = order.statusCode;
        result[`${prefix}DrugName`] = order.drugName;
        result[`${prefix}Dosage`] = order.dosage;
        result[`${prefix}Instructions`] = order.instructions;
        result[`${prefix}Quantity`] = order.quantity;
        result[`${prefix}PatientId`] = order.patientId;
        result[`${prefix}PatientName`] = order.patientName;
        result[`${prefix}DoctorName`] = order.doctorName;
        result[`${prefix}DoctorDepartment`] = order.doctorDepartment;
        result[`${prefix}CreatedAt`] = order.createdAt;
        result[`${prefix}ApprovedAt`] = order.approvedAt;
        result[`${prefix}ApprovedBy`] = order.approvedBy;
      });

      res.json(result);
    } catch (error) {
      console.error("Admin Agent View All Medication Orders Error:", error);
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch medication orders",
        msg: "Failed",
      });
    }
  }
);

// View all lab orders (showing which doctor ordered which tests for which patient)
router.post(
  "/lab-orders",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = ViewAllLabOrdersSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientId, doctorId, status, startDate, endDate, limit, offset } = validationResult.data;

      // Build where clause
      const where: any = {};
      
      if (patientId) {
        where.patientId = patientId;
      }
      
      if (doctorId) {
        where.doctorId = doctorId;
      }
      
      if (status) {
        where.status = status.toUpperCase();
      }
      
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate);
        }
      }

      // Fetch lab orders with items
      const labOrders = await prisma.labOrder.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            select: {
              labOrderItemId: true,
              testCode: true,
              testName: true,
              status: true,
              specimen: true,
              notes: true,
            },
            orderBy: {
              testCode: "asc",
            },
          },
        },
      });

      // Get unique patient and doctor IDs to fetch in batch
      const patientIds = [...new Set(labOrders.map(order => order.patientId))];
      const doctorIds = [...new Set(labOrders.map(order => order.doctorId))];
      const visitIds = [...new Set(labOrders.map(order => order.visitId))];

      // Fetch patients, doctors, and visits in parallel
      const [patients, doctors, visits] = await Promise.all([
        prisma.patient.findMany({
          where: { patientId: { in: patientIds } },
          select: {
            patientId: true,
            name: true,
            dob: true,
            gender: true,
            contact: true,
          },
        }),
        prisma.doctor.findMany({
          where: { doctorId: { in: doctorIds } },
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        }),
        prisma.visit.findMany({
          where: { visitId: { in: visitIds } },
          select: {
            visitId: true,
            visitDate: true,
            department: true,
            reason: true,
          },
        }),
      ]);

      // Create lookup maps
      const patientMap = new Map(patients.map(p => [p.patientId, p]));
      const doctorMap = new Map(doctors.map(d => [d.doctorId, d]));
      const visitMap = new Map(visits.map(v => [v.visitId, v]));

      // Get total count for pagination
      const totalCount = await prisma.labOrder.count({ where });

      // Helper function to map status to readable text
      const getOrderStatusText = (status: string): string => {
        const statusMap: Record<string, string> = {
          ORDERED: "Ordered",
          IN_PROGRESS: "In Progress",
          COMPLETED: "Completed",
          CANCELLED: "Cancelled",
        };
        return statusMap[status] || status;
      };

      const getItemStatusText = (status: string): string => {
        const statusMap: Record<string, string> = {
          ORDERED: "Ordered",
          RESULTED: "Resulted",
          CANCELLED: "Cancelled",
        };
        return statusMap[status] || status;
      };

      // Format response
      const formattedOrders = labOrders.map((order: any) => {
        const patient = patientMap.get(order.patientId);
        const doctor = doctorMap.get(order.doctorId);
        const visit = visitMap.get(order.visitId);

        const orderData: any = {
          // Lab Order Information
          labOrderId: order.labOrderId,
          status: getOrderStatusText(order.status || "ORDERED"),
          statusCode: order.status,
          createdAt: order.createdAt.toISOString().split("T")[0],
          createdTime: order.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
          updatedAt: order.updatedAt.toISOString().split("T")[0],

          // Patient Information (who the order is for)
          patientId: order.patientId,
          patientName: patient?.name || null,
          patientDob: patient?.dob ? patient.dob.toISOString().split("T")[0] : null,
          patientGender: patient?.gender || null,
          patientContact: patient?.contact || null,

          // Doctor Information (who ordered it)
          doctorId: order.doctorId,
          doctorName: doctor?.name || null,
          doctorDepartment: doctor?.department || null,

          // Visit Information
          visitId: order.visitId,
          visitDate: visit?.visitDate
            ? visit.visitDate.toISOString().split("T")[0]
            : null,
          visitDepartment: visit?.department || null,
          visitReason: visit?.reason || null,

          // Lab Order Items (tests ordered)
          itemsCount: order.items.length,
          items: order.items.map((item: any) => {
            const itemData: any = {
              labOrderItemId: item.labOrderItemId,
              testCode: item.testCode,
              testName: item.testName,
              status: getItemStatusText(item.status || "ORDERED"),
              statusCode: item.status,
            };
            if (item.specimen) itemData.specimen = item.specimen;
            if (item.notes) itemData.notes = item.notes;
            return itemData;
          }),
        };

        // Add optional fields only if they have values
        if (order.priority) orderData.priority = order.priority;
        if (order.notes) orderData.notes = order.notes;

        // Remove null values from optional fields
        const cleaned: any = {};
        for (const [key, value] of Object.entries(orderData)) {
          if (value !== null && value !== undefined) {
            cleaned[key] = value;
          }
        }
        return cleaned;
      });

      // Calculate summary statistics
      const allOrdersCount = await prisma.labOrder.count({});
      const statusBreakdown = await prisma.labOrder.groupBy({
        by: ['status'],
        _count: {
          labOrderId: true,
        },
      });

      const statusCounts: Record<string, number> = {};
      statusBreakdown.forEach((item) => {
        statusCounts[item.status] = item._count.labOrderId;
      });

      // Build response
      const result: any = {
        msg: "Success",
        totalOrders: totalCount,
        totalOrdersInSystem: allOrdersCount,
        returnedOrders: formattedOrders.length,
        pagination: {
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
        statusBreakdown: statusCounts,
        orders: formattedOrders,
      };

      // Add numbered order fields for flat response (only non-null values)
      formattedOrders.forEach((order, index) => {
        const prefix = `order${index + 1}`;
        result[`${prefix}LabOrderId`] = order.labOrderId;
        result[`${prefix}Status`] = order.status;
        result[`${prefix}StatusCode`] = order.statusCode;
        result[`${prefix}PatientId`] = order.patientId;
        result[`${prefix}CreatedAt`] = order.createdAt;
        result[`${prefix}ItemsCount`] = order.itemsCount;
        
        // Add fields only if they exist (non-null)
        if (order.patientName) result[`${prefix}PatientName`] = order.patientName;
        if (order.patientDob) result[`${prefix}PatientDob`] = order.patientDob;
        if (order.patientGender) result[`${prefix}PatientGender`] = order.patientGender;
        if (order.patientContact) result[`${prefix}PatientContact`] = order.patientContact;
        if (order.doctorId) result[`${prefix}DoctorId`] = order.doctorId;
        if (order.doctorName) result[`${prefix}DoctorName`] = order.doctorName;
        if (order.doctorDepartment) result[`${prefix}DoctorDepartment`] = order.doctorDepartment;
        if (order.visitId) result[`${prefix}VisitId`] = order.visitId;
        if (order.visitDate) result[`${prefix}VisitDate`] = order.visitDate;
        if (order.visitDepartment) result[`${prefix}VisitDepartment`] = order.visitDepartment;
        if (order.visitReason) result[`${prefix}VisitReason`] = order.visitReason;
        if (order.priority) result[`${prefix}Priority`] = order.priority;
        if (order.notes) result[`${prefix}Notes`] = order.notes;

        // Add lab test items
        order.items.forEach((item: any, itemIndex: number) => {
          const itemPrefix = `${prefix}Item${itemIndex + 1}`;
          result[`${itemPrefix}TestCode`] = item.testCode;
          result[`${itemPrefix}TestName`] = item.testName;
          result[`${itemPrefix}Status`] = item.status;
          result[`${itemPrefix}StatusCode`] = item.statusCode;
          if (item.specimen) result[`${itemPrefix}Specimen`] = item.specimen;
          if (item.notes) result[`${itemPrefix}Notes`] = item.notes;
        });
      });

      res.json(result);
    } catch (error) {
      console.error("Admin Agent View All Lab Orders Error:", error);
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch lab orders",
        msg: "Failed",
      });
    }
  }
);

// View all lab results (showing which lab engineer entered which results for which patient from which doctor's order)
router.post(
  "/lab-results",
  requireAuth,
  requireRole("ITAdmin"),
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
      const validationResult = ViewAllLabResultsSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientId, doctorId, labEngineerId, startDate, endDate, testCode, testName, limit, offset } = validationResult.data;

      // Build where clause for lab results
      const where: any = {};
      
      if (patientId) {
        where.patientId = patientId;
      }
      
      if (labEngineerId) {
        where.resultedBy = labEngineerId;
      }
      
      if (startDate || endDate) {
        where.resultedAt = {};
        if (startDate) {
          where.resultedAt.gte = new Date(startDate);
        }
        if (endDate) {
          where.resultedAt.lte = new Date(endDate);
        }
      }

      // Fetch all lab results matching basic filters
      const allLabResults = await prisma.labResult.findMany({
        where,
        include: {
          LabOrder: {
            select: {
              labOrderId: true,
              visitId: true,
              patientId: true,
              doctorId: true,
              status: true,
              createdAt: true,
            },
          },
          LabOrderItem: {
            select: {
              labOrderItemId: true,
              testCode: true,
              testName: true,
              status: true,
              specimen: true,
            },
          },
        },
        orderBy: { resultedAt: "desc" },
      });

      // Filter results in memory for complex filters (testCode, testName, doctorId)
      let labResults = allLabResults;
      
      if (doctorId) {
        labResults = labResults.filter(result => result.LabOrder.doctorId === doctorId);
      }
      
      if (testCode) {
        const codeLower = testCode.toLowerCase();
        labResults = labResults.filter(result => 
          result.LabOrderItem.testCode.toLowerCase().includes(codeLower)
        );
      }
      
      if (testName) {
        const nameLower = testName.toLowerCase();
        labResults = labResults.filter(result => 
          result.LabOrderItem.testName.toLowerCase().includes(nameLower)
        );
      }

      // Get total count before pagination
      const totalCount = labResults.length;

      // Apply pagination after filtering
      labResults = labResults.slice(offset, offset + limit);

      // Get unique IDs to fetch related data in batch
      const patientIds = [...new Set(labResults.map(result => result.patientId))];
      const doctorIds = [...new Set(labResults.map(result => result.LabOrder.doctorId))];
      const labEngineerIds = [...new Set(labResults.map(result => result.resultedBy))];

      // Fetch patients, doctors, and lab engineers (users) in parallel
      const [patients, doctors, labEngineers] = await Promise.all([
        prisma.patient.findMany({
          where: { patientId: { in: patientIds } },
          select: {
            patientId: true,
            name: true,
            dob: true,
            gender: true,
            contact: true,
          },
        }),
        prisma.doctor.findMany({
          where: { doctorId: { in: doctorIds } },
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        }),
        prisma.user.findMany({
          where: { userId: { in: labEngineerIds } },
          select: {
            userId: true,
            email: true,
            role: true,
          },
        }),
      ]);

      // Create lookup maps
      const patientMap = new Map(patients.map(p => [p.patientId, p]));
      const doctorMap = new Map(doctors.map(d => [d.doctorId, d]));
      const labEngineerMap = new Map(labEngineers.map(u => [u.userId, u]));

      // Helper function to format reference range
      const formatReferenceRange = (low: any, high: any, unit: string | null): string | null => {
        if (low !== null && low !== undefined && high !== null && high !== undefined) {
          const lowStr = Number(low).toFixed(3);
          const highStr = Number(high).toFixed(3);
          return unit ? `${lowStr} - ${highStr} ${unit}` : `${lowStr} - ${highStr}`;
        }
        if (low !== null && low !== undefined) {
          return unit ? `${Number(low).toFixed(3)} ${unit}` : Number(low).toFixed(3);
        }
        if (high !== null && high !== undefined) {
          return unit ? `${Number(high).toFixed(3)} ${unit}` : Number(high).toFixed(3);
        }
        return null;
      };

      // Format response
      const formattedResults = labResults.map((result: any) => {
        const patient = patientMap.get(result.patientId);
        const doctor = doctorMap.get(result.LabOrder.doctorId);
        const labEngineer = labEngineerMap.get(result.resultedBy);

        const resultData: any = {
          // Lab Result Information
          labResultId: result.labResultId,
          resultedAt: result.resultedAt.toISOString().split("T")[0],
          resultedTime: result.resultedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
          resultValue: result.resultValue || null,
          resultValueNum: result.resultValueNum ? Number(result.resultValueNum) : null,
          unit: result.unit || null,
          abnormalFlag: result.abnormalFlag || null,
          notes: result.notes || null,

          // Test Information
          testCode: result.LabOrderItem.testCode,
          testName: result.LabOrderItem.testName,
          specimen: result.LabOrderItem.specimen || null,
          itemStatus: result.LabOrderItem.status,

          // Patient Information (who the test is for)
          patientId: result.patientId,
          patientName: patient?.name || null,
          patientDob: patient?.dob ? patient.dob.toISOString().split("T")[0] : null,
          patientGender: patient?.gender || null,
          patientContact: patient?.contact || null,

          // Doctor Information (who ordered the test)
          doctorId: result.LabOrder.doctorId,
          doctorName: doctor?.name || null,
          doctorDepartment: doctor?.department || null,

          // Lab Order Information
          labOrderId: result.labOrderId,
          labOrderItemId: result.labOrderItemId,
          orderStatus: result.LabOrder.status,
          orderCreatedAt: result.LabOrder.createdAt.toISOString().split("T")[0],
          visitId: result.LabOrder.visitId,

          // Lab Engineer Information (who entered the result)
          labEngineerId: result.resultedBy,
          labEngineerEmail: labEngineer?.email || null,
          labEngineerRole: labEngineer?.role || null,
        };

        // Add reference range if available
        if (result.referenceLow !== null && result.referenceLow !== undefined || 
            result.referenceHigh !== null && result.referenceHigh !== undefined) {
          resultData.referenceLow = result.referenceLow ? Number(result.referenceLow) : null;
          resultData.referenceHigh = result.referenceHigh ? Number(result.referenceHigh) : null;
          resultData.referenceRange = formatReferenceRange(result.referenceLow, result.referenceHigh, result.unit);
        }

        // Remove null values from optional fields
        const cleaned: any = {};
        for (const [key, value] of Object.entries(resultData)) {
          if (value !== null && value !== undefined) {
            cleaned[key] = value;
          }
        }
        return cleaned;
      });

      // Calculate summary statistics
      const allResultsCount = await prisma.labResult.count({});
      
      // Get breakdown by lab engineer (from all results, not just filtered)
      const engineerBreakdown = await prisma.labResult.groupBy({
        by: ['resultedBy'],
        _count: {
          labResultId: true,
        },
      });

      const engineerCounts: Record<string, number> = {};
      engineerBreakdown.forEach((item) => {
        const engineer = labEngineerMap.get(item.resultedBy);
        const key = engineer?.email || item.resultedBy;
        engineerCounts[key] = item._count.labResultId;
      });

      // Get breakdown by abnormal flag (from filtered results)
      const abnormalCounts: Record<string, number> = {};
      labResults.forEach((result: any) => {
        const flag = result.abnormalFlag || 'NORMAL';
        abnormalCounts[flag] = (abnormalCounts[flag] || 0) + 1;
      });

      // Build response
      const result: any = {
        msg: "Success",
        totalResults: totalCount,
        totalResultsInSystem: allResultsCount,
        returnedResults: formattedResults.length,
        pagination: {
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
        engineerBreakdown: engineerCounts,
        abnormalBreakdown: abnormalCounts,
        results: formattedResults,
      };

      // Add numbered result fields for flat response (only non-null values)
      formattedResults.forEach((labResult, index) => {
        const prefix = `result${index + 1}`;
        result[`${prefix}LabResultId`] = labResult.labResultId;
        result[`${prefix}ResultedAt`] = labResult.resultedAt;
        result[`${prefix}TestCode`] = labResult.testCode;
        result[`${prefix}TestName`] = labResult.testName;
        result[`${prefix}PatientId`] = labResult.patientId;
        result[`${prefix}DoctorId`] = labResult.doctorId;
        result[`${prefix}LabEngineerId`] = labResult.labEngineerId;
        result[`${prefix}LabOrderId`] = labResult.labOrderId;
        
        // Add fields only if they exist (non-null)
        if (labResult.patientName) result[`${prefix}PatientName`] = labResult.patientName;
        if (labResult.patientDob) result[`${prefix}PatientDob`] = labResult.patientDob;
        if (labResult.patientGender) result[`${prefix}PatientGender`] = labResult.patientGender;
        if (labResult.doctorName) result[`${prefix}DoctorName`] = labResult.doctorName;
        if (labResult.doctorDepartment) result[`${prefix}DoctorDepartment`] = labResult.doctorDepartment;
        if (labResult.labEngineerEmail) result[`${prefix}LabEngineerEmail`] = labResult.labEngineerEmail;
        if (labResult.labEngineerRole) result[`${prefix}LabEngineerRole`] = labResult.labEngineerRole;
        if (labResult.resultValue) result[`${prefix}ResultValue`] = labResult.resultValue;
        if (labResult.resultValueNum !== null && labResult.resultValueNum !== undefined) {
          result[`${prefix}ResultValueNum`] = labResult.resultValueNum;
        }
        if (labResult.unit) result[`${prefix}Unit`] = labResult.unit;
        if (labResult.abnormalFlag) result[`${prefix}AbnormalFlag`] = labResult.abnormalFlag;
        if (labResult.referenceRange) result[`${prefix}ReferenceRange`] = labResult.referenceRange;
        if (labResult.referenceLow !== null && labResult.referenceLow !== undefined) {
          result[`${prefix}ReferenceLow`] = labResult.referenceLow;
        }
        if (labResult.referenceHigh !== null && labResult.referenceHigh !== undefined) {
          result[`${prefix}ReferenceHigh`] = labResult.referenceHigh;
        }
        if (labResult.specimen) result[`${prefix}Specimen`] = labResult.specimen;
        if (labResult.notes) result[`${prefix}Notes`] = labResult.notes;
        if (labResult.visitId) result[`${prefix}VisitId`] = labResult.visitId;
        if (labResult.orderStatus) result[`${prefix}OrderStatus`] = labResult.orderStatus;
      });

      res.json(result);
    } catch (error) {
      console.error("Admin Agent View All Lab Results Error:", error);
      
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch lab results",
        msg: "Failed",
      });
    }
  }
);

export default router;

