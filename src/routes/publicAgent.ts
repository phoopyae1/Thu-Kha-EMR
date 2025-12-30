import { Router, type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertCreatable } from "../services/appointmentService.js";
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

export default router;

