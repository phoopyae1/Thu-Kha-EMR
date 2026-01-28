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
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in format YYYY-MM-DD"),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Appointment date must be in format YYYY-MM-DD"),
  appointmentTime: z.string().min(1, "Appointment time is required"), // Accepts formats like "14:30" or "2:30pm"
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

      const { patientName, dob, appointmentDate, appointmentTime, doctor, doctordepartment, gender, reason } = validationResult.data;

      // Always create a new patient to avoid mixing appointments between patients with the same name
      // This ensures each booking creates a separate patient record, even if names are identical
      const dobDate = toDateOnly(dob);
      const patient = await prisma.patient.create({
        data: {
          name: patientName,
          dob: dobDate,
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
        startTimeMin = parseTimeToMinutes(appointmentTime);
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
      const appointmentDateObj = toDateOnly(appointmentDate);

      // Check if the time slot is unique (no exact duplicate)
      try {
        await assertUniqueTimeSlot(
          doctorRecord.doctorId,
          appointmentDateObj,
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
          date: appointmentDateObj.toISOString().split("T")[0],
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
          date: appointmentDateObj,
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
  patientName: z.string().min(1, "Patient name is required"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in format YYYY-MM-DD"),
  doctorname: z.string().min(1, "Doctor name is required"),
  department: z.string().min(1, "Doctor department is required"),
});

// Schema for doctor availability query
const DoctorAvailabilitySchema = z.object({
  doctor: z.string().min(1, "Doctor name is required"),
  department: z.string().min(1, "Doctor department is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD").optional(), // Optional date, defaults to today
});

// Schema for rescheduling appointment
// Uses patientName + dob to identify patient, then finds scheduled appointment
// with the specified doctor/department and reschedules it
// If oldDate and oldTime are provided, finds that specific appointment; otherwise finds the most recent one
const RescheduleAppointmentSchema = z.object({
  patientName: z.string().min(1, "Patient name is required"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in format YYYY-MM-DD"),
  doctorname: z.string().min(1, "Doctor name is required"), // Required for patient identity verification
  department: z.string().min(1, "Doctor department is required"), // Required for patient identity verification
  // Optional: specify which appointment to reschedule
  oldDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "oldDate must be in format YYYY-MM-DD").optional(),
  oldTime: z.string().min(1, "oldTime is required").optional(), // Accepts formats like "14:30" or "2:30pm"
  // At least one of newDate or newTime must be provided
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "newDate must be in format YYYY-MM-DD").optional(),
  newTime: z.string().min(1, "newTime is required").optional(), // Accepts formats like "14:30" or "2:30pm"
}).refine(
  (data) => {
    // At least one of newDate or newTime must be provided
    if (!data.newDate && !data.newTime) {
      return false;
    }
    return true;
  },
  {
    message: "At least one of newDate or newTime must be provided",
  }
);

// Schema for canceling appointment
// Uses patientName + dob to identify patient, then finds scheduled appointment
// with the specified doctor/department and cancels it
// If appointmentDate and appointmentTime are provided, cancels that specific appointment; otherwise cancels the most recent one
const CancelAppointmentSchema = z.object({
  patientName: z.string().min(1, "Patient name is required"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in format YYYY-MM-DD"),
  doctorname: z.string().min(1, "Doctor name is required"), // Required for patient identity verification
  department: z.string().min(1, "Doctor department is required"), // Required for patient identity verification
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Appointment date must be in format YYYY-MM-DD").optional(), // Optional: specific appointment date
  appointmentTime: z.string().min(1, "Appointment time is required").optional(), // Optional: specific appointment time (e.g., "14:30" or "2:30pm")
});

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

      const { patientName, dob, doctorname, department } = validationResult.data;

      // Convert dob to Date object for patient lookup
      const dobDate = toDateOnly(dob);

      // Find ALL patients by name and date of birth
      // Since booking endpoint always creates a new patient, there might be multiple records
      const patients = await prisma.patient.findMany({
        where: {
          name: {
            equals: patientName.trim(),
            mode: "insensitive",
          },
          dob: dobDate,
        },
        select: { patientId: true, name: true },
        orderBy: { createdAt: "desc" }, // Most recent first
      });

      if (patients.length === 0) {
        return res.status(404).json({
          error: "Patient not found with the provided name and date of birth",
          msg: "Failed",
        });
      }

      // Use the most recent patient (or all of them for appointment lookup)
      const patient = patients[0];
      const patientIds = patients.map(p => p.patientId);

      // Find doctor by name and department
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

      // Fetch appointments for ALL patients with this name+dob with the specified doctor
      // Since booking creates new patients, we need to check all patient records
      const appointments = await prisma.appointment.findMany({
        where: {
          patientId: {
            in: patientIds, // Check all patients with this name+dob
          },
          doctorId: doctorRecord.doctorId,
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

      // Convert dob to Date object for patient lookup
      const dobDate = toDateOnly(data.dob);

      // Find ALL patients by name and date of birth
      // Since booking endpoint always creates a new patient, there might be multiple records
      const patients = await prisma.patient.findMany({
        where: {
          name: {
            equals: data.patientName.trim(),
            mode: "insensitive",
          },
          dob: dobDate,
        },
        select: {
          patientId: true,
          name: true,
        },
        orderBy: { createdAt: "desc" }, // Most recent first
      });

      if (patients.length === 0) {
        return res.status(404).json({
          error: "Patient not found with the provided name and date of birth",
          msg: "Failed",
        });
      }

      // Use the most recent patient (or all of them for appointment lookup)
      const patient = patients[0];
      const patientIds = patients.map(p => p.patientId);

      // Find doctor by name and department (for verification)
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

      // Build where clause for finding appointment
      const appointmentWhere: any = {
        patientId: {
          in: patientIds, // Check all patients with this name+dob
        },
        doctorId: doctorRecord.doctorId,
        status: {
          in: ["Scheduled", "CheckedIn"],
        },
      };

      // If oldDate and oldTime are provided, find that specific appointment
      if (data.oldDate && data.oldTime) {
        const oldAppointmentDate = toDateOnly(data.oldDate);
        let oldStartTimeMin: number;
        try {
          oldStartTimeMin = parseTimeToMinutes(data.oldTime);
        } catch (timeError) {
          return res.status(400).json({
            error:
              timeError instanceof Error
                ? `Invalid old time format: ${timeError.message}`
                : "Invalid old time format",
            msg: "Failed",
          });
        }

        appointmentWhere.date = oldAppointmentDate;
        appointmentWhere.startTimeMin = oldStartTimeMin;
      }

      // Find the scheduled appointment
      // If oldDate/oldTime provided, finds that specific appointment; otherwise finds the most recent one
      const existingAppointment = await prisma.appointment.findFirst({
        where: appointmentWhere,
        orderBy: data.oldDate && data.oldTime
          ? undefined // No ordering needed if searching for specific appointment
          : [
              { date: "desc" },
              { startTimeMin: "desc" },
            ],
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
        // If searching for specific appointment, provide more helpful error
        if (data.oldDate && data.oldTime) {
          // Find all appointments for this patient/doctor to show what exists
          const allAppointments = await prisma.appointment.findMany({
            where: {
              patientId: { in: patientIds },
              doctorId: doctorRecord.doctorId,
              status: { in: ["Scheduled", "CheckedIn"] },
            },
            select: {
              date: true,
              startTimeMin: true,
              status: true,
            },
            orderBy: [
              { date: "desc" },
              { startTimeMin: "desc" },
            ],
            take: 5, // Show up to 5 recent appointments
          });

          const formattedAppointments = allAppointments.map(apt => ({
            date: apt.date.toISOString().split("T")[0],
            time: formatTime(apt.startTimeMin),
            status: apt.status,
          }));

          return res.status(404).json({
            error: `No scheduled appointment found for ${data.oldDate} at ${data.oldTime}. Please verify the date and time.`,
            msg: "Failed",
            requestedOldDate: data.oldDate,
            requestedOldTime: data.oldTime,
            availableAppointments: formattedAppointments.length > 0
              ? formattedAppointments
              : "No scheduled appointments found for this patient with this doctor",
          });
        } else {
          return res.status(404).json({
            error: `No scheduled appointment found for this patient with doctor "${doctorname}" in department "${dept}"`,
            msg: "Failed",
          });
        }
      }

      // Use existing doctor and department (cannot be changed)
      const doctorId: string = existingAppointment.doctorId;
      const department: string = existingAppointment.department;

      // Determine new date: use newDate if provided, otherwise keep old date
      const newAppointmentDate = data.newDate ? toDateOnly(data.newDate) : existingAppointment.date;

      // Determine new time: use newTime if provided, otherwise keep old time
      let newStartTimeMin: number;
      if (data.newTime) {
        try {
          newStartTimeMin = parseTimeToMinutes(data.newTime);
        } catch (timeError) {
          return res.status(400).json({
            error:
              timeError instanceof Error
                ? `Invalid new time format: ${timeError.message}`
                : "Invalid new time format",
            msg: "Failed",
          });
        }
      } else {
        // Keep the old time
        newStartTimeMin = existingAppointment.startTimeMin;
      }

      // Default appointment duration: 30 minutes
      const newEndTimeMin = newStartTimeMin + 30;

      // Check if date or time actually changed
      const dateChanged = data.newDate && newAppointmentDate.getTime() !== existingAppointment.date.getTime();
      const timeChanged = data.newTime && newStartTimeMin !== existingAppointment.startTimeMin;

      // If nothing changed, return early
      if (!dateChanged && !timeChanged) {
        return res.status(400).json({
          error: "No changes detected. Please provide at least one of newDate or newTime with a different value.",
          msg: "Failed",
        });
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

// Public endpoint for deleting appointments (no authentication required)
// When called, the appointment is completely deleted from the database and will not appear in the UI
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

      // Convert dob to Date object for patient lookup
      const dobDate = toDateOnly(data.dob);

      // Find ALL patients by name and date of birth
      // Since booking endpoint always creates a new patient, there might be multiple records
      const patients = await prisma.patient.findMany({
        where: {
          name: {
            equals: data.patientName.trim(),
            mode: "insensitive",
          },
          dob: dobDate,
        },
        select: {
          patientId: true,
          name: true,
        },
        orderBy: { createdAt: "desc" }, // Most recent first
      });

      if (patients.length === 0) {
        return res.status(404).json({
          error: "Patient not found with the provided name and date of birth",
          msg: "Failed",
        });
      }

      // Use the most recent patient (or all of them for appointment lookup)
      const patient = patients[0];
      const patientIds = patients.map(p => p.patientId);

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

      // Build where clause for finding appointment
      const appointmentWhere: any = {
        patientId: {
          in: patientIds, // Check all patients with this name+dob
        },
        doctorId: doctorRecord.doctorId,
        status: {
          in: ["Scheduled", "CheckedIn"],
        },
      };

      // If appointmentDate and appointmentTime are provided, find that specific appointment
      if (data.appointmentDate && data.appointmentTime) {
        const appointmentDateObj = toDateOnly(data.appointmentDate);
        let startTimeMin: number;
        try {
          startTimeMin = parseTimeToMinutes(data.appointmentTime);
        } catch (timeError) {
          return res.status(400).json({
            error:
              timeError instanceof Error
                ? `Invalid time format: ${timeError.message}`
                : "Invalid time format",
            msg: "Failed",
          });
        }

        appointmentWhere.date = appointmentDateObj;
        appointmentWhere.startTimeMin = startTimeMin;
      }

      // Find the scheduled appointment
      // If appointmentDate/appointmentTime provided, finds that specific appointment; otherwise finds the most recent one
      const existingAppointment = await prisma.appointment.findFirst({
        where: appointmentWhere,
        orderBy: data.appointmentDate && data.appointmentTime
          ? undefined // No ordering needed if searching for specific appointment
          : [
              { date: "desc" },
              { startTimeMin: "desc" },
            ],
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      if (!existingAppointment) {
        // If searching for specific appointment, provide more helpful error
        if (data.appointmentDate && data.appointmentTime) {
          // Find all appointments for this patient/doctor to show what exists
          const allAppointments = await prisma.appointment.findMany({
            where: {
              patientId: { in: patientIds },
              doctorId: doctorRecord.doctorId,
              status: { in: ["Scheduled", "CheckedIn"] },
            },
            select: {
              date: true,
              startTimeMin: true,
              status: true,
            },
            orderBy: [
              { date: "desc" },
              { startTimeMin: "desc" },
            ],
            take: 5, // Show up to 5 recent appointments
          });

          const formattedAppointments = allAppointments.map(apt => ({
            date: apt.date.toISOString().split("T")[0],
            time: formatTime(apt.startTimeMin),
            status: apt.status,
          }));

          return res.status(404).json({
            error: `No scheduled appointment found for ${data.appointmentDate} at ${data.appointmentTime}. Please verify the date and time.`,
            msg: "Failed",
            requestedDate: data.appointmentDate,
            requestedTime: data.appointmentTime,
            availableAppointments: formattedAppointments.length > 0
              ? formattedAppointments
              : "No scheduled appointments found for this patient with this doctor",
          });
        } else {
          return res.status(404).json({
            error: `No scheduled appointment found for this patient with doctor "${data.doctorname}" in department "${data.department}"`,
            msg: "Failed",
          });
        }
      }

      // Delete the appointment completely from the database
      // This will remove it from all queries and it will not appear in the UI
      const deletedAppointment = await prisma.appointment.delete({
        where: { appointmentId: existingAppointment.appointmentId },
        include: {
          patient: { select: { patientId: true, name: true } },
          doctor: { select: { doctorId: true, name: true, department: true } },
        },
      });

      // Format response
      const appointmentDateStr = deletedAppointment.date.toISOString().split("T")[0];

      res.status(200).json({
        msg: "Success",
        appointmentId: deletedAppointment.appointmentId,
        patientId: deletedAppointment.patientId,
        patientName: deletedAppointment.patient.name,
        doctorId: deletedAppointment.doctorId,
        doctorName: deletedAppointment.doctor.name,
        department: deletedAppointment.department,
        appointmentDate: appointmentDateStr,
        startTime: formatTime(deletedAppointment.startTimeMin),
        endTime: formatTime(deletedAppointment.endTimeMin),
        message: "Appointment cancelled and deleted successfully",
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

