import { Router, type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertCreatable, assertUpdatable, getDoctorAvailabilityForDate, type AvailabilityWindow } from "../services/appointmentService.js";
import { toDateOnly, toMinutes } from "../utils/time.js";

const prisma = new PrismaClient();
const router = Router();

// Schema for public appointment booking
const PublicAppointmentBookingSchema = z.object({
  patientName: z.string().min(1, "Patient name is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD"),
  time: z.string().min(1, "Time is required"), // Accepts formats like "14:30" or "2:30pm"
  doctor: z.string().min(1, "Doctor name is required"),
  doctordepartment: z.string().min(1, "Doctor department is required"),
  gender: z.enum(["M", "F"], { required_error: "Gender is required" }), // Required gender: "M" for Male, "F" for Female
  reason: z.string().optional(), // Optional appointment reason
});

// Helper function to parse time string to minutes
function parseTimeToMinutes(timeStr: string): number {
  try {
    // Use the toMinutes utility function which handles both 24-hour and 12-hour formats
    return toMinutes(timeStr);
  } catch (error) {
    throw new Error(
      `Invalid time format: ${timeStr}. Use format like "14:30" or "2:30pm"`
    );
  }
}

// Helper function to format minutes to HH:MM
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

// Public appointment booking endpoint (no authentication required)
router.post(
  "/appointment-booking",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validationResult = PublicAppointmentBookingSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientName, date, time, doctor, doctordepartment, gender, reason } = validationResult.data;

      // Always create a new patient to avoid mixing appointments between patients with the same name
      // This ensures each booking creates a separate patient record, even if names are identical
      const defaultDob = new Date("2000-01-01");
      const patient = await prisma.patient.create({
        data: {
          name: patientName,
          dob: defaultDob,
          gender: gender, // Gender is required from request body
        },
        select: {
          patientId: true,
          name: true,
        },
      });

      // Find doctor by name and department
      // Try exact match first, then partial match
      let doctorRecord = await prisma.doctor.findFirst({
        where: {
          name: {
            equals: doctor.trim(),
            mode: "insensitive",
          },
          department: {
            equals: doctordepartment.trim(),
            mode: "insensitive",
          },
        },
        select: {
          doctorId: true,
          name: true,
          department: true,
        },
      });

      // If exact match fails, try partial match
      if (!doctorRecord) {
        doctorRecord = await prisma.doctor.findFirst({
          where: {
            name: {
              contains: doctor.trim(),
              mode: "insensitive",
            },
            department: {
              equals: doctordepartment.trim(),
              mode: "insensitive",
            },
          },
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        });
      }

      if (!doctorRecord) {
        // Try to find all doctors in the department to help with debugging
        const doctorsInDept = await prisma.doctor.findMany({
          where: {
            department: {
              equals: doctordepartment.trim(),
              mode: "insensitive",
            },
          },
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        });

        return res.status(404).json({
          error: `Doctor not found with name: "${doctor}" in department: "${doctordepartment}"`,
          msg: "Failed",
          availableDoctors: doctorsInDept.length > 0 
            ? doctorsInDept.map(d => ({ name: d.name, department: d.department }))
            : `No doctors found in department "${doctordepartment}"`,
        });
      }

      // Parse time to minutes
      let startTimeMin: number;
      try {
        startTimeMin = parseTimeToMinutes(time);
      } catch (timeError) {
        return res.status(400).json({
          error:
            timeError instanceof Error
              ? timeError.message
              : "Invalid time format",
          msg: "Failed",
        });
      }

      // Default appointment duration: 30 minutes
      const endTimeMin = startTimeMin + 30;

      // Convert date to Date object and normalize to date-only
      const appointmentDate = toDateOnly(date);

      // Check if the time slot is unique (no exact duplicate)
      try {
        await assertUniqueTimeSlot(
          doctorRecord.doctorId,
          appointmentDate,
          startTimeMin
        );
      } catch (uniqueError: any) {
        const statusCode = uniqueError.status || uniqueError.statusCode;
        if (statusCode === 409) {
          return res.status(409).json({
            error: uniqueError.message || "Time slot is already booked",
            msg: "Failed",
          });
        }
        throw uniqueError;
      }

      // Check if time slot is available (availability, blackouts, overlaps)
      try {
        await assertCreatable(prisma as any, {
          patientId: patient.patientId,
          doctorId: doctorRecord.doctorId,
          department: doctordepartment,
          date: appointmentDate.toISOString().split("T")[0],
          startTimeMin,
          endTimeMin,
          reason: reason || undefined,
          location: undefined,
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

      // Create the appointment (UUID will be auto-generated)
      // Explicitly set status to Scheduled to ensure it appears in the queue
      const appointment = await prisma.appointment.create({
        data: {
          patientId: patient.patientId,
          doctorId: doctorRecord.doctorId,
          department: doctordepartment,
          date: appointmentDate,
          startTimeMin,
          endTimeMin,
          status: 'Scheduled', // Explicitly set status to ensure it appears in queue
          reason: reason || null,
          location: null,
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Log appointment creation for debugging
      const appointmentDateStr = appointment.date.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      const daysUntilAppointment = Math.ceil(
        (appointment.date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );

      console.log('Public appointment created:', {
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        patientName: appointment.patient.name,
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
        appointmentDate: appointmentDateStr,
        today: todayStr,
        daysUntilAppointment,
        status: appointment.status,
        startTimeMin: appointment.startTimeMin,
      });

      // Return response
      res.status(201).json({
        msg: "Success",
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        patientName: appointment.patient.name,
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
        department: appointment.department,
        appointmentDate: appointmentDateStr,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        duration: "30 minutes",
        appointmentStatus: appointment.status,
        reason: appointment.reason,
        createdAt: appointment.createdAt.toISOString(),
        message: "Appointment booked successfully",
        queueVisibility: daysUntilAppointment <= 1 
          ? "This appointment should appear in today's queue"
          : `This appointment is ${daysUntilAppointment} days away. To view it in the doctor queue, use /appointments/queue?doctorId=${appointment.doctorId}&days=${Math.max(daysUntilAppointment + 1, 7)}`,
      });
    } catch (error: unknown) {
      console.error("Public Appointment Booking Error:", error);

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to book appointment",
        msg: "Failed",
      });
    }
  }
);

// Schema for patient appointments query
const PatientAppointmentsQuerySchema = z.object({
  patientId: z.string().uuid("patientId must be a valid UUID"),
});

// Schema for doctor availability query
const DoctorAvailabilitySchema = z.object({
  doctor: z.string().min(1, "Doctor name is required"),
  department: z.string().min(1, "Doctor department is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD").optional(), // Optional date, defaults to today
});

// Schema for rescheduling appointment - supports two formats:
// Format 1: patientId + date (old) + time (old) + newDate + newTime
// Format 2: name + oldDate + oldTime + newDate + newTime
const RescheduleAppointmentSchema = z.object({
  // Format 1 fields
  patientId: z.string().uuid("patientId must be a valid UUID").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD").optional(), // old date (format 1)
  time: z.string().min(1, "Time is required").optional(), // old time (format 1)
  // Format 2 fields
  name: z.string().min(1, "Patient name is required").optional(),
  oldDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "oldDate must be in format YYYY-MM-DD").optional(), // old date (format 2)
  oldTime: z.string().min(1, "oldTime is required").optional(), // old time (format 2)
  // Common fields
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "newDate must be in format YYYY-MM-DD"),
  newTime: z.string().min(1, "newTime is required"), // Accepts formats like "14:30" or "2:30pm"
  // Optional fields for changing doctor
  doctorname: z.string().min(1, "Doctor name is required").optional(),
  department: z.string().min(1, "Doctor department is required").optional(),
}).refine(
  (data) => {
    // Must have either patientId or name
    const hasPatientId = !!data.patientId;
    const hasName = !!data.name;
    if (!hasPatientId && !hasName) {
      return false;
    }
    // If patientId, must have date and time (old date/time)
    if (hasPatientId && (!data.date || !data.time)) {
      return false;
    }
    // If name, must have oldDate and oldTime
    if (hasName && (!data.oldDate || !data.oldTime)) {
      return false;
    }
    return true;
  },
  {
    message: "Must provide either (patientId + date + time) or (name + oldDate + oldTime)",
  }
);

