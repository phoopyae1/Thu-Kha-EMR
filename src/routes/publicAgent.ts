import { Router, type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertCreatable, assertUpdatable } from "../services/appointmentService.js";
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
  location: z.string().optional(), // Optional location
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

      const { patientName, date, time, doctor, doctordepartment, gender, reason, location } = validationResult.data;

      // Find or create patient by name
      let patient = await prisma.patient.findFirst({
        where: {
          name: {
            equals: patientName,
            mode: "insensitive",
          },
        },
        select: {
          patientId: true,
          name: true,
        },
      });

      // If patient doesn't exist, create a new one
      if (!patient) {
        // Create patient with minimal required fields (name and dob are required in schema)
        // We'll use a default dob since it's required
        const defaultDob = new Date("2000-01-01");
        patient = await prisma.patient.create({
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
      }

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
          location: location || null,
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
        location: appointment.location,
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

// Schema for rescheduling appointment
const RescheduleAppointmentSchema = z.object({
  name: z.string().min(1, "Patient name is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in format YYYY-MM-DD"),
  time: z.string().min(1, "Time is required"), // Accepts formats like "14:30" or "2:30pm"
  doctorname: z.string().min(1, "Doctor name is required"),
  department: z.string().min(1, "Doctor department is required"),
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

      const { name, date, time, doctorname, department } = validationResult.data;

      // Find patient by name
      const patient = await prisma.patient.findFirst({
        where: {
          name: {
            equals: name.trim(),
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

      // Find the most recent scheduled appointment for this patient
      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          patientId: patient.patientId,
          status: {
            in: ["Scheduled", "CheckedIn"],
          },
        },
        orderBy: [
          { date: "desc" },
          { startTimeMin: "desc" },
        ],
        select: {
          appointmentId: true,
          patientId: true,
          doctorId: true,
          date: true,
          startTimeMin: true,
          endTimeMin: true,
        },
      });

      if (!existingAppointment) {
        return res.status(404).json({
          error: "No scheduled appointment found for this patient",
          msg: "Failed",
        });
      }

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

      // Validate the new appointment slot (availability, blackouts, overlaps)
      try {
        await assertUpdatable(prisma as any, existingAppointment.appointmentId, {
          doctorId: doctorRecord.doctorId,
          department: department,
          date: appointmentDate.toISOString().split("T")[0],
          startTimeMin,
          endTimeMin,
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
          doctorId: doctorRecord.doctorId,
          department: department,
          date: appointmentDate,
          startTimeMin,
          endTimeMin,
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
      const validationResult = RescheduleAppointmentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { name, date, time, doctorname, department } = validationResult.data;

      // Find patient by name
      const patient = await prisma.patient.findFirst({
        where: {
          name: {
            equals: name.trim(),
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

      // Convert date to Date object and normalize to date-only
      const appointmentDate = toDateOnly(date);

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

export default router;

