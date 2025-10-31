import { Router, type Response, type NextFunction } from "express";
import { requirePatientAuth } from "../modules/auth/index.js";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

// Helper function to extract token from Authorization header (deprecated - no longer needed)
function getTokenFromRequest(req: any): string {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new Error("Authorization header is required");
  }
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new Error("Invalid authorization format. Use Bearer token");
  }
  return token;
}

// Agent service functions will be defined inline

// 1. Medical History Agent API
router.post(
  "/medical-history",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;

      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      // Get patient data with comprehensive information
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: {
          patientId: true,
          name: true,
          dob: true,
          gender: true,
          contact: true,
          insurance: true,
          drugAllergies: true,
        },
      });

      if (!patient) {
        return res.status(404).json({
          error: "Patient not found",
          msg: "Failed",
        });
      }

      // Get comprehensive medical data
      const [
        medications,
        medicationsGiven,
        visits,
        labResults,
        immunizations,
        vitals,
        allergies,
        diagnoses,
        problems,
        observations,
      ] = await Promise.all([
        prisma.medicationOrder.findMany({
          where: { patientId },
          include: {
            prescription: {
              include: {
                visit: {
                  include: {
                    doctor: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.medication.findMany({
          where: { visit: { patientId } },
          include: {
            visit: { include: { doctor: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.visit.findMany({
          where: { patientId },
          include: {
            doctor: true,
          },
          orderBy: { visitDate: "desc" },
          take: 15,
        }),
        prisma.labResult.findMany({
          where: { patientId },
          orderBy: { resultedAt: "desc" },
          take: 15,
        }),
        prisma.immunizationRecord.findMany({
          where: { patientId },
          orderBy: { immunizationId: "desc" },
          take: 10,
        }),
        prisma.vitals.findMany({
          where: { patientId },
          orderBy: { recordedAt: "desc" },
          take: 10,
        }),
        // Get patient's drug allergies from their profile
        Promise.resolve([]), // We'll use patient.drugAllergies instead
        prisma.diagnosis.findMany({
          where: {
            visit: {
              patientId,
            },
          },
          include: {
            visit: {
              include: { doctor: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.problem.findMany({
          where: { patientId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.observation.findMany({
          where: { patientId },
          include: {
            visit: {
              include: { doctor: true },
            },
            doctor: true,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ]);

      // Calculate BMI from latest vitals or observations
      const latestVitals = vitals[0];
      const latestObservation = observations[0];
      
      // Prefer observation BMI if available, otherwise calculate from vitals
      const bmi =
        latestObservation?.bmi
          ? latestObservation.bmi.toString()
          : latestVitals && latestVitals.weightKg && latestVitals.heightCm
          ? (
              Number(latestVitals.weightKg) /
              Math.pow(Number(latestVitals.heightCm) / 100, 2)
            ).toFixed(1)
          : "Not available";

      // Use observations for latest vitals if available (more recent)
      const latestBloodPressure = latestObservation?.bpSystolic && latestObservation?.bpDiastolic
        ? `${latestObservation.bpSystolic}/${latestObservation.bpDiastolic}`
        : latestVitals?.systolic && latestVitals?.diastolic
        ? `${latestVitals.systolic}/${latestVitals.diastolic}`
        : "Not recorded";
      
      const latestHeartRate = latestObservation?.heartRate
        ? `${latestObservation.heartRate} bpm`
        : latestVitals?.heartRate
        ? `${latestVitals.heartRate} bpm`
        : "Not recorded";
      
      const latestTemperature = latestObservation?.temperatureC
        ? `${latestObservation.temperatureC}°C`
        : latestVitals?.temperature
        ? `${latestVitals.temperature}°C`
        : "Not recorded";
      
      const latestSpO2 = latestObservation?.spo2
        ? `${latestObservation.spo2}%`
        : latestVitals?.spo2
        ? `${latestVitals.spo2}%`
        : "Not recorded";

      const result = {
        // 🧠 1. Basic Patient Information
        patientName: patient.name,
        patientId: patient.patientId,
        dateOfBirth: patient.dob.toISOString().split("T")[0],
        age: new Date().getFullYear() - new Date(patient.dob).getFullYear(),
        gender: patient.gender,
        contact: patient.contact,
        address: "Not provided",
        emergencyContact: "Not provided",
        bloodType: "Not recorded",
        occupation: "Not provided",
        insurance: patient.insurance || "Not provided",

        // 🩺 2. Vital Signs and Measurements (from observations or vitals table)
        bmi: bmi,
        latestWeight: latestVitals?.weightKg
          ? `${latestVitals.weightKg} kg`
          : "Not recorded",
        latestHeight: latestVitals?.heightCm
          ? `${latestVitals.heightCm} cm`
          : "Not recorded",
        latestBloodPressure: latestBloodPressure,
        latestHeartRate: latestHeartRate,
        latestTemperature: latestTemperature,
        latestSpO2: latestSpO2,
        latestRespiratoryRate: "Not recorded",

        // 💊 3. Medication Order History (from MedicationOrder) - human-readable strings

        // Structured medication order entries (MedicationOrder): which medicine was ordered, by which doctor and when
    
        // Structured medications actually given on visits (Medication): which medicine and dosage recorded by which doctor
        medicationsGivenDetailed: medicationsGiven.map((m: any) => ({
          drug: [m.drugName, m.dosage].filter(Boolean).join(' ').trim() || 'Medication',
          givenBy: m.visit?.doctor?.name || null,
          givenOn: m.visit?.visitDate
            ? new Date(m.visit.visitDate).toISOString().split('T')[0]
            : null,
          visitId: m.visitId || null,
          instructions: m.instructions || null,
        })),
     
        // 💉 4. Allergies & Adverse Reactions (details only)
        allergies: patient.drugAllergies
          ? String(patient.drugAllergies)
              .split(/[,;\n]+/)
              .map((entry: string) => entry.trim())
              .filter(Boolean)
          : [],

        // 🧬 5. Past Medical History (PMH)
        chronicConditions: problems
          .filter((p: any) => p.status === "ACTIVE")
          .map((p: any) => p.description),
        totalChronicConditions: problems.filter(
          (p: any) => p.status === "ACTIVE"
        ).length,
        pastSurgeries: visits.filter((v: any) =>
          v.department?.toLowerCase().includes("surgery")
        ).length,
        totalVisits: visits.length,
        recentVisits: visits
          .slice(0, 3)
          .map(
            (v: any) =>
              `${v.visitDate.toISOString().split("T")[0]} - ${v.doctor.name} (${
                v.department
              })`
          ),

        // 🧪 6. Lab Results & Diagnostics
        totalLabResults: labResults.length,
        recentLabResults: labResults
          .slice(0, 5)
          .map(
            (lab: any) =>
              `Lab test - ${lab.resultValue || "No result"} (${
                lab.resultedAt.toISOString().split("T")[0]
              })`
          ),
        abnormalResults: labResults.filter(
          (lab: any) =>
            lab.resultValue?.toLowerCase().includes("high") ||
            lab.resultValue?.toLowerCase().includes("low") ||
            lab.resultValue?.toLowerCase().includes("abnormal")
        ).length,

        // 🗓 7. Immunization Record
        totalImmunizations: immunizations.length,
        recentImmunizations: immunizations
          .slice(0, 3)
          .map(
            (imm: any) =>
              `${imm.vaccineName} - ${
                imm.dateAdministered.toISOString().split("T")[0]
              }`
          ),

        // 🧾 8. Current Medical Conditions & Treatment Plan (diagnoses detail, no counts)
        diagnoses: diagnoses.map((d: any) => {
          const desc = d.description || d.diagnosis || "Diagnosis";
          const date = d.createdAt
            ? new Date(d.createdAt).toISOString().split("T")[0]
            : undefined;
          const doctor = d.visit?.doctor?.name
            ? ` (by Dr. ${d.visit.doctor.name}` +
              (date ? ` on ${date}` : "") +
              ")"
            : date
            ? ` (${date})`
            : "";
          return `${desc}${doctor || ""}`;
        }),
        activeProblems: problems.filter((p: any) => p.status === "ACTIVE")
          .length,
        resolvedProblems: problems.filter((p: any) => p.status === "RESOLVED")
          .length,

        // 📝 9. Clinical Observations (Notes, Vitals, SpO2, etc.) - Flattened
        totalObservations: observations.length,
        latestObservation: observations.length > 0
          ? (() => {
              const latest = observations[0];
              const vitalsParts: string[] = [];
              if (latest.bpSystolic && latest.bpDiastolic) {
                vitalsParts.push(`BP ${latest.bpSystolic}/${latest.bpDiastolic}`);
              }
              if (latest.heartRate) {
                vitalsParts.push(`HR ${latest.heartRate}`);
              }
              if (latest.spo2) {
                vitalsParts.push(`SpO2 ${latest.spo2}%`);
              }
              const vitalsStr = vitalsParts.length > 0 ? ` - ${vitalsParts.join(', ')}` : '';
              return (latest.noteText || 'Vitals recorded') + vitalsStr;
            })()
          : "No observations recorded",
        lastObservationDate:
          observations.length > 0
            ? new Date(observations[0].createdAt).toISOString().split("T")[0]
            : "No observations",

        // 📊 Summary Statistics
        lastVisitDate:
          visits.length > 0
            ? visits[0].visitDate.toISOString().split("T")[0]
            : "No visits",
        lastLabDate:
          labResults.length > 0
            ? labResults[0].resultedAt.toISOString().split("T")[0]
            : "No lab results",
        lastVitalDate:
          vitals.length > 0
            ? vitals[0].recordedAt.toISOString().split("T")[0]
            : "No vitals recorded",

        status: "Success",
      };

      // Flatten observations as numbered fields
      const flattenedResult: any = result;
      observations.forEach((obs: any, index: number) => {
        const prefix = `observation${index + 1}`;
        const vitalsParts: string[] = [];
        if (obs.bpSystolic && obs.bpDiastolic) {
          vitalsParts.push(`BP: ${obs.bpSystolic}/${obs.bpDiastolic} mmHg`);
        }
        if (obs.heartRate) {
          vitalsParts.push(`HR: ${obs.heartRate} bpm`);
        }
        if (obs.temperatureC) {
          vitalsParts.push(`Temp: ${obs.temperatureC}°C`);
        }
        if (obs.spo2) {
          vitalsParts.push(`SpO2: ${obs.spo2}%`);
        }
        if (obs.bmi) {
          vitalsParts.push(`BMI: ${obs.bmi}`);
        }
        
        const vitalsStr = vitalsParts.length > 0 ? ` (${vitalsParts.join(', ')})` : '';
        const note = obs.noteText || '';
        const observationText = note + vitalsStr;
        
        flattenedResult[`${prefix}Id`] = obs.obsId;
        flattenedResult[`${prefix}Note`] = obs.noteText || 'Vitals recorded';
        flattenedResult[`${prefix}Text`] = observationText || 'Vitals recorded';
        flattenedResult[`${prefix}BloodPressure`] = obs.bpSystolic && obs.bpDiastolic 
          ? `${obs.bpSystolic}/${obs.bpDiastolic} mmHg` 
          : "Not recorded";
        flattenedResult[`${prefix}HeartRate`] = obs.heartRate ? `${obs.heartRate} bpm` : "Not recorded";
        flattenedResult[`${prefix}Temperature`] = obs.temperatureC ? `${obs.temperatureC}°C` : "Not recorded";
        flattenedResult[`${prefix}SpO2`] = obs.spo2 ? `${obs.spo2}%` : "Not recorded";
        flattenedResult[`${prefix}BMI`] = obs.bmi ? obs.bmi.toString() : "Not recorded";
        flattenedResult[`${prefix}RecordedBy`] = obs.doctor?.name || obs.visit?.doctor?.name || "Unknown";
        flattenedResult[`${prefix}Department`] = obs.visit?.department || "Not specified";
        flattenedResult[`${prefix}RecordedDate`] = obs.createdAt
          ? new Date(obs.createdAt).toISOString().split("T")[0]
          : "Not specified";
        flattenedResult[`${prefix}RecordedTime`] = obs.createdAt
          ? new Date(obs.createdAt).toISOString().split("T")[1]?.split(".")[0] || "00:00:00"
          : "Not specified";
        flattenedResult[`${prefix}VisitId`] = obs.visitId || "Not linked";
        flattenedResult[`${prefix}VisitDate`] = obs.visit?.visitDate
          ? new Date(obs.visit.visitDate).toISOString().split("T")[0]
          : "Not specified";
      });

      res.json(flattenedResult);
    } catch (error) {
      console.error("Medical History Agent Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch medical history",
        msg: "Failed",
      });
    }
  }
);

// 2. Appointment Agent API - Get appointments
router.post(
  "/appointments",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;

      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const [upcoming, past] = await Promise.all([
        prisma.appointment.findMany({
          where: {
            patientId,
            date: { gte: today },
          },
          include: {
            doctor: true,
          },
          orderBy: { date: "asc" },
        }),
        prisma.appointment.findMany({
          where: {
            patientId,
            date: { lt: today },
          },
          include: {
            doctor: true,
          },
          orderBy: { date: "desc" },
        }),
      ]);

      // Flatten all appointments to top level
      const result: any = {
        // Summary Counts
        upcomingAppointmentCount: upcoming.length,
        pastAppointmentCount: past.length,
        status: "Success",
      };

      // Add upcoming appointments as flat fields
      upcoming.forEach((apt, index) => {
        const prefix = `upcomingAppointment${index + 1}`;
        result[`${prefix}Id`] = apt.appointmentId;
        result[`${prefix}Date`] = apt.date.toISOString().split("T")[0];
        result[`${prefix}Time`] = formatTime(apt.startTimeMin);
        result[`${prefix}Doctor`] = apt.doctor.name;
        result[`${prefix}Department`] = apt.department;
        result[`${prefix}Reason`] = apt.reason;
        result[`${prefix}Location`] = apt.location;
        result[`${prefix}Status`] = apt.status;
      });

      // Add past appointments as flat fields
      past.forEach((apt, index) => {
        const prefix = `pastAppointment${index + 1}`;
        result[`${prefix}Id`] = apt.appointmentId;
        result[`${prefix}Date`] = apt.date.toISOString().split("T")[0];
        result[`${prefix}Time`] = formatTime(apt.startTimeMin);
        result[`${prefix}Doctor`] = apt.doctor.name;
        result[`${prefix}Department`] = apt.department;
        result[`${prefix}Reason`] = apt.reason;
        result[`${prefix}Location`] = apt.location;
        result[`${prefix}Status`] = apt.status;
      });

      res.json(result);
    } catch (error) {
      console.error("Appointment Agent Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch appointments",
        msg: "Failed",
      });
    }
  }
);

// Helper function to parse time string to minutes
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

// 2.1. Appointment Agent API - Create appointment
router.post(
  "/appointments/create",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const body = req.body;

      const { patientId, doctorName, department, date, startTime, reason } =
        body;

      if (!patientId || !doctorName || !department || !date || !startTime) {
        return res.status(400).json({
          error:
            "Missing required fields: patientId, doctorName, department, date, startTime",
          msg: "Failed",
        });
      }

      // Validate patient exists
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

      // Find doctor by name
      const doctor = await prisma.doctor.findFirst({
        where: {
          name: {
            contains: doctorName,
            mode: "insensitive",
          },
        },
        select: { doctorId: true, name: true, department: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: `Doctor not found with name: ${doctorName}`,
          msg: "Failed",
        });
      }

      // Parse start time to minutes
      let startTimeMin: number;

      try {
        startTimeMin = parseTimeToMinutes(startTime);
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

      // Create the appointment
      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          doctorId: doctor.doctorId,
          department,
          date: new Date(date),
          startTimeMin,
          endTimeMin,
          reason: reason || null,
          location: null,
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
        await recordAtenxionTransaction(patientId);
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

      // Return flat response for agents
      res.status(201).json({
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        patientName: appointment.patient.name,
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
        department: appointment.department,
        appointmentDate: appointment.date.toISOString().split("T")[0],
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        duration: "30 minutes",
        reason: appointment.reason,
        location: appointment.location,
        appointmentStatus: "Scheduled",
        createdAt: appointment.createdAt.toISOString(),
        message: "Appointment created successfully",
        status: "Success",
      });
    } catch (error) {
      console.error("Create Appointment Agent Error:", error);
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

const availableDoctorsSchema = z.object({
  date: z.string().trim().optional(),      // '2025-11-01' (optional; defaults to today)
  startTime: z.string().trim().optional(), // '09:00' or '9:00am'
  endTime: z.string().trim().optional(),
  department: z.string().trim().optional(),
  search: z.string().trim().optional(),    // free-text search, e.g. "physician" or "duke"
  limit: z.number().int().positive().max(100).optional(),
});

router.post('/available-doctors',
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
  const parsed = availableDoctorsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { date, startTime, endTime, department, search, limit = 20 } = parsed.data;

  // Resolve date (default to today if not provided)
  let day: Date;
  if (date) {
    try {
      day = new Date(date);
      if (Number.isNaN(day.getTime())) throw new Error('Invalid date');
    } catch {
      return res.status(400).json({ error: 'Invalid date' });
    }
  } else {
    const now = new Date();
    day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // Time window in minutes (optional)
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  try {
    if (startTime) {
      windowStart = parseTimeToMinutes(startTime);
      windowEnd = endTime ? parseTimeToMinutes(endTime) : windowStart + 30;
    }
  } catch (e: any) {
    return res.status(400).json({ error: e.message || 'Invalid time format' });
  }

  // Compute dayOfWeek (0=Sunday .. 6=Saturday) per JS, align with your data
  const dayOfWeek = day.getDay();

  // Build where clause: department filter and/or free-text search across name/department
  const doctorWhere: any = {};
  if (department) {
    doctorWhere.department = { contains: department, mode: 'insensitive' };
  }
  if (search) {
    doctorWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { department: { contains: search, mode: 'insensitive' } },
    ];
  }

  // If no time window/date provided, return full doctor list mapping (name + department) with optional search filters
  if (!startTime && !endTime && !date) {
    const allDoctors = await prisma.doctor.findMany({
      where: doctorWhere,
      select: { name: true, department: true },
      orderBy: { name: 'asc' },
      take: Math.min(limit, 100),
    });

    const mapping = allDoctors.map((d) => ({ name: d.name, department: d.department }));
    return res.json({ count: mapping.length, data: mapping });
  }

  // Fetch candidate doctors (+ availability + blackouts) for time/date-specific queries
  const doctors = await prisma.doctor.findMany({
    where: doctorWhere,
    select: {
      doctorId: true,
      name: true,
      department: true,
      availabilities: {
        where: { dayOfWeek },
        select: { startMin: true, endMin: true },
        orderBy: { startMin: 'asc' },
      },
      blackouts: {
        where: {
          OR: [
            { startAt: { lte: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59) } },
            { endAt:   { gte: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0) } },
          ],
        },
        select: { startAt: true, endAt: true, reason: true },
      },
    },
    orderBy: [{ name: 'asc' }],
    take: Math.min(limit, 100),
  });

  // Check availability overlap
  const isTimeWindowAvailable = (slots: { startMin: number; endMin: number }[]) => {
    if (windowStart == null || windowEnd == null) {
      return slots.length > 0; // available sometime that day
    }
    return slots.some((s) => !(s.endMin <= windowStart! || s.startMin >= windowEnd!));
  };

  const isBlackoutBlocking = (blackouts: { startAt: Date; endAt: Date }[]) => {
    if (windowStart == null || windowEnd == null) return false;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(windowStart / 60), windowStart % 60);
    const end   = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(windowEnd / 60), windowEnd % 60);
    return blackouts.some((b) => !(b.endAt <= start || b.startAt >= end));
  };

  const available = doctors
    .filter((d) => d.availabilities.length > 0 && !isBlackoutBlocking(d.blackouts) && isTimeWindowAvailable(d.availabilities))
    .map((d) => ({
      doctorId: d.doctorId,
      name: d.name,
      department: d.department,
      doctorWithDepartment: `Dr. ${d.name}${d.department ? ", " + d.department : ''}`,
      dayOfWeek,
      slots: d.availabilities.map((s) => ({
        startMin: s.startMin,
        endMin: s.endMin,
      })),
    }));

  // Prefer body flags: { doctorname: true } or { department: true }
  // Fallback to doctor names if neither is set
  const chooseDepartment = Boolean(req.body && req.body.department);
  const chooseDoctorName = Boolean(req.body && req.body.doctorname);
  const chosenField = chooseDepartment ? 'department' : 'doctorName';

  // If both are provided, doctorname wins only when department is falsey
  const minimal = available
    .map((d) => ((chosenField === 'department' && !chooseDoctorName) ? d.department : d.name))
    .filter((v) => v != null);
  res.json({ count: minimal.length, data: minimal });
});
// 3. Medication Order Agent API
router.post(
  "/medication-orders",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    console.log("[medication-orders] Request received");
    try {
      const { patientId } = req.body;
      console.log("[medication-orders] PatientId:", patientId);

      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      let orders;
      try {
        orders = await prisma.medicationOrder.findMany({
          where: { patientId },
          include: {
            prescription: {
              include: {
                items: {
                  include: {
                    drug: true,
                  },
                },
                visit: {
                  include: {
                    doctor: true,
                  },
                },
              },
            },
            approvedBy: true,
            updatedBy: true,
          },
          orderBy: { createdAt: "desc" },
        });
        console.log("Medication Order Result - Found", orders.length, "orders");
      } catch (queryError) {
        console.error("Prisma query error:", queryError);
        throw new Error(`Database query failed: ${queryError instanceof Error ? queryError.message : String(queryError)}`);
      }

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

      // Helper function to format medicine name with dosage
      const formatMedicineName = (order: any): string => {
        const drugName = order.drugName || order.prescription?.items?.[0]?.drug?.name || "Unknown medication";
        const dosage = order.dosage || order.prescription?.items?.[0]?.dose || "";
        
        if (dosage && dosage.trim()) {
          return `${drugName}-${dosage}`;
        }
        return drugName;
      };

      // Process orders into optimized format
      const medicationOrders = orders.map((order: any) => {
        const firstPrescriptionItem = order.prescription?.items?.[0];
        const drug = firstPrescriptionItem?.drug;
        const medicineName = formatMedicineName(order);
        const status = getStatusText(order.status || "PENDING");

        // Safe date handling
        let createdAtDate = "Not specified";
        try {
          if (order.createdAt) {
            const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
            if (!isNaN(createdAt.getTime())) {
              createdAtDate = createdAt.toISOString().split("T")[0];
            }
          }
        } catch {
          // Keep default
        }

        let approvedDate = null;
        try {
          if (order.approvedAt) {
            const approvedAt = order.approvedAt instanceof Date ? order.approvedAt : new Date(order.approvedAt);
            if (!isNaN(approvedAt.getTime())) {
              approvedDate = approvedAt.toISOString().split("T")[0];
            }
          }
        } catch {
          // Keep null
        }

        return {
          orderId: order.orderId,
          medicine: medicineName,
          status: status,
          statusCode: order.status,
          dosage: order.dosage || firstPrescriptionItem?.dose || null,
          instructions: order.instructions || firstPrescriptionItem?.notes || null,
          quantity: order.quantity || firstPrescriptionItem?.quantityPrescribed || null,
          frequency: firstPrescriptionItem?.frequency || null,
          duration: firstPrescriptionItem?.durationDays ? `${firstPrescriptionItem.durationDays} days` : null,
          createdAt: createdAtDate,
          approvedAt: approvedDate,
          approvedBy: order.approvedBy?.name || null,
          prescriptionId: order.prescription?.prescriptionId || null,
          visitId: order.prescription?.visit?.visitId || null,
          doctorName: order.prescription?.visit?.doctor?.name || null,
          department: order.prescription?.visit?.department || null,
        };
      });

      // Summary counts
      const statusCounts = {
        total: orders.length,
        pending: orders.filter((o: any) => o.status === "PENDING").length,
        approved: orders.filter((o: any) => o.status === "APPROVED").length,
        onTheWay: orders.filter((o: any) => o.status === "ON_THE_WAY").length,
        shipping: orders.filter((o: any) => o.status === "SHIPPING").length,
        shipped: orders.filter((o: any) => o.status === "SHIPPED").length,
        delivered: orders.filter((o: any) => o.status === "DELIVERED").length,
        cancelled: orders.filter((o: any) => o.status === "CANCELLED").length,
      };

      // Build optimized response
      const result: any = {
        status: "Success",
        summary: statusCounts,
        orders: medicationOrders,
        // Additional summary for backward compatibility
        totalOrders: orders.length,
        medicineNames: [...new Set(medicationOrders.map((o: any) => o.medicine).filter(Boolean))],
      };

      console.log("[medication-orders] Sending response");
      res.json(result);
    } catch (error) {
      console.error("[medication-orders] Error caught:", error);
      try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("[medication-orders] Error details:", errorMessage, errorStack);
        res.status(500).json({
          error: errorMessage || "Failed to fetch medication orders",
          msg: "Failed",
          ...(errorStack && { details: errorStack }),
        });
      } catch (errorHandlerError) {
        console.error("[medication-orders] Error handler failed:", errorHandlerError);
        // Last resort - send minimal error
        try {
          res.status(500).json({ error: "Internal server error" });
        } catch {
          // If even this fails, just log it
          console.error("[medication-orders] Complete failure to send error response");
        }
      }
    }
  }
);

// Create a new medication order (minimal fields)
router.post(
  "/medication-orders/create",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        patientId: z.string().uuid(),
        drugName: z.string().trim().min(1),
        dosage: z.string().trim().optional(),
        instructions: z.string().trim().optional(),
        quantity: z.number().int().positive().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { patientId, drugName, dosage, instructions, quantity } = parsed.data;

      // Ensure patient exists
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: { patientId: true, name: true },
      });
      if (!patient) {
        return res.status(404).json({ error: "Patient not found", msg: "Failed" });
      }

      const created = await prisma.medicationOrder.create({
        data: {
          patientId,
          drugName,
          dosage: dosage ?? null,
          instructions: instructions ?? null,
          quantity: typeof quantity === 'number' ? quantity : null,
          // status defaults to PENDING per schema
        },
        select: {
          orderId: true,
          patientId: true,
          drugName: true,
          dosage: true,
          instructions: true,
          quantity: true,
          status: true,
          createdAt: true,
        },
      });

      return res.status(201).json({
        orderId: created.orderId,
        patientId: created.patientId,
        drug: [created.drugName, created.dosage].filter(Boolean).join(' ').trim() || created.drugName,
        instructions: created.instructions,
        quantity: created.quantity,
        status: created.status,
        createdAt: created.createdAt,
        message: "Medication order created successfully",
        statusText: "Success",
      });
    } catch (error) {
      console.error("Create Medication Order Error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create medication order',
        msg: 'Failed',
      });
    }
  }
);

// 4. Billing Agent API - Optimized for Widgets
router.post(
  "/billing",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId, startDate, endDate, doctorId } = req.body;

      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      // Build where clause for date filtering
      const whereClause: any = { patientId };
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate)
          whereClause.createdAt.gte = new Date(startDate as string);
        if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
      }

      // Get spending analytics by doctor using raw SQL for better performance
      const spendingByDoctor = await prisma.$queryRaw<
        Array<{
          doctorId: string;
          doctorName: string;
          totalSpent: number;
          totalPaid: number;
          visitCount: number;
          lastVisit: Date;
        }>
      >`
        SELECT 
          v."doctorId",
          d.name as "doctorName",
          COALESCE(SUM(i."grandTotal"), 0) as "totalSpent",
          COALESCE(SUM(i."amountPaid"), 0) as "totalPaid",
          COUNT(DISTINCT v."visitId") as "visitCount",
          MAX(v."visitDate") as "lastVisit"
        FROM "Invoice" i
        JOIN "Visit" v ON i."visitId" = v."visitId"
        JOIN "Doctor" d ON v."doctorId" = d."doctorId"
        WHERE i."patientId" = ${patientId}::uuid
          AND i.status != 'VOID'
          ${
            doctorId
              ? Prisma.sql`AND v."doctorId" = ${doctorId}::uuid`
              : Prisma.empty
          }
          ${
            startDate
              ? Prisma.sql`AND i."createdAt" >= ${new Date(
                  startDate as string
                )}`
              : Prisma.empty
          }
          ${
            endDate
              ? Prisma.sql`AND i."createdAt" <= ${new Date(endDate as string)}`
              : Prisma.empty
          }
        GROUP BY v."doctorId", d.name
        ORDER BY "totalSpent" DESC
      `;

      // Get overall spending summary
      const overallSummary = await prisma.invoice.aggregate({
        where: whereClause,
        _sum: {
          grandTotal: true,
          amountPaid: true,
          amountDue: true,
        },
        _count: {
          invoiceId: true,
        },
      });

      // Get recent invoices with minimal data
      const recentInvoices = await prisma.invoice.findMany({
        where: whereClause,
        select: {
          invoiceId: true,
          invoiceNo: true,
          status: true,
          grandTotal: true,
          amountPaid: true,
          amountDue: true,
          createdAt: true,
          Visit: {
            select: {
              visitDate: true,
              department: true,
              doctor: {
                select: {
                  doctorId: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      // Get recent payments
      const recentPayments = await prisma.payment.findMany({
        where: {
          Invoice: {
            patientId: patientId,
          },
        },
        select: {
          amount: true,
          paidAt: true,
          method: true,
        },
        orderBy: { paidAt: "desc" },
        take: 5,
      });

      // Calculate totals
      const totalSpent = Number(overallSummary._sum.grandTotal || 0);
      const totalPaid = Number(overallSummary._sum.amountPaid || 0);
      const totalDue = Number(overallSummary._sum.amountDue || 0);
      const totalInvoices = overallSummary._count.invoiceId;

      // FLAT RESPONSE - Numbered flat keys (no arrays, no nested objects)
      const result: any = {
        // Core Summary
        totalSpent: totalSpent.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        totalDue: totalDue.toFixed(2),

        // Top Doctor (flat fields for quick answers)
        topDoctorName:
          spendingByDoctor.length > 0 ? spendingByDoctor[0].doctorName : null,
        topDoctorSpent:
          spendingByDoctor.length > 0
            ? spendingByDoctor[0].totalSpent.toFixed(2)
            : "0.00",
        topDoctorPaid:
          spendingByDoctor.length > 0
            ? spendingByDoctor[0].totalPaid.toFixed(2)
            : "0.00",
        topDoctorVisits:
          spendingByDoctor.length > 0
            ? Number(spendingByDoctor[0].visitCount)
            : 0,

        // Recent Payment (flat fields)
        lastPaymentAmount:
          recentPayments.length > 0
            ? Number(recentPayments[0].amount).toFixed(2)
            : "0.00",
        lastPaymentDate:
          recentPayments.length > 0
            ? recentPayments[0].paidAt.toISOString().split("T")[0]
            : null,
        lastPaymentMethod:
          recentPayments.length > 0 ? recentPayments[0].method : null,

        // Doctor Count
        doctorCount: spendingByDoctor.length,
      };

      // Add numbered doctor fields (doctor1, doctor2, etc.)
      spendingByDoctor.forEach((doctor, index) => {
        const prefix = `doctor${index + 1}`;
        result[`${prefix}Name`] = doctor.doctorName;
        result[`${prefix}Spent`] = doctor.totalSpent.toFixed(2);
        result[`${prefix}Paid`] = doctor.totalPaid.toFixed(2);
        result[`${prefix}Visits`] = Number(doctor.visitCount);
      });

      // Add numbered recent invoice fields (recentInvoice1, recentInvoice2, etc.)
      recentInvoices.slice(0, 3).forEach((invoice, index) => {
        const prefix = `recentInvoice${index + 1}`;
        result[`${prefix}Number`] = invoice.invoiceNo;
        result[`${prefix}Amount`] = Number(invoice.grandTotal).toFixed(2);
        result[`${prefix}Status`] = invoice.status;
        result[`${prefix}Doctor`] = invoice.Visit.doctor.name;
        result[`${prefix}Date`] = invoice.createdAt.toISOString().split("T")[0];
      });

      res.json(result);
    } catch (error) {
      console.error("Billing Agent Error:", error);
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

// 5. Appointment Letter Agent API
router.post(
  "/appointment-letters",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;

      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: {
          patientId: true,
          name: true,
          contact: true,
        },
      });

      if (!patient) {
        return res.status(404).json({
          error: "Patient not found",
          msg: "Failed",
        });
      }

      const appointments = await prisma.appointment.findMany({
        where: { patientId },
        include: {
          doctor: true,
        },
        orderBy: { date: "desc" },
      });

      // Generate appointment letters based on appointment status
      const appointmentLetters = [];

      for (const appointment of appointments) {
        const letterTypes = generateAppointmentLetters(appointment, patient);
        appointmentLetters.push(...letterTypes);
      }

      // Calculate summary statistics
      const summary = {
        totalLetters: appointmentLetters.length,
        pendingLetters: appointmentLetters.filter(
          (l) => (l.status as string) === "PENDING"
        ).length,
        sentLetters: appointmentLetters.filter(
          (l) => (l.status as string) === "SENT"
        ).length,
        deliveredLetters: appointmentLetters.filter(
          (l) => (l.status as string) === "DELIVERED"
        ).length,
        readLetters: appointmentLetters.filter(
          (l) => (l.status as string) === "READ"
        ).length,
        failedLetters: appointmentLetters.filter(
          (l) => (l.status as string) === "FAILED"
        ).length,
      };

      const result = {
        totalLetters: appointmentLetters.length,
        pendingLetters: appointmentLetters.filter((l) => l.status === "PENDING")
          .length,
        sentLetters: appointmentLetters.filter((l) => l.status === "SENT")
          .length,
        deliveredLetters: appointmentLetters.filter(
          (l) => l.status === "DELIVERED"
        ).length,
        readLetters: appointmentLetters.filter((l) => l.status === "READ")
          .length,
        failedLetters: appointmentLetters.filter((l) => l.status === "FAILED")
          .length,
        recentLetters: appointmentLetters
          .slice(0, 3)
          .map(
            (letter) =>
              `${letter.title} - ${letter.doctorInfo.name} - ${
                letter.createdAt.split("T")[0]
              }`
          ),
        status: "Success",
      };

      res.json(result);
    } catch (error) {
      console.error("Appointment Letter Agent Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch appointment letters",
        msg: "Failed",
      });
    }
  }
);

// Helper function to generate appointment letters based on status
function generateAppointmentLetters(appointment: any, patient: any) {
  const letters = [];
  const now = new Date();
  const appointmentDate = new Date(appointment.date);

  // Generate letters based on appointment status and timing
  if (appointment.status === "CONFIRMED" && appointmentDate > now) {
    // Appointment accepted letter
    letters.push({
      letterId: `letter_${appointment.appointmentId}_accepted`,
      appointmentId: appointment.appointmentId,
      patientId: patient.patientId,
      doctorId: appointment.doctor.doctorId,
      letterType: "APPOINTMENT_ACCEPTED",
      status: "SENT",
      title: `Appointment Confirmed - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${
        appointment.doctor.name
      } has been confirmed for ${appointment.date} at ${formatTime(
        appointment.startTimeMin
      )}.\n\nPlease arrive 15 minutes early for check-in.\n\nBest regards,\nDr. ${
        appointment.doctor.name
      }`,
      patientInfo: {
        name: patient.name,
        email: null, // Email not available in patient schema
        phone: patient.contact || null,
      },
      doctorInfo: {
        name: appointment.doctor.name,
        department: appointment.doctor.department,
        email: `${appointment.doctor.name
          .toLowerCase()
          .replace(" ", ".")}@hospital.com`,
      },
      appointmentInfo: {
        date: appointment.date,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        department: appointment.department,
        location: appointment.location,
        reason: appointment.reason,
      },
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readAt: null,
    });
  }

  if (appointment.status === "COMPLETED") {
    // Appointment completed letter
    letters.push({
      letterId: `letter_${appointment.appointmentId}_completed`,
      appointmentId: appointment.appointmentId,
      patientId: patient.patientId,
      doctorId: appointment.doctor.doctorId,
      letterType: "APPOINTMENT_COMPLETED",
      status: "SENT",
      title: `Appointment Completed - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} on ${appointment.date} has been completed.\n\nThank you for choosing our healthcare services.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: null, // Email not available in patient schema
        phone: patient.contact || null,
      },
      doctorInfo: {
        name: appointment.doctor.name,
        department: appointment.doctor.department,
        email: `${appointment.doctor.name
          .toLowerCase()
          .replace(" ", ".")}@hospital.com`,
      },
      appointmentInfo: {
        date: appointment.date,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        department: appointment.department,
        location: appointment.location,
        reason: appointment.reason,
      },
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readAt: null,
    });
  }

  if (appointment.status === "CANCELLED") {
    // Appointment cancelled letter
    letters.push({
      letterId: `letter_${appointment.appointmentId}_cancelled`,
      appointmentId: appointment.appointmentId,
      patientId: patient.patientId,
      doctorId: appointment.doctor.doctorId,
      letterType: "APPOINTMENT_CANCELLED",
      status: "SENT",
      title: `Appointment Cancelled - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} scheduled for ${appointment.date} has been cancelled.\n\nPlease contact us to reschedule if needed.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: null, // Email not available in patient schema
        phone: patient.contact || null,
      },
      doctorInfo: {
        name: appointment.doctor.name,
        department: appointment.doctor.department,
        email: `${appointment.doctor.name
          .toLowerCase()
          .replace(" ", ".")}@hospital.com`,
      },
      appointmentInfo: {
        date: appointment.date,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        department: appointment.department,
        location: appointment.location,
        reason: appointment.reason,
      },
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readAt: null,
    });
  }

  return letters;
}

// 6. Widget-Optimized Quick Queries
// router.post(
//   '/widget/patient-spending-summary',
//   requireAuth,
//   async (req: AuthRequest, res: Response, next: NextFunction) => {
//     try {
//       const { patientId, doctorId, startDate, endDate } = req.body;
//       const user = req.user!;

//       if (!patientId) {
//         return res.status(400).json({
//           error: 'Patient ID is required',
//           msg: 'Failed'
//         });
//       }

//       // If user is a patient, they can only view their own data
//       if (user.role === 'Patient') {
//         if (!user.patientId || patientId !== user.patientId) {
//           return res.status(403).json({
//             error: 'Access denied',
//             msg: 'Failed'
//           });
//         }
//       }

//       // Get spending summary by doctor using optimized query
//       const spendingByDoctor = await prisma.$queryRaw<Array<{
//         doctorId: string;
//         doctorName: string;
//         totalSpent: number;
//         totalPaid: number;
//         visitCount: number;
//         lastVisit: Date;
//       }>>`
//         SELECT
//           v."doctorId",
//           d.name as "doctorName",
//           COALESCE(SUM(i."grandTotal"), 0) as "totalSpent",
//           COALESCE(SUM(i."amountPaid"), 0) as "totalPaid",
//           COUNT(DISTINCT v."visitId") as "visitCount",
//           MAX(v."visitDate") as "lastVisit"
//         FROM "Invoice" i
//         JOIN "Visit" v ON i."visitId" = v."visitId"
//         JOIN "Doctor" d ON v."doctorId" = d."doctorId"
//         WHERE i."patientId" = ${patientId}::uuid
//           AND i.status != 'VOID'
//           ${doctorId ? Prisma.sql`AND v."doctorId" = ${doctorId}::uuid` : Prisma.empty}
//           ${startDate ? Prisma.sql`AND i."createdAt" >= ${new Date(startDate as string)}` : Prisma.empty}
//           ${endDate ? Prisma.sql`AND i."createdAt" <= ${new Date(endDate as string)}` : Prisma.empty}
//         GROUP BY v."doctorId", d.name
//         ORDER BY "totalSpent" DESC
//         LIMIT 10
//       `;

//       // Get overall totals
//       const whereClause: any = { patientId };
//       if (startDate || endDate) {
//         whereClause.createdAt = {};
//         if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
//         if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
//       }

//       const totals = await prisma.invoice.aggregate({
//         where: whereClause,
//         _sum: {
//           grandTotal: true,
//           amountPaid: true,
//           amountDue: true
//         },
//         _count: {
//           invoiceId: true
//         }
//       });

//       res.json({
//         patientId,
//         period: { startDate, endDate, doctorId },
//         totalSpent: Number(totals._sum.grandTotal || 0).toFixed(2),
//         totalPaid: Number(totals._sum.amountPaid || 0).toFixed(2),
//         totalDue: Number(totals._sum.amountDue || 0).toFixed(2),
//         invoiceCount: totals._count.invoiceId,
//         topDoctor: spendingByDoctor.length > 0 ? {
//           name: spendingByDoctor[0].doctorName,
//           amount: spendingByDoctor[0].totalSpent.toFixed(2),
//           visits: Number(spendingByDoctor[0].visitCount)
//         } : null,
//         doctorSpending: spendingByDoctor.map(d => ({
//           doctorId: d.doctorId,
//           doctorName: d.doctorName,
//           totalSpent: d.totalSpent.toFixed(2),
//           totalPaid: d.totalPaid.toFixed(2),
//           visitCount: Number(d.visitCount),
//           lastVisit: d.lastVisit.toISOString().split('T')[0]
//         })),
//         status: "Success"
//       });
//     } catch (error) {
//       console.error('Widget Spending Summary Error:', error);
//       res.status(500).json({
//         error: error instanceof Error ? error.message : 'Failed to fetch spending summary',
//         msg: 'Failed'
//       });
//     }
//   }
// );

// // 7. Widget-Optimized Doctor Revenue Summary
// router.post(
//   '/widget/doctor-revenue-summary',
//   requireAuth,
//   requireRole('Doctor', 'ITAdmin', 'Cashier'),
//   async (req: AuthRequest, res: Response, next: NextFunction) => {
//     try {
//       const { doctorId, startDate, endDate, groupBy = 'month' } = req.body;

//       if (!doctorId) {
//         return res.status(400).json({
//           error: 'Doctor ID is required',
//           msg: 'Failed'
//         });
//       }

//       let groupByClause: Prisma.Sql;
//       if (groupBy === 'month') {
//         groupByClause = Prisma.sql`date_trunc('month', i."createdAt")`;
//       } else if (groupBy === 'week') {
//         groupByClause = Prisma.sql`date_trunc('week', i."createdAt")`;
//       } else {
//         groupByClause = Prisma.sql`date_trunc('day', i."createdAt")`;
//       }

//       const revenueData = await prisma.$queryRaw<Array<{
//         period: Date;
//         totalRevenue: number;
//         totalPaid: number;
//         invoiceCount: number;
//         patientCount: number;
//       }>>`
//         SELECT
//           ${groupByClause} as period,
//           COALESCE(SUM(i."grandTotal"), 0) as "totalRevenue",
//           COALESCE(SUM(i."amountPaid"), 0) as "totalPaid",
//           COUNT(i."invoiceId") as "invoiceCount",
//           COUNT(DISTINCT i."patientId") as "patientCount"
//         FROM "Invoice" i
//         JOIN "Visit" v ON i."visitId" = v."visitId"
//         WHERE v."doctorId" = ${doctorId}::uuid
//           AND i.status != 'VOID'
//           ${startDate ? Prisma.sql`AND i."createdAt" >= ${new Date(startDate as string)}` : Prisma.empty}
//           ${endDate ? Prisma.sql`AND i."createdAt" <= ${new Date(endDate as string)}` : Prisma.empty}
//         GROUP BY ${groupByClause}
//         ORDER BY period ASC
//       `;

//       const doctor = await prisma.doctor.findUnique({
//         where: { doctorId },
//         select: { name: true, department: true }
//       });

//       const totalRevenue = revenueData.reduce((sum, item) => sum + item.totalRevenue, 0);
//       const totalPaid = revenueData.reduce((sum, item) => sum + item.totalPaid, 0);
//       const totalInvoices = revenueData.reduce((sum, item) => sum + Number(item.invoiceCount), 0);
//       const totalPatients = revenueData.reduce((sum, item) => sum + Number(item.patientCount), 0);

//       res.json({
//         doctorId,
//         doctorName: doctor?.name,
//         department: doctor?.department,
//         period: { startDate, endDate, groupBy },
//         totals: {
//           totalRevenue: totalRevenue.toFixed(2),
//           totalPaid: totalPaid.toFixed(2),
//           totalInvoices,
//           totalPatients
//         },
//         revenueByPeriod: revenueData.map(item => ({
//           period: item.period.toISOString().split('T')[0],
//           revenue: item.totalRevenue.toFixed(2),
//           paid: item.totalPaid.toFixed(2),
//           invoices: Number(item.invoiceCount),
//           patients: Number(item.patientCount)
//         })),
//         status: "Success"
//       });
//     } catch (error) {
//       console.error('Widget Doctor Revenue Error:', error);
//       res.status(500).json({
//         error: error instanceof Error ? error.message : 'Failed to fetch doctor revenue',
//         msg: 'Failed'
//       });
//     }
//   }
// );

// 8. Widget-Optimized Quick Patient Stats
// router.post(
//   '/widget/patient-stats',
//   requireAuth,
//   async (req: AuthRequest, res: Response, next: NextFunction) => {
//     try {
//       const { patientId } = req.body;
//       const user = req.user!;

//       if (!patientId) {
//         return res.status(400).json({
//           error: 'Patient ID is required',
//           msg: 'Failed'
//         });
//       }

//       // If user is a patient, they can only view their own data
//       if (user.role === 'Patient') {
//         if (!user.patientId || patientId !== user.patientId) {
//           return res.status(403).json({
//             error: 'Access denied',
//             msg: 'Failed'
//           });
//         }
//       }

//       const [appointments, invoices, medications, visits] = await Promise.all([
//         prisma.appointment.count({ where: { patientId } }),
//         prisma.invoice.aggregate({
//           where: { patientId, status: { not: 'VOID' } },
//           _sum: { grandTotal: true, amountPaid: true },
//           _count: { invoiceId: true }
//         }),
//         prisma.medicationOrder.count({ where: { patientId } }),
//         prisma.visit.count({ where: { patientId } })
//       ]);

//       res.json({
//         patientId,
//         totalAppointments: appointments,
//         totalVisits: visits,
//         totalInvoices: invoices._count.invoiceId,
//         totalSpent: Number(invoices._sum.grandTotal || 0).toFixed(2),
//         totalPaid: Number(invoices._sum.amountPaid || 0).toFixed(2),
//         totalMedications: medications,
//         status: "Success"
//       });
//     } catch (error) {
//       console.error('Widget Patient Stats Error:', error);
//       res.status(500).json({
//         error: error instanceof Error ? error.message : 'Failed to fetch patient stats',
//         msg: 'Failed'
//       });
//     }
//   }
// );

// 9. Patient Profile Agent API - Simple Version
router.post(
  "/patient-profile",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;
      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      // Get basic patient data only
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: {
          patientId: true,
          name: true,
          dob: true,
          gender: true,
          contact: true,
          insurance: true,
          drugAllergies: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!patient) {
        return res.status(404).json({
          error: "Patient not found",
          msg: "Failed",
        });
      }

      // Calculate age
      const age =
        new Date().getFullYear() - new Date(patient.dob).getFullYear();

      // Simple response with basic patient data only
      const result = {
        // 🧑‍⚕️ Basic Patient Information
        patientId: patient.patientId,
        patientName: patient.name,
        dateOfBirth: patient.dob.toISOString().split("T")[0],
        age: age,
        gender: patient.gender,
        contact: patient.contact,
        insurance: patient.insurance || "Not provided",
        drugAllergies: patient.drugAllergies || "No known allergies",
        memberSince: patient.createdAt.toISOString().split("T")[0],
        lastUpdated: patient.updatedAt.toISOString().split("T")[0],
        status: "Success",
      };

      res.json(result);
    } catch (error) {
      console.error("Patient Profile Agent Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch patient profile",
        msg: "Failed",
      });
    }
  }
);

// Helper function to format time from minutes to HH:MM
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}`;
}

export default router;