// Schema for canceling appointment
const CancelAppointmentSchema = z.object({
  // Format 1: Using patientId
  patientId: z.string().uuid("patientId must be a valid UUID").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD").optional(),
  time: z.string().min(1, "Time is required").optional(),
  // Format 2: Using patient name
  name: z.string().min(1, "Patient name is required").optional(),
  oldDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "oldDate must be in format YYYY-MM-DD").optional(),
  oldTime: z.string().min(1, "oldTime is required").optional(),
  // Required fields for identifying appointment
  doctorname: z.string().min(1, "Doctor name is required"),
  department: z.string().min(1, "Doctor department is required"),
}).refine(
  (data) => {
    // Must have either patientId or name
    const hasPatientId = !!data.patientId;
    const hasName = !!data.name;
    if (!hasPatientId && !hasName) {
      return false;
    }
    // If patientId, must have date and time
    if (hasPatientId && (!data.date || !data.time)) {
      return false;
    }
    // If name, must have oldDate and oldTime
    if (hasName && (!data.oldDate || !data.oldTime)) {
      return false;
    }
    return true;
  },
  {
    message: "Must provide either (patientId + date + time) or (name + oldDate + oldTime)",
  }
);

// Public endpoint for patients to view their appointments (no authentication required)
router.post(
  "/patient-appointment",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validationResult = PatientAppointmentsQuerySchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { patientId } = validationResult.data;

      // Verify patient exists
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: { patientId: true, name: true },
      });

      if (!patient) {
        return res.status(404).json({
          error: "Patient not found",
          msg: "Failed",
        });
      }

      // Fetch all appointments for this patient
      const appointments = await prisma.appointment.findMany({
        where: {
          patientId,
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
        orderBy: [
          { date: "desc" },
          { startTimeMin: "desc" },
        ],
      });

      // Format appointments with requested fields
      const formattedAppointments = appointments.map((appointment) => {
        const appointmentDateStr = appointment.date.toISOString().split("T")[0];
        return {
          appointmentId: appointment.appointmentId,
          appointmentDate: appointmentDateStr,
          doctorName: appointment.doctor.name,
          department: appointment.doctor.department,
          startTime: formatTime(appointment.startTimeMin),
          endTime: formatTime(appointment.endTimeMin),
          status: appointment.status,
          reason: appointment.reason,
          location: appointment.location,
        };
      });

      res.status(200).json({
        msg: "Success",
        patientId: patient.patientId,
        patientName: patient.name,
        appointments: formattedAppointments,
        totalAppointments: formattedAppointments.length,
      });
    } catch (error: unknown) {
      console.error("Public Patient Appointments Error:", error);

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve patient appointments",
        msg: "Failed",
      });
    }
  }
);

// Helper function to find doctor (reused from booking endpoint)
async function findDoctorByNameAndDepartment(doctorName: string, department: string) {
  // Try exact match first
  let doctorRecord = await prisma.doctor.findFirst({
    where: {
      name: {
        equals: doctorName.trim(),
        mode: "insensitive",
      },
      department: {
        equals: department.trim(),
        mode: "insensitive",
      },
    },
    select: {
      doctorId: true,
      name: true,
      department: true,
    },
  });

  // If exact match fails, try partial match
  if (!doctorRecord) {
    doctorRecord = await prisma.doctor.findFirst({
      where: {
        name: {
          contains: doctorName.trim(),
          mode: "insensitive",
        },
        department: {
          equals: department.trim(),
          mode: "insensitive",
        },
      },
      select: {
        doctorId: true,
        name: true,
        department: true,
      },
    });
  }

  return doctorRecord;
}

// Helper functions for calculating availability slots
type TimeSegment = { startMin: number; endMin: number };

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function convertBlackoutToSegment(
  startAt: Date,
  endAt: Date,
  dayStart: Date,
  dayEnd: Date
): TimeSegment | null {
  const clampedStart = Math.max(startAt.getTime(), dayStart.getTime());
  const clampedEnd = Math.min(endAt.getTime(), dayEnd.getTime());
  if (clampedEnd <= clampedStart) {
    return null;
  }

  const minute = 60 * 1000;
  const startMin = Math.max(0, Math.floor((clampedStart - dayStart.getTime()) / minute));
  const endMin = Math.min(1440, Math.ceil((clampedEnd - dayStart.getTime()) / minute));

  if (endMin <= startMin) {
    return null;
  }

  return { startMin, endMin };
}

function mergeSegments(segments: TimeSegment[]): TimeSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const sorted = [...segments]
    .filter((segment) => segment.endMin > segment.startMin)
    .sort((a, b) => (a.startMin === b.startMin ? a.endMin - b.endMin : a.startMin - b.startMin));

  if (!sorted.length) {
    return [];
  }

  const merged: TimeSegment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, current.endMin);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function subtractWindow(
  window: AvailabilityWindow,
  blockers: TimeSegment[]
): TimeSegment[] {
  const slots: TimeSegment[] = [];
  let currentStart = window.startMin;

  for (const blocker of blockers) {
    if (blocker.endMin <= window.startMin) {
      continue;
    }

    if (blocker.startMin >= window.endMin) {
      break;
    }

    const overlapStart = Math.max(blocker.startMin, window.startMin);
    const overlapEnd = Math.min(blocker.endMin, window.endMin);

    if (overlapStart > currentStart) {
      slots.push({ startMin: currentStart, endMin: overlapStart });
    }

    currentStart = Math.max(currentStart, overlapEnd);

    if (currentStart >= window.endMin) {
      break;
    }
  }

  if (currentStart < window.endMin) {
    slots.push({ startMin: currentStart, endMin: window.endMin });
  }

  return slots.filter((slot) => slot.endMin > slot.startMin);
}

function calculateFreeSlots(
  windows: AvailabilityWindow[],
  blockers: TimeSegment[]
): TimeSegment[] {
  const freeSlots: TimeSegment[] = [];

  for (const window of windows) {
    freeSlots.push(...subtractWindow(window, blockers));
  }

  return freeSlots;
}

// Helper function to check if time slot is unique (no exact duplicate)
async function assertUniqueTimeSlot(
  doctorId: string,
  date: Date,
  startTimeMin: number,
  excludeAppointmentId?: string
): Promise<void> {
  const conflictingAppointment = await prisma.appointment.findFirst({
    where: {
      doctorId,
      date,
      startTimeMin,
      status: {
        in: ["Scheduled", "CheckedIn"],
      },
      ...(excludeAppointmentId && {
        appointmentId: {
          not: excludeAppointmentId,
        },
      }),
    },
    select: {
      appointmentId: true,
      patientId: true,
    },
  });

  if (conflictingAppointment) {
    const error: any = new Error(
      `Time slot is already booked. Another appointment exists for this doctor at the same date and time.`
    );
    error.status = 409;
    throw error;
  }
}

// Public endpoint for rescheduling appointments (no authentication required)
router.post(
  "/reschedule-appointment",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validationResult = RescheduleAppointmentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const data = validationResult.data;

      // Determine which format is being used
      const isFormat1 = !!(data.patientId && data.date && data.time);
      const isFormat2 = !!(data.name && data.oldDate && data.oldTime);

      let patient: { patientId: string; name: string } | null = null;
      let oldDate: string;
      let oldTime: string;
      const newDate = data.newDate;
      const newTime = data.newTime;

      // Handle Format 1: patientId + date (old) + time (old) + newDate + newTime
      if (isFormat1 && data.patientId && data.date && data.time) {
        // Verify patient exists
        patient = await prisma.patient.findUnique({
          where: { patientId: data.patientId },
          select: { patientId: true, name: true },
        });

        if (!patient) {
          return res.status(404).json({
            error: "Patient not found",
            msg: "Failed",
          });
        }

        oldDate = data.date;
        oldTime = data.time;
      }
      // Handle Format 2: name + oldDate + oldTime + newDate + newTime
      else if (isFormat2 && data.name && data.oldDate && data.oldTime) {
        // Find patient by name
        patient = await prisma.patient.findFirst({
          where: {
            name: {
              equals: data.name.trim(),
              mode: "insensitive",
            },
          },
          select: {
            patientId: true,
            name: true,
          },
        });

        if (!patient) {
          return res.status(404).json({
            error: "Patient not found",
            msg: "Failed",
          });
        }

        oldDate = data.oldDate;
        oldTime = data.oldTime;
      } else {
        return res.status(400).json({
          error: "Invalid request format. Must provide either (patientId + date + time) or (name + oldDate + oldTime)",
          msg: "Failed",
        });
      }

      // Parse old time to minutes for finding the appointment
      let oldStartTimeMin: number;
      try {
        oldStartTimeMin = parseTimeToMinutes(oldTime);
      } catch (timeError) {
        return res.status(400).json({
          error:
            timeError instanceof Error
              ? `Invalid old time format: ${timeError.message}`
              : "Invalid old time format",
          msg: "Failed",
        });
      }

      // Convert old date to Date object
      const oldAppointmentDate = toDateOnly(oldDate);

      // Find the specific appointment by patient, old date, and old time
      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          patientId: patient.patientId,
          date: oldAppointmentDate,
          startTimeMin: oldStartTimeMin,
          status: {
            in: ["Scheduled", "CheckedIn"],
          },
        },
        select: {
          appointmentId: true,
          patientId: true,
          doctorId: true,
          department: true,
          date: true,
          startTimeMin: true,
          endTimeMin: true,
        },
      });

      if (!existingAppointment) {
        return res.status(404).json({
          error: `No scheduled appointment found for this patient on ${oldDate} at ${oldTime}`,
          msg: "Failed",
        });
      }

      // Parse new time to minutes
      let newStartTimeMin: number;
      try {
        newStartTimeMin = parseTimeToMinutes(newTime);
      } catch (timeError) {
        return res.status(400).json({
          error:
            timeError instanceof Error
              ? `Invalid new time format: ${timeError.message}`
              : "Invalid new time format",
          msg: "Failed",
        });
      }

      // Default appointment duration: 30 minutes
      const newEndTimeMin = newStartTimeMin + 30;

      // Convert new date to Date object and normalize to date-only
      const newAppointmentDate = toDateOnly(newDate);

      // Determine doctor and department (use existing if not provided, or find new one)
      let doctorId: string = existingAppointment.doctorId;
      let department: string = existingAppointment.department;

      // If new doctor info is provided, find the new doctor
      if (data.doctorname && data.department) {
        const doctorname = data.doctorname;
        const dept = data.department;
        const doctorRecord = await findDoctorByNameAndDepartment(doctorname, dept);

        if (!doctorRecord) {
          // Try to find all doctors in the department to help with debugging
          const doctorsInDept = await prisma.doctor.findMany({
            where: {
              department: {
                equals: dept.trim(),
                mode: "insensitive",
              },
            },
            select: {
              doctorId: true,
              name: true,
              department: true,
            },
          });

          return res.status(404).json({
            error: `Doctor not found with name: "${doctorname}" in department: "${dept}"`,
            msg: "Failed",
            availableDoctors: doctorsInDept.length > 0
              ? doctorsInDept.map((d) => ({ name: d.name, department: d.department }))
              : `No doctors found in department "${dept}"`,
          });
        }

        doctorId = doctorRecord.doctorId;
        department = dept;
      }

      // Check if the new time slot is unique (no exact duplicate)
      try {
        await assertUniqueTimeSlot(
          doctorId,
          newAppointmentDate,
          newStartTimeMin,
          existingAppointment.appointmentId
        );
      } catch (uniqueError: any) {
        const statusCode = uniqueError.status || uniqueError.statusCode;
        if (statusCode === 409) {
          return res.status(409).json({
            error: uniqueError.message || "Time slot is already booked",
            msg: "Failed",
          });
        }
        throw uniqueError;
      }

      // Validate the new appointment slot (availability, blackouts, overlaps)
      try {
        await assertUpdatable(prisma as any, existingAppointment.appointmentId, {
          doctorId: doctorId,
          department: department,
          date: newAppointmentDate.toISOString().split("T")[0],
          startTimeMin: newStartTimeMin,
          endTimeMin: newEndTimeMin,
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

      // Update the appointment
      const updatedAppointment = await prisma.appointment.update({
        where: { appointmentId: existingAppointment.appointmentId },
        data: {
          doctorId: doctorId,
          department: department,
          date: newAppointmentDate,
          startTimeMin: newStartTimeMin,
          endTimeMin: newEndTimeMin,
          status: "Scheduled", // Ensure status is Scheduled
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Format response
      const appointmentDateStr = updatedAppointment.date.toISOString().split("T")[0];
      const daysUntilAppointment = Math.ceil(
        (updatedAppointment.date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );

      res.status(200).json({
        msg: "Success",
        appointmentId: updatedAppointment.appointmentId,
        patientId: updatedAppointment.patientId,
        patientName: updatedAppointment.patient.name,
        doctorId: updatedAppointment.doctorId,
        doctorName: updatedAppointment.doctor.name,
        department: updatedAppointment.department,
        appointmentDate: appointmentDateStr,
        startTime: formatTime(updatedAppointment.startTimeMin),
        endTime: formatTime(updatedAppointment.endTimeMin),
        duration: "30 minutes",
        appointmentStatus: updatedAppointment.status,
        reason: updatedAppointment.reason,
        location: updatedAppointment.location,
        message: "Appointment rescheduled successfully",
        queueVisibility: daysUntilAppointment <= 1
          ? "This appointment should appear in today's queue"
          : `This appointment is ${daysUntilAppointment} days away. To view it in the doctor queue, use /appointments/queue?doctorId=${updatedAppointment.doctorId}&days=${Math.max(daysUntilAppointment + 1, 7)}`,
      });
    } catch (error: unknown) {
      console.error("Public Appointment Reschedule Error:", error);

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to reschedule appointment",
        msg: "Failed",
      });
    }
  }
);

// Public endpoint for canceling/deleting appointments (no authentication required)
router.post(
  "/cancel-appointment",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validationResult = CancelAppointmentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const data = validationResult.data;

      // Determine which format is being used
      const isFormat1 = !!(data.patientId && data.date && data.time);
      const isFormat2 = !!(data.name && data.oldDate && data.oldTime);

      let patient: { patientId: string; name: string } | null = null;
      let appointmentDate: Date;
      let startTimeMin: number;

      // Handle Format 1: patientId + date + time
      if (isFormat1 && data.patientId && data.date && data.time) {
        // Verify patient exists
        patient = await prisma.patient.findUnique({
          where: { patientId: data.patientId },
          select: { patientId: true, name: true },
        });

        if (!patient) {
          return res.status(404).json({
            error: "Patient not found",
            msg: "Failed",
          });
        }

        appointmentDate = toDateOnly(data.date);
        try {
          startTimeMin = parseTimeToMinutes(data.time);
        } catch (timeError) {
          return res.status(400).json({
            error:
              timeError instanceof Error
                ? timeError.message
                : "Invalid time format",
            msg: "Failed",
          });
        }
      }
      // Handle Format 2: name + oldDate + oldTime
      else if (isFormat2 && data.name && data.oldDate && data.oldTime) {
        // Find patient by name
        patient = await prisma.patient.findFirst({
          where: {
            name: {
              equals: data.name.trim(),
              mode: "insensitive",
            },
          },
          select: {
            patientId: true,
            name: true,
          },
        });

        if (!patient) {
          return res.status(404).json({
            error: "Patient not found",
            msg: "Failed",
          });
        }

        appointmentDate = toDateOnly(data.oldDate);
        try {
          startTimeMin = parseTimeToMinutes(data.oldTime);
        } catch (timeError) {
          return res.status(400).json({
            error:
              timeError instanceof Error
                ? timeError.message
                : "Invalid time format",
            msg: "Failed",
          });
        }
      } else {
        return res.status(400).json({
          error: "Invalid request format. Must provide either (patientId + date + time) or (name + oldDate + oldTime)",
          msg: "Failed",
        });
      }

      // Find doctor by name and department
      const doctorname = data.doctorname;
      const department = data.department;
      const doctorRecord = await findDoctorByNameAndDepartment(doctorname, department);

      if (!doctorRecord) {
        // Try to find all doctors in the department to help with debugging
        const doctorsInDept = await prisma.doctor.findMany({
          where: {
            department: {
              equals: department.trim(),
              mode: "insensitive",
            },
          },
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        });

        return res.status(404).json({
          error: `Doctor not found with name: "${doctorname}" in department: "${department}"`,
          msg: "Failed",
          availableDoctors: doctorsInDept.length > 0
            ? doctorsInDept.map((d) => ({ name: d.name, department: d.department }))
            : `No doctors found in department "${department}"`,
        });
      }

      // Find the specific appointment matching all criteria
      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          patientId: patient.patientId,
          doctorId: doctorRecord.doctorId,
          date: appointmentDate,
          startTimeMin: startTimeMin,
          status: {
            in: ["Scheduled", "CheckedIn"],
          },
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      if (!existingAppointment) {
        return res.status(404).json({
          error: "No matching scheduled appointment found. Please verify the appointment date, time, doctor, and department.",
          msg: "Failed",
        });
      }

      // Cancel the appointment (set status to Cancelled)
      const cancelledAppointment = await prisma.appointment.update({
        where: { appointmentId: existingAppointment.appointmentId },
        data: {
          status: "Cancelled",
        },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Format response
      const appointmentDateStr = cancelledAppointment.date.toISOString().split("T")[0];

      res.status(200).json({
        msg: "Success",
        appointmentId: cancelledAppointment.appointmentId,
        patientId: cancelledAppointment.patientId,
        patientName: cancelledAppointment.patient.name,
        doctorId: cancelledAppointment.doctorId,
        doctorName: cancelledAppointment.doctor.name,
        department: cancelledAppointment.department,
        appointmentDate: appointmentDateStr,
        startTime: formatTime(cancelledAppointment.startTimeMin),
        endTime: formatTime(cancelledAppointment.endTimeMin),
        appointmentStatus: cancelledAppointment.status,
        message: "Appointment cancelled successfully",
      });
    } catch (error: unknown) {
      console.error("Public Appointment Cancel Error:", error);

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel appointment",
        msg: "Failed",
      });
    }
  }
);

// Public endpoint for checking doctor availability (no authentication required)
router.post(
  "/doctor-availability",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validationResult = DoctorAvailabilitySchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctor, department, date } = validationResult.data;

      // Find doctor by name and department
      const doctorRecord = await findDoctorByNameAndDepartment(doctor, department);

      if (!doctorRecord) {
        // Try to find all doctors in the department to help with debugging
        const doctorsInDept = await prisma.doctor.findMany({
          where: {
            department: {
              equals: department.trim(),
              mode: "insensitive",
            },
          },
          select: {
            doctorId: true,
            name: true,
            department: true,
          },
        });

        return res.status(404).json({
          error: `Doctor not found with name: "${doctor}" in department: "${department}"`,
          msg: "Failed",
          availableDoctors: doctorsInDept.length > 0
            ? doctorsInDept.map((d) => ({ name: d.name, department: d.department }))
            : `No doctors found in department "${department}"`,
        });
      }

      // Use provided date or default to today
      const appointmentDate = date ? toDateOnly(date) : toDateOnly(new Date().toISOString().split("T")[0]);

      // Get availability windows for the date
      const availabilityPromise = getDoctorAvailabilityForDate(
        prisma as any,
        doctorRecord.doctorId,
        appointmentDate
      );

      // Get existing appointments for the date
      const appointmentsPromise = prisma.appointment
        .findMany({
          where: {
            doctorId: doctorRecord.doctorId,
            date: appointmentDate,
            status: { not: "Cancelled" },
          },
          select: {
            startTimeMin: true,
            endTimeMin: true,
          },
        })
        .catch(() => {
          return [] as Array<{ startTimeMin: number; endTimeMin: number }>;
        });

      // Get blackouts for the date
      const blackoutsPromise = prisma.doctorBlackout
        .findMany({
          where: {
            doctorId: doctorRecord.doctorId,
            startAt: { lt: addDays(appointmentDate, 1) },
            endAt: { gt: appointmentDate },
          },
          select: {
            startAt: true,
            endAt: true,
          },
        })
        .catch(() => {
          return [] as Array<{ startAt: Date; endAt: Date }>;
        });

      const [availability, appointments, blackouts] = await Promise.all([
        availabilityPromise,
        appointmentsPromise,
        blackoutsPromise,
      ]);

      // Calculate blocked time segments
      const dayStart = appointmentDate;
      const dayEnd = addDays(dayStart, 1);
      const blackoutSegments = blackouts
        .map((blackout) =>
          convertBlackoutToSegment(blackout.startAt, blackout.endAt, dayStart, dayEnd)
        )
        .filter((segment): segment is TimeSegment => Boolean(segment));
      const bookedSegments = appointments.map((appt) => ({
        startMin: appt.startTimeMin,
        endMin: appt.endTimeMin,
      }));
      const blockers = mergeSegments([...bookedSegments, ...blackoutSegments]);

      // Calculate free slots
      const freeSlots = calculateFreeSlots(availability, blockers);

      // Format response with time strings
      const formatTimeSlot = (slot: TimeSegment) => ({
        startTime: formatTime(slot.startMin),
        endTime: formatTime(slot.endMin),
        startMin: slot.startMin,
        endMin: slot.endMin,
      });

      res.status(200).json({
        msg: "Success",
        doctorId: doctorRecord.doctorId,
        doctorName: doctorRecord.name,
        department: doctorRecord.department,
        date: appointmentDate.toISOString().split("T")[0],
        availability: availability.map(formatTimeSlot),
        blocked: blockers.map(formatTimeSlot),
        freeSlots: freeSlots.map(formatTimeSlot),
      });
    } catch (error: unknown) {
      console.error("Public Doctor Availability Error:", error);

      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve doctor availability",
        msg: "Failed",
      });
    }
  }
);

export default router;

