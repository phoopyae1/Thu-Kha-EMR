import { Router, type Response, type NextFunction } from "express";
import { requirePatientAuth, requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { assertCreatable } from "../services/appointmentService.js";
import { toDateOnly } from "../utils/time.js";

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

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  return value?.trim() || null;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token");
  }
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

// Middleware to allow either Doctor or Patient authentication
function requireDoctorOrPatientAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const rawHeader = req.get("authorization");
  const rawToken = parseBearerToken(rawHeader);
  if (!rawToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(rawToken);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isPatientToken = typeof payload.patientId === "string";

  if (isPatientToken) {
    // Patient portal token
    return requirePatientAuth(req, res, next);
  }

  // Default to doctor/staff token
  return requireAuth(req, res, () => {
    if (!req.user || req.user.role !== "Doctor") {
      return res.status(403).json({ error: "Doctor access required", msg: "Failed" });
    }
    return next();
  });
}

// 1. Medical History Agent API - Now supports both Doctor and Patient authentication
router.post(
  "/medical-history",
  requireDoctorOrPatientAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId, patientName, doctorId } = req.body;
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({ error: "Unauthorized", msg: "Failed" });
      }
      
      // Determine which patientId to use
      let targetPatientId: string | null = null;
      
      if (patientId) {
        // If patientId is provided in request body
        if (user.role === "Patient" && user.patientId !== patientId) {
          // Patients can only access their own medical history
          return res.status(403).json({
            error: "Patients can only access their own medical history",
            msg: "Failed",
          });
        }
        // Doctors can query any patient, patients can query themselves
        targetPatientId = patientId;
      } else if (patientName && user.role === "Doctor") {
        // If patientName is provided and user is a doctor, search for patient by name
        if (!patientName.trim()) {
          return res.status(400).json({
            error: "patientName cannot be empty",
            msg: "Failed",
          });
        }
        
        // Search for patient by name (case-insensitive, partial match)
        const patients = await prisma.patient.findMany({
          where: {
            name: {
              contains: patientName.trim(),
              mode: 'insensitive',
            },
          },
          select: {
            patientId: true,
            name: true,
          },
          take: 10,
          orderBy: {
            name: 'asc',
          },
        });
        
        if (patients.length === 0) {
          return res.status(404).json({
            error: `No patient found with name matching "${patientName}"`,
            msg: "Failed",
          });
        }
        
        if (patients.length > 1) {
          // Multiple patients found - return list for doctor to choose
          return res.status(400).json({
            error: "Multiple patients found with that name. Please use patientId instead.",
            msg: "Failed",
            matches: patients.map(p => ({
              patientId: p.patientId,
              name: p.name,
            })),
          });
        }
        
        // Single patient found
        targetPatientId = patients[0].patientId;
      } else if (user.role === "Patient" && user.patientId) {
        // Patient authenticated but no patientId in body - use their own
        targetPatientId = user.patientId;
      } else if (doctorId && user.role === "Doctor") {
        // If doctorId is provided, validate it matches authenticated doctor
        if (user.doctorId !== doctorId) {
          return res.status(403).json({
            error: "Doctor ID does not match authenticated doctor",
            msg: "Failed",
          });
        }
        // Doctor provided their ID but no patientId or patientName - still need one to query
        return res.status(400).json({
          error: "patientId or patientName is required to fetch medical history",
          msg: "Failed",
        });
      } else {
        return res.status(400).json({
          error: "patientId is required (or patientName for doctors)",
          msg: "Failed",
        });
      }
      
      if (!targetPatientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }
      
      // Get patient data with comprehensive information
      const patient = await prisma.patient.findUnique({
        where: { patientId: targetPatientId },
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
          where: { patientId: targetPatientId },
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
          where: { visit: { patientId: targetPatientId } },
          include: {
            visit: { include: { doctor: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.visit.findMany({
          where: { patientId: targetPatientId },
          include: {
            doctor: true,
          },
          orderBy: { visitDate: "desc" },
          take: 15,
        }),
        prisma.labResult.findMany({
          where: { patientId: targetPatientId },
          orderBy: { resultedAt: "desc" },
          take: 15,
        }),
        prisma.immunizationRecord.findMany({
          where: { patientId: targetPatientId },
          orderBy: { immunizationId: "desc" },
          take: 10,
        }),
        prisma.vitals.findMany({
          where: { patientId: targetPatientId },
          orderBy: { recordedAt: "desc" },
          take: 10,
        }),
        // Get patient's drug allergies from their profile
        Promise.resolve([]), // We'll use patient.drugAllergies instead
        prisma.diagnosis.findMany({
          where: { 
            visit: {
              patientId: targetPatientId,
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
          where: { patientId: targetPatientId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.observation.findMany({
          where: { patientId: targetPatientId },
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

      // Calculate current time in minutes from midnight
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      // Fetch all appointments from today onwards (we'll filter by time in code)
      const allAppointments = await prisma.appointment.findMany({
          where: {
            patientId,
            date: { gte: today },
          },
          include: {
            doctor: true,
          },
        orderBy: [
          { date: "asc" },
          { startTimeMin: "asc" },
        ],
      });

      // Fetch past appointments (before today)
      const pastAppointments = await prisma.appointment.findMany({
          where: {
            patientId,
            date: { lt: today },
          },
          include: {
            doctor: true,
          },
          orderBy: { date: "desc" },
      });

      // Filter upcoming appointments: future dates OR today with time after now
      const upcoming = allAppointments.filter((apt) => {
        const appointmentDate = new Date(apt.date);
        const isToday = appointmentDate.getTime() === today.getTime();
        
        if (isToday) {
          // For today's appointments, check if time is after current time
          return apt.startTimeMin > currentTimeMinutes;
        } else {
          // Future dates are always upcoming
          return true;
        }
      });

      // Past appointments include: appointments before today OR today's appointments that have passed
      const pastToday = allAppointments.filter((apt) => {
        const appointmentDate = new Date(apt.date);
        const isToday = appointmentDate.getTime() === today.getTime();
        
        if (isToday) {
          // For today's appointments, check if time is before or equal to current time
          return apt.startTimeMin <= currentTimeMinutes;
        } else {
          // Future dates are not past
          return false;
        }
      });

      // Combine past appointments
      const past = [...pastAppointments, ...pastToday].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) {
          return dateB - dateA; // Descending order for dates
        }
        return b.startTimeMin - a.startTimeMin; // Descending order for times
      });

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

      // Convert date to Date object and normalize to date-only
      const appointmentDate = toDateOnly(date);

      // Check if time slot is available (availability, blackouts, overlaps)
      try {
        await assertCreatable(prisma as any, {
          patientId,
          doctorId: doctor.doctorId,
          department,
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

      // Create the appointment
      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          doctorId: doctor.doctorId,
          department,
          date: appointmentDate,
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

// Medication Overview API - Combines medication orders and prescriptions
router.post(
  "/medication-overview",
  requirePatientAuth,
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId, startDate, endDate } = req.body;
      
      if (!patientId) {
        return res.status(400).json({
          error: "Patient ID is required",
          msg: "Failed",
        });
      }

      // Build date filter
      const dateFilter: any = {};
      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt.gte = new Date(startDate);
        if (endDate) dateFilter.createdAt.lte = new Date(endDate);
      }

      // Get medication orders
      const medicationOrders = await prisma.medicationOrder.findMany({
        where: {
          patientId,
          ...dateFilter,
        },
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

      // Get prescriptions (prescribed by doctors)
      const prescriptions = await prisma.prescription.findMany({
        where: {
          patientId,
          ...dateFilter,
        },
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
          doctor: true,
          patient: {
            select: {
              patientId: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Helper function to map status to readable text
      const getOrderStatusText = (status: string): string => {
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

      const getPrescriptionStatusText = (status: string): string => {
        const statusMap: Record<string, string> = {
          PENDING: "Pending",
          PARTIAL: "Partially Dispensed",
          DISPENSED: "Dispensed",
          CANCELLED: "Cancelled",
        };
        return statusMap[status] || status;
      };

      // Format medication orders
      const formattedOrders = medicationOrders.map((order: any) => {
        const firstPrescriptionItem = order.prescription?.items?.[0];
        const drug = firstPrescriptionItem?.drug;
        const drugName = order.drugName || drug?.name || "Unknown medication";
        const dosage = order.dosage || firstPrescriptionItem?.dose || "";
        const medicineName = dosage ? `${drugName} ${dosage}`.trim() : drugName;

        return {
          type: "medication_order",
          orderId: order.orderId,
          medicine: medicineName,
          drugName: drugName,
          dosage: order.dosage || firstPrescriptionItem?.dose || null,
          instructions: order.instructions || firstPrescriptionItem?.notes || null,
          quantity: order.quantity || firstPrescriptionItem?.quantityPrescribed || null,
          frequency: firstPrescriptionItem?.frequency || null,
          duration: firstPrescriptionItem?.durationDays ? `${firstPrescriptionItem.durationDays} days` : null,
          status: getOrderStatusText(order.status || "PENDING"),
          statusCode: order.status,
          createdAt: order.createdAt ? order.createdAt.toISOString().split("T")[0] : null,
          approvedAt: order.approvedAt ? order.approvedAt.toISOString().split("T")[0] : null,
          approvedBy: order.approvedBy?.name || null,
          prescriptionId: order.prescription?.prescriptionId || null,
          visitId: order.prescription?.visit?.visitId || null,
          visitDate: order.prescription?.visit?.visitDate 
            ? new Date(order.prescription.visit.visitDate).toISOString().split("T")[0] 
            : null,
          doctorName: order.prescription?.visit?.doctor?.name || null,
          doctorId: order.prescription?.visit?.doctor?.doctorId || null,
          department: order.prescription?.visit?.department || null,
        };
      });

      // Format prescriptions
      const formattedPrescriptions = prescriptions.flatMap((prescription: any) => {
        return prescription.items.map((item: any) => {
          const drug = item.drug;
          const medicineName = `${drug.name} ${drug.strength}`.trim();
          
          return {
            type: "prescription",
            prescriptionId: prescription.prescriptionId,
            prescriptionItemId: item.itemId,
            medicine: medicineName,
            drugName: drug.name,
            drugStrength: drug.strength,
            drugForm: drug.form,
            dosage: item.dose,
            route: item.route,
            frequency: item.frequency,
            duration: `${item.durationDays} days`,
            quantity: item.quantityPrescribed,
            prn: item.prn,
            allowGeneric: item.allowGeneric,
            notes: item.notes || prescription.notes || null,
            status: getPrescriptionStatusText(prescription.status),
            statusCode: prescription.status,
            createdAt: prescription.createdAt ? prescription.createdAt.toISOString().split("T")[0] : null,
            visitId: prescription.visitId,
            visitDate: prescription.visit?.visitDate 
              ? new Date(prescription.visit.visitDate).toISOString().split("T")[0] 
              : null,
            doctorName: prescription.doctor?.name || prescription.visit?.doctor?.name || null,
            doctorId: prescription.doctorId,
            department: prescription.visit?.department || null,
          };
        });
      });

      // Combine and sort by date (most recent first)
      const allMedications = [...formattedOrders, ...formattedPrescriptions].sort((a, b) => {
        const dateA = a.createdAt || "";
        const dateB = b.createdAt || "";
        return dateB.localeCompare(dateA);
      });

      // Build flat response with numbered fields
      const result: any = {
        status: "Success",
        currency: "SGD",
        currencySymbol: "$",
        totalMedications: allMedications.length,
        totalMedicationOrders: formattedOrders.length,
        totalPrescriptions: prescriptions.length,
        totalPrescriptionItems: formattedPrescriptions.length,
      };

      // Add numbered medication fields
      allMedications.forEach((med, index) => {
        const prefix = `medication${index + 1}`;
        result[`${prefix}Type`] = med.type;
        result[`${prefix}Medicine`] = med.medicine;
        result[`${prefix}DrugName`] = med.drugName;
        result[`${prefix}Dosage`] = med.dosage;
        result[`${prefix}Instructions`] = med.instructions || med.notes;
        result[`${prefix}Quantity`] = med.quantity;
        result[`${prefix}Frequency`] = med.frequency;
        result[`${prefix}Duration`] = med.duration;
        result[`${prefix}Status`] = med.status;
        result[`${prefix}StatusCode`] = med.statusCode;
        result[`${prefix}Date`] = med.createdAt;
        result[`${prefix}DoctorName`] = med.doctorName;
        result[`${prefix}DoctorId`] = med.doctorId;
        result[`${prefix}Department`] = med.department;
        result[`${prefix}VisitId`] = med.visitId;
        result[`${prefix}VisitDate`] = med.visitDate;

        if (med.type === "medication_order") {
          result[`${prefix}OrderId`] = med.orderId;
          result[`${prefix}ApprovedAt`] = med.approvedAt;
          result[`${prefix}ApprovedBy`] = med.approvedBy;
          result[`${prefix}PrescriptionId`] = med.prescriptionId;
        } else if (med.type === "prescription") {
          result[`${prefix}PrescriptionId`] = med.prescriptionId;
          result[`${prefix}PrescriptionItemId`] = med.prescriptionItemId;
          result[`${prefix}DrugStrength`] = med.drugStrength;
          result[`${prefix}DrugForm`] = med.drugForm;
          result[`${prefix}Route`] = med.route;
          result[`${prefix}Prn`] = med.prn;
          result[`${prefix}AllowGeneric`] = med.allowGeneric;
        }
      });

      // Add summary by type
      const ordersByStatus = formattedOrders.reduce((acc: any, order: any) => {
        acc[order.statusCode] = (acc[order.statusCode] || 0) + 1;
        return acc;
      }, {});

      const prescriptionsByStatus = formattedPrescriptions.reduce((acc: any, pres: any) => {
        acc[pres.statusCode] = (acc[pres.statusCode] || 0) + 1;
        return acc;
      }, {});

      result.medicationOrdersByStatus = ordersByStatus;
      result.prescriptionsByStatus = prescriptionsByStatus;

      // Get unique doctors
      const uniqueDoctors = new Map<string, { doctorId: string; doctorName: string; department: string | null }>();
      allMedications.forEach((med) => {
        if (med.doctorId && med.doctorName) {
          if (!uniqueDoctors.has(med.doctorId)) {
            uniqueDoctors.set(med.doctorId, {
              doctorId: med.doctorId,
              doctorName: med.doctorName,
              department: med.department,
            });
          }
        }
      });

      result.totalDoctors = uniqueDoctors.size;
      Array.from(uniqueDoctors.values()).forEach((doctor, index) => {
        const prefix = `doctor${index + 1}`;
        result[`${prefix}Id`] = doctor.doctorId;
        result[`${prefix}Name`] = doctor.doctorName;
        result[`${prefix}Department`] = doctor.department;
      });

      // Get unique medicines
      const uniqueMedicines = [...new Set(allMedications.map((m) => m.medicine).filter(Boolean))];
      result.uniqueMedicines = uniqueMedicines;
      result.uniqueMedicinesCount = uniqueMedicines.length;

      // Nested structured breakdown
      result.detailBreakdown = {
        medicationOrders: formattedOrders,
        prescriptions: formattedPrescriptions,
        allMedications: allMedications,
        doctors: Array.from(uniqueDoctors.values()),
        medicines: uniqueMedicines,
      };

      res.json(result);
    } catch (error) {
      console.error("Medication Overview Error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch medication overview",
        msg: "Failed",
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

      // Get all invoices with items for visit-by-visit breakdown
      const allInvoicesWithItems = await prisma.invoice.findMany({
        where: whereClause,
        select: {
          invoiceId: true,
          invoiceNo: true,
          status: true,
          grandTotal: true,
          amountPaid: true,
          amountDue: true,
          createdAt: true,
          visitId: true,
          Visit: {
            select: {
              visitId: true,
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
          items: {
            select: {
              itemId: true,
              sourceType: true,
              description: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Get recent invoices with minimal data (for backward compatibility)
      const recentInvoices = allInvoicesWithItems.slice(0, 10);

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

      // DETAILED BREAKDOWNS - Get spending by item source type
      const spendingBySourceType = await prisma.$queryRaw<
        Array<{
          sourceType: string;
          totalSpent: number;
          itemCount: number;
        }>
      >`
        SELECT 
          ii."sourceType",
          COALESCE(SUM(ii."lineTotal"), 0) as "totalSpent",
          COUNT(ii."itemId") as "itemCount"
        FROM "InvoiceItem" ii
        JOIN "Invoice" i ON ii."invoiceId" = i."invoiceId"
        WHERE i."patientId" = ${patientId}::uuid
          AND i.status != 'VOID'
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
        GROUP BY ii."sourceType"
        ORDER BY "totalSpent" DESC
      `;

      // Get spending by payment method
      const spendingByPaymentMethod = await prisma.$queryRaw<
        Array<{
          method: string;
          totalPaid: number;
          paymentCount: number;
        }>
      >`
        SELECT 
          p.method,
          COALESCE(SUM(p.amount), 0) as "totalPaid",
          COUNT(p."paymentId") as "paymentCount"
        FROM "Payment" p
        JOIN "Invoice" i ON p."invoiceId" = i."invoiceId"
        WHERE i."patientId" = ${patientId}::uuid
          ${
            startDate
              ? Prisma.sql`AND p."paidAt" >= ${new Date(startDate as string)}`
              : Prisma.empty
          }
          ${
            endDate
              ? Prisma.sql`AND p."paidAt" <= ${new Date(endDate as string)}`
              : Prisma.empty
          }
        GROUP BY p.method
        ORDER BY "totalPaid" DESC
      `;

      // Get breakdown by invoice status
      const breakdownByStatus = await prisma.$queryRaw<
        Array<{
          status: string;
          count: number;
          totalAmount: number;
        }>
      >`
        SELECT 
          i.status,
          COUNT(i."invoiceId") as "count",
          COALESCE(SUM(i."grandTotal"), 0) as "totalAmount"
        FROM "Invoice" i
        WHERE i."patientId" = ${patientId}::uuid
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
        GROUP BY i.status
        ORDER BY "totalAmount" DESC
      `;

      // Get monthly spending breakdown
      const monthlyBreakdown = await prisma.$queryRaw<
        Array<{
          year: number;
          month: number;
          monthName: string;
          totalSpent: number;
          totalPaid: number;
          invoiceCount: number;
        }>
      >`
        SELECT 
          EXTRACT(YEAR FROM i."createdAt")::integer as "year",
          EXTRACT(MONTH FROM i."createdAt")::integer as "month",
          TO_CHAR(i."createdAt", 'YYYY-MM') as "monthName",
          COALESCE(SUM(i."grandTotal"), 0) as "totalSpent",
          COALESCE(SUM(i."amountPaid"), 0) as "totalPaid",
          COUNT(DISTINCT i."invoiceId") as "invoiceCount"
        FROM "Invoice" i
        WHERE i."patientId" = ${patientId}::uuid
          AND i.status != 'VOID'
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
        GROUP BY EXTRACT(YEAR FROM i."createdAt"), EXTRACT(MONTH FROM i."createdAt"), TO_CHAR(i."createdAt", 'YYYY-MM')
        ORDER BY "year" DESC, "month" DESC
        LIMIT 12
      `;

      // Get top invoice items by spending
      const topItems = await prisma.$queryRaw<
        Array<{
          description: string;
          sourceType: string;
          totalSpent: number;
          totalQuantity: number;
          avgUnitPrice: number;
        }>
      >`
        SELECT 
          ii.description,
          ii."sourceType",
          COALESCE(SUM(ii."lineTotal"), 0) as "totalSpent",
          SUM(ii.quantity)::integer as "totalQuantity",
          COALESCE(AVG(ii."unitPrice"), 0) as "avgUnitPrice"
        FROM "InvoiceItem" ii
        JOIN "Invoice" i ON ii."invoiceId" = i."invoiceId"
        WHERE i."patientId" = ${patientId}::uuid
          AND i.status != 'VOID'
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
        GROUP BY ii.description, ii."sourceType"
        ORDER BY "totalSpent" DESC
        LIMIT 10
      `;

      // Get all payments with invoice details
      const allPayments = await prisma.payment.findMany({
        where: { 
          Invoice: {
            patientId: patientId,
            ...(startDate || endDate
              ? {
                  createdAt: {
                    ...(startDate ? { gte: new Date(startDate as string) } : {}),
                    ...(endDate ? { lte: new Date(endDate as string) } : {}),
                  },
                }
              : {}),
          },
        },
        select: {
          paymentId: true,
          amount: true,
          paidAt: true,
          method: true,
          referenceNo: true,
          note: true,
          Invoice: {
            select: {
              invoiceNo: true,
              grandTotal: true,
            },
          },
        },
        orderBy: { paidAt: "desc" },
      });

      // Calculate totals
      const totalSpent = Number(overallSummary._sum.grandTotal || 0);
      const totalPaid = Number(overallSummary._sum.amountPaid || 0);
      const totalDue = Number(overallSummary._sum.amountDue || 0);
      const totalInvoices = overallSummary._count.invoiceId;

      // Currency formatting helper - format as USD to show $ sign, but currency is SGD
      const formatCurrency = (amount: number): string => {
        return new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(amount);
      };

      // FLAT RESPONSE - Numbered flat keys (no arrays, no nested objects)
      const result: any = {
        // Currency
        currency: "SGD",
        currencySymbol: "$",
        
        // Core Summary
        totalSpent: totalSpent.toFixed(2),
        totalSpentFormatted: formatCurrency(totalSpent),
        totalPaid: totalPaid.toFixed(2),
        totalPaidFormatted: formatCurrency(totalPaid),
        totalDue: totalDue.toFixed(2),
        totalDueFormatted: formatCurrency(totalDue),
        
        // Top Doctor (flat fields for quick answers)
        topDoctorName:
          spendingByDoctor.length > 0 ? spendingByDoctor[0].doctorName : null,
        topDoctorSpent:
          spendingByDoctor.length > 0
            ? spendingByDoctor[0].totalSpent.toFixed(2)
            : "0.00",
        topDoctorSpentFormatted:
          spendingByDoctor.length > 0
            ? formatCurrency(spendingByDoctor[0].totalSpent)
            : "$0.00",
        topDoctorPaid:
          spendingByDoctor.length > 0
            ? spendingByDoctor[0].totalPaid.toFixed(2)
            : "0.00",
        topDoctorPaidFormatted:
          spendingByDoctor.length > 0
            ? formatCurrency(spendingByDoctor[0].totalPaid)
            : "$0.00",
        topDoctorVisits:
          spendingByDoctor.length > 0
            ? Number(spendingByDoctor[0].visitCount)
            : 0,
        
        // Recent Payment (flat fields)
        lastPaymentAmount:
          recentPayments.length > 0
            ? Number(recentPayments[0].amount).toFixed(2)
            : "0.00",
        lastPaymentAmountFormatted:
          recentPayments.length > 0
            ? formatCurrency(Number(recentPayments[0].amount))
            : "$0.00",
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
        result[`${prefix}SpentFormatted`] = formatCurrency(doctor.totalSpent);
        result[`${prefix}Paid`] = doctor.totalPaid.toFixed(2);
        result[`${prefix}PaidFormatted`] = formatCurrency(doctor.totalPaid);
        result[`${prefix}Visits`] = Number(doctor.visitCount);
      });

      // Add numbered recent invoice fields (recentInvoice1, recentInvoice2, etc.)
      allInvoicesWithItems.slice(0, 3).forEach((invoice, index) => {
        const prefix = `recentInvoice${index + 1}`;
        const invoiceAmount = Number(invoice.grandTotal);
        result[`${prefix}Number`] = invoice.invoiceNo;
        result[`${prefix}Amount`] = invoiceAmount.toFixed(2);
        result[`${prefix}AmountFormatted`] = formatCurrency(invoiceAmount);
        result[`${prefix}Status`] = invoice.status;
        result[`${prefix}Doctor`] = invoice.Visit?.doctor?.name || "Unknown Doctor";
        result[`${prefix}Date`] = invoice.createdAt.toISOString().split("T")[0];
      });

      // DETAILED BREAKDOWN - Source Type Spending (flat format)
      result.sourceTypeCount = spendingBySourceType.length;
      spendingBySourceType.forEach((source, index) => {
        const prefix = `sourceType${index + 1}`;
        result[`${prefix}Type`] = source.sourceType;
        result[`${prefix}Spent`] = source.totalSpent.toFixed(2);
        result[`${prefix}SpentFormatted`] = formatCurrency(source.totalSpent);
        result[`${prefix}ItemCount`] = Number(source.itemCount);
      });

      // Payment Method Breakdown (flat format)
      result.paymentMethodCount = spendingByPaymentMethod.length;
      spendingByPaymentMethod.forEach((method, index) => {
        const prefix = `paymentMethod${index + 1}`;
        result[`${prefix}Method`] = method.method;
        result[`${prefix}Total`] = method.totalPaid.toFixed(2);
        result[`${prefix}TotalFormatted`] = formatCurrency(method.totalPaid);
        result[`${prefix}Count`] = Number(method.paymentCount);
      });

      // Status Breakdown (flat format)
      result.statusBreakdownCount = breakdownByStatus.length;
      breakdownByStatus.forEach((status, index) => {
        const prefix = `status${index + 1}`;
        result[`${prefix}Status`] = status.status;
        result[`${prefix}Count`] = Number(status.count);
        result[`${prefix}Total`] = status.totalAmount.toFixed(2);
        result[`${prefix}TotalFormatted`] = formatCurrency(status.totalAmount);
      });

      // Monthly Breakdown (flat format)
      result.monthlyBreakdownCount = monthlyBreakdown.length;
      monthlyBreakdown.forEach((month, index) => {
        const prefix = `month${index + 1}`;
        result[`${prefix}Year`] = Number(month.year);
        result[`${prefix}Month`] = Number(month.month);
        result[`${prefix}MonthName`] = month.monthName;
        result[`${prefix}Spent`] = month.totalSpent.toFixed(2);
        result[`${prefix}SpentFormatted`] = formatCurrency(month.totalSpent);
        result[`${prefix}Paid`] = month.totalPaid.toFixed(2);
        result[`${prefix}PaidFormatted`] = formatCurrency(month.totalPaid);
        result[`${prefix}InvoiceCount`] = Number(month.invoiceCount);
      });

      // Top Items Breakdown (flat format)
      result.topItemsCount = topItems.length;
      topItems.forEach((item, index) => {
        const prefix = `topItem${index + 1}`;
        result[`${prefix}Description`] = item.description;
        result[`${prefix}SourceType`] = item.sourceType;
        result[`${prefix}TotalSpent`] = item.totalSpent.toFixed(2);
        result[`${prefix}TotalSpentFormatted`] = formatCurrency(item.totalSpent);
        result[`${prefix}Quantity`] = Number(item.totalQuantity);
        result[`${prefix}AvgUnitPrice`] = item.avgUnitPrice.toFixed(2);
        result[`${prefix}AvgUnitPriceFormatted`] = formatCurrency(item.avgUnitPrice);
      });

      // All Payments Breakdown (flat format)
      result.allPaymentsCount = allPayments.length;
      allPayments.slice(0, 20).forEach((payment, index) => {
        const prefix = `payment${index + 1}`;
        result[`${prefix}Amount`] = Number(payment.amount).toFixed(2);
        result[`${prefix}AmountFormatted`] = formatCurrency(Number(payment.amount));
        result[`${prefix}Method`] = payment.method;
        result[`${prefix}Date`] = payment.paidAt.toISOString().split("T")[0];
        result[`${prefix}InvoiceNo`] = payment.Invoice.invoiceNo;
        result[`${prefix}ReferenceNo`] = payment.referenceNo || null;
        result[`${prefix}Note`] = payment.note || null;
      });

      // VISIT-BY-VISIT BREAKDOWN - One by one with line breaks
      // Group invoices by visit
      const visitsMap = new Map<string, typeof allInvoicesWithItems>();
      allInvoicesWithItems.forEach((invoice) => {
        const visitId = invoice.visitId || 'no-visit';
        if (!visitsMap.has(visitId)) {
          visitsMap.set(visitId, []);
        }
        visitsMap.get(visitId)!.push(invoice);
      });

      // Sort visits by date (most recent first)
      const sortedVisits = Array.from(visitsMap.entries()).sort((a, b) => {
        const dateA = a[1][0]?.Visit?.visitDate || a[1][0]?.createdAt || new Date(0);
        const dateB = b[1][0]?.Visit?.visitDate || b[1][0]?.createdAt || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      result.visitCount = sortedVisits.length;
      
      // Create visit-by-visit breakdown with line breaks
      sortedVisits.forEach(([visitId, invoices], visitIndex) => {
        const visit = invoices[0]?.Visit;
        const visitDate = visit?.visitDate || invoices[0]?.createdAt;
        const visitDateStr = visitDate ? visitDate.toISOString().split("T")[0] : null;
        const doctorName = visit?.doctor?.name || "Unknown Doctor";
        const department = visit?.department || "Unknown Department";
        
        const prefix = `visit${visitIndex + 1}`;
        
        // Visit header information
        result[`${prefix}Date`] = visitDateStr;
        result[`${prefix}DoctorName`] = doctorName;
        result[`${prefix}Department`] = department;
        result[`${prefix}VisitId`] = visitId !== 'no-visit' ? visitId : null;
        
        // Calculate totals for this visit
        let visitTotal = 0;
        let visitPaid = 0;
        let visitDue = 0;
        const visitItems: Array<{
          sourceType: string;
          description: string;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
        }> = [];
        
        invoices.forEach((invoice) => {
          visitTotal += Number(invoice.grandTotal);
          visitPaid += Number(invoice.amountPaid);
          visitDue += Number(invoice.amountDue);
          
          invoice.items.forEach((item) => {
            visitItems.push({
              sourceType: item.sourceType,
              description: item.description,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              lineTotal: Number(item.lineTotal),
            });
          });
        });
        
        result[`${prefix}Total`] = visitTotal.toFixed(2);
        result[`${prefix}TotalFormatted`] = formatCurrency(visitTotal);
        result[`${prefix}Paid`] = visitPaid.toFixed(2);
        result[`${prefix}PaidFormatted`] = formatCurrency(visitPaid);
        result[`${prefix}Due`] = visitDue.toFixed(2);
        result[`${prefix}DueFormatted`] = formatCurrency(visitDue);
        result[`${prefix}ItemCount`] = visitItems.length;
        result[`${prefix}InvoiceCount`] = invoices.length;
        
        // Add line break separator (using newline character)
        result[`${prefix}Separator`] = "\n---\n";
        
        // Add each item in this visit
        visitItems.forEach((item, itemIndex) => {
          const itemPrefix = `${prefix}Item${itemIndex + 1}`;
          result[`${itemPrefix}SourceType`] = item.sourceType;
          result[`${itemPrefix}Description`] = item.description;
          result[`${itemPrefix}Quantity`] = item.quantity;
          result[`${itemPrefix}UnitPrice`] = item.unitPrice.toFixed(2);
          result[`${itemPrefix}UnitPriceFormatted`] = formatCurrency(item.unitPrice);
          result[`${itemPrefix}LineTotal`] = item.lineTotal.toFixed(2);
          result[`${itemPrefix}LineTotalFormatted`] = formatCurrency(item.lineTotal);
        });
        
        // Create a formatted text summary for this visit (with line breaks)
        const visitSummaryLines: string[] = [];
        visitSummaryLines.push(`Visit ${visitIndex + 1}: ${visitDateStr || 'Date Unknown'}`);
        visitSummaryLines.push(`Doctor: ${doctorName} (${department})`);
        visitSummaryLines.push(`Total: ${formatCurrency(visitTotal)} | Paid: ${formatCurrency(visitPaid)} | Due: ${formatCurrency(visitDue)}`);
        visitSummaryLines.push("");
        visitSummaryLines.push("Items:");
        
        // Group items by source type for better readability
        const itemsBySourceType = new Map<string, typeof visitItems>();
        visitItems.forEach((item) => {
          if (!itemsBySourceType.has(item.sourceType)) {
            itemsBySourceType.set(item.sourceType, []);
          }
          itemsBySourceType.get(item.sourceType)!.push(item);
        });
        
        // Add items grouped by source type
        itemsBySourceType.forEach((items, sourceType) => {
          visitSummaryLines.push(`  ${sourceType}:`);
          items.forEach((item) => {
            visitSummaryLines.push(
              `    - ${item.description} (Qty: ${item.quantity}) @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`
            );
          });
        });
        
        visitSummaryLines.push("");
        result[`${prefix}Summary`] = visitSummaryLines.join("\n");
      });
      
      // Create a complete formatted text with all visits (one by one with line breaks)
      const allVisitsSummary: string[] = [];
      allVisitsSummary.push("BILLING SUMMARY BY VISIT");
      allVisitsSummary.push("=".repeat(50));
      allVisitsSummary.push("");
      
      sortedVisits.forEach(([visitId, invoices], visitIndex) => {
        const visit = invoices[0]?.Visit;
        const visitDate = visit?.visitDate || invoices[0]?.createdAt;
        const visitDateStr = visitDate ? visitDate.toISOString().split("T")[0] : null;
        const doctorName = visit?.doctor?.name || "Unknown Doctor";
        const department = visit?.department || "Unknown Department";
        
        allVisitsSummary.push(`VISIT ${visitIndex + 1}`);
        allVisitsSummary.push("-".repeat(30));
        allVisitsSummary.push(`Date: ${visitDateStr || 'Date Unknown'}`);
        allVisitsSummary.push(`Doctor: ${doctorName}`);
        allVisitsSummary.push(`Department: ${department}`);
        allVisitsSummary.push("");
        
        let visitTotal = 0;
        let visitPaid = 0;
        let visitDue = 0;
        const visitItems: Array<{
          sourceType: string;
          description: string;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
        }> = [];
        
        invoices.forEach((invoice) => {
          visitTotal += Number(invoice.grandTotal);
          visitPaid += Number(invoice.amountPaid);
          visitDue += Number(invoice.amountDue);
          
          invoice.items.forEach((item) => {
            visitItems.push({
              sourceType: item.sourceType,
              description: item.description,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              lineTotal: Number(item.lineTotal),
            });
          });
        });
        
        allVisitsSummary.push(`Invoice Total: ${formatCurrency(visitTotal)}`);
        allVisitsSummary.push(`Amount Paid: ${formatCurrency(visitPaid)}`);
        allVisitsSummary.push(`Amount Due: ${formatCurrency(visitDue)}`);
        allVisitsSummary.push("");
        allVisitsSummary.push("Breakdown by Service Type:");
        allVisitsSummary.push("");
        
        // Group items by source type
        const itemsBySourceType = new Map<string, typeof visitItems>();
        visitItems.forEach((item) => {
          if (!itemsBySourceType.has(item.sourceType)) {
            itemsBySourceType.set(item.sourceType, []);
          }
          itemsBySourceType.get(item.sourceType)!.push(item);
        });
        
        // Add items grouped by source type (SERVICE, PHARMACY, LAB, DOCTOR_FEE)
        const sourceTypeOrder = ['DOCTOR_FEE', 'SERVICE', 'LAB', 'PHARMACY'];
        sourceTypeOrder.forEach((sourceType) => {
          const items = itemsBySourceType.get(sourceType);
          if (items && items.length > 0) {
            const sourceTypeLabel = sourceType === 'DOCTOR_FEE' ? 'Consultation' :
                                   sourceType === 'SERVICE' ? 'Service Charges' :
                                   sourceType === 'LAB' ? 'Lab Tests' :
                                   sourceType === 'PHARMACY' ? 'Pharmacy' : sourceType;
            const typeTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
            allVisitsSummary.push(`  ${sourceTypeLabel}: ${formatCurrency(typeTotal)}`);
            items.forEach((item) => {
              allVisitsSummary.push(
                `    - ${item.description}`
              );
              allVisitsSummary.push(
                `      Quantity: ${item.quantity} × ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`
              );
            });
            allVisitsSummary.push("");
          }
        });
        
        allVisitsSummary.push("");
        allVisitsSummary.push("=".repeat(50));
        allVisitsSummary.push("");
      });
      
      result.allVisitsSummary = allVisitsSummary.join("\n");

      // NESTED DETAILED BREAKDOWN (for structured access)
      result.detailBreakdown = {
        bySourceType: spendingBySourceType.map((source) => ({
          sourceType: source.sourceType,
          totalSpent: source.totalSpent.toFixed(2),
          totalSpentFormatted: formatCurrency(source.totalSpent),
          itemCount: Number(source.itemCount),
        })),
        byPaymentMethod: spendingByPaymentMethod.map((method) => ({
          method: method.method,
          totalPaid: method.totalPaid.toFixed(2),
          totalPaidFormatted: formatCurrency(method.totalPaid),
          paymentCount: Number(method.paymentCount),
        })),
        byStatus: breakdownByStatus.map((status) => ({
          status: status.status,
          count: Number(status.count),
          totalAmount: status.totalAmount.toFixed(2),
          totalAmountFormatted: formatCurrency(status.totalAmount),
        })),
        byMonth: monthlyBreakdown.map((month) => ({
          year: Number(month.year),
          month: Number(month.month),
          monthName: month.monthName,
          totalSpent: month.totalSpent.toFixed(2),
          totalSpentFormatted: formatCurrency(month.totalSpent),
          totalPaid: month.totalPaid.toFixed(2),
          totalPaidFormatted: formatCurrency(month.totalPaid),
          invoiceCount: Number(month.invoiceCount),
        })),
        topItems: topItems.map((item) => ({
          description: item.description,
          sourceType: item.sourceType,
          totalSpent: item.totalSpent.toFixed(2),
          totalSpentFormatted: formatCurrency(item.totalSpent),
          totalQuantity: Number(item.totalQuantity),
          avgUnitPrice: item.avgUnitPrice.toFixed(2),
          avgUnitPriceFormatted: formatCurrency(item.avgUnitPrice),
        })),
        allPayments: allPayments.map((payment) => ({
          amount: Number(payment.amount).toFixed(2),
          amountFormatted: formatCurrency(Number(payment.amount)),
          method: payment.method,
          paidAt: payment.paidAt.toISOString(),
          date: payment.paidAt.toISOString().split("T")[0],
          invoiceNo: payment.Invoice.invoiceNo,
          referenceNo: payment.referenceNo,
          note: payment.note,
        })),
        allInvoices: allInvoicesWithItems.slice(0, 10).map((invoice) => ({
          invoiceId: invoice.invoiceId,
          invoiceNo: invoice.invoiceNo,
          status: invoice.status,
          grandTotal: Number(invoice.grandTotal).toFixed(2),
          grandTotalFormatted: formatCurrency(Number(invoice.grandTotal)),
          amountPaid: Number(invoice.amountPaid).toFixed(2),
          amountPaidFormatted: formatCurrency(Number(invoice.amountPaid)),
          amountDue: Number(invoice.amountDue).toFixed(2),
          amountDueFormatted: formatCurrency(Number(invoice.amountDue)),
          createdAt: invoice.createdAt.toISOString(),
          date: invoice.createdAt.toISOString().split("T")[0],
          visitDate: invoice.Visit?.visitDate ? invoice.Visit.visitDate.toISOString().split("T")[0] : null,
          department: invoice.Visit?.department || null,
          doctorName: invoice.Visit?.doctor?.name || null,
          doctorId: invoice.Visit?.doctor?.doctorId || null,
        })),
        byVisit: sortedVisits.map(([visitId, invoices], visitIndex) => {
          const visit = invoices[0]?.Visit;
          const visitDate = visit?.visitDate || invoices[0]?.createdAt;
          const visitDateStr = visitDate ? visitDate.toISOString().split("T")[0] : null;
          const doctorName = visit?.doctor?.name || "Unknown Doctor";
          const department = visit?.department || "Unknown Department";
          
          let visitTotal = 0;
          let visitPaid = 0;
          let visitDue = 0;
          const visitItems: Array<{
            sourceType: string;
            description: string;
            quantity: number;
            unitPrice: number;
            lineTotal: number;
          }> = [];
          
          invoices.forEach((invoice) => {
            visitTotal += Number(invoice.grandTotal);
            visitPaid += Number(invoice.amountPaid);
            visitDue += Number(invoice.amountDue);
            
            invoice.items.forEach((item) => {
              visitItems.push({
                sourceType: item.sourceType,
                description: item.description,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
                lineTotal: Number(item.lineTotal),
              });
            });
          });
          
          // Group items by source type
          const itemsBySourceType = new Map<string, typeof visitItems>();
          visitItems.forEach((item) => {
            if (!itemsBySourceType.has(item.sourceType)) {
              itemsBySourceType.set(item.sourceType, []);
            }
            itemsBySourceType.get(item.sourceType)!.push(item);
          });
          
          return {
            visitNumber: visitIndex + 1,
            visitId: visitId !== 'no-visit' ? visitId : null,
            visitDate: visitDateStr,
            doctorName,
            department,
            total: visitTotal.toFixed(2),
            totalFormatted: formatCurrency(visitTotal),
            paid: visitPaid.toFixed(2),
            paidFormatted: formatCurrency(visitPaid),
            due: visitDue.toFixed(2),
            dueFormatted: formatCurrency(visitDue),
            invoiceCount: invoices.length,
            itemCount: visitItems.length,
            items: visitItems.map((item) => ({
              sourceType: item.sourceType,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toFixed(2),
              unitPriceFormatted: formatCurrency(item.unitPrice),
              lineTotal: item.lineTotal.toFixed(2),
              lineTotalFormatted: formatCurrency(item.lineTotal),
            })),
            itemsBySourceType: Array.from(itemsBySourceType.entries()).map(([sourceType, items]) => ({
              sourceType,
              sourceTypeLabel: sourceType === 'DOCTOR_FEE' ? 'Consultation' :
                              sourceType === 'SERVICE' ? 'Service Charges' :
                              sourceType === 'LAB' ? 'Lab Tests' :
                              sourceType === 'PHARMACY' ? 'Pharmacy' : sourceType,
              total: items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
              totalFormatted: formatCurrency(items.reduce((sum, item) => sum + item.lineTotal, 0)),
              itemCount: items.length,
              items: items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice.toFixed(2),
                unitPriceFormatted: formatCurrency(item.unitPrice),
                lineTotal: item.lineTotal.toFixed(2),
                lineTotalFormatted: formatCurrency(item.lineTotal),
              })),
            })),
          };
        }),
      };
      
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

// 5. Lab Report Detail Agent API
router.post(
  "/lab-reports",
  requireDoctorOrPatientAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId, patientName, startDate, endDate, testCode, testName } = req.body;
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({ error: "Unauthorized", msg: "Failed" });
      }
      
      // Determine which patientId to use
      let targetPatientId: string | null = null;
      
      if (patientId) {
        // If patientId is provided in request body
        if (user.role === "Patient" && user.patientId !== patientId) {
          // Patients can only access their own lab reports
          return res.status(403).json({
            error: "Patients can only access their own lab reports",
            msg: "Failed",
          });
        }
        // Doctors can query any patient, patients can query themselves
        targetPatientId = patientId;
      } else if (patientName && user.role === "Doctor") {
        // If patientName is provided and user is a doctor, search for patient by name
        if (!patientName.trim()) {
        return res.status(400).json({
            error: "patientName cannot be empty",
          msg: "Failed",
        });
      }
        
        // Search for patient by name (case-insensitive, partial match)
        const patients = await prisma.patient.findMany({
          where: {
            name: {
              contains: patientName.trim(),
              mode: 'insensitive',
            },
          },
          select: {
            patientId: true,
            name: true,
          },
          take: 10,
          orderBy: {
            name: 'asc',
          },
        });
        
        if (patients.length === 0) {
          return res.status(404).json({
            error: `No patient found with name matching "${patientName}"`,
            msg: "Failed",
          });
        }
        
        if (patients.length > 1) {
          // Multiple patients found - return list for doctor to choose
          return res.status(400).json({
            error: "Multiple patients found with that name. Please use patientId instead.",
            msg: "Failed",
            matches: patients.map(p => ({
              patientId: p.patientId,
              name: p.name,
            })),
          });
        }
        
        // Single patient found
        targetPatientId = patients[0].patientId;
      } else if (user.role === "Patient" && user.patientId) {
        // Patient authenticated but no patientId in body - use their own
        targetPatientId = user.patientId;
      } else {
        return res.status(400).json({
          error: "patientId is required (or patientName for doctors)",
          msg: "Failed",
        });
      }
      
      if (!targetPatientId) {
        return res.status(400).json({
          error: "Patient ID is required and must be a valid UUID",
          msg: "Failed",
        });
      }
      
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(targetPatientId.trim())) {
        return res.status(400).json({
          error: "Invalid patient ID format",
          msg: "Failed",
        });
      }
      
      const validPatientId = targetPatientId.trim();

      // Validate patient exists
      const patient = await prisma.patient.findUnique({
        where: { patientId: validPatientId },
        select: { patientId: true },
      });

      if (!patient) {
        return res.status(404).json({
          error: "Patient not found",
          msg: "Failed",
        });
      }
      
      // Get lab results from new LabResult table (with LabOrder structure)
      console.log(`[Agents] Query params for patient ${validPatientId}:`, { startDate, endDate, testCode, testName });
      
      let labResultsRaw: Array<{
        labResultId: string;
        labOrderId: string;
        labOrderItemId: string;
        testCode: string;
        testName: string;
        resultValue: string | null;
        resultValueNum: number | null;
        unit: string | null;
        referenceLow: number | string | null;
        referenceHigh: number | string | null;
        abnormalFlag: string | null;
        resultedAt: Date;
        notes: string | null;
        orderStatus: string;
        visitDate: Date;
        doctorId: string | null;
        doctorName: string | null;
        department: string | null;
      }> = [];
      
      try {
        labResultsRaw = await prisma.$queryRaw<
        Array<{
          labResultId: string;
          labOrderId: string;
          labOrderItemId: string;
          testCode: string;
          testName: string;
          resultValue: string | null;
          resultValueNum: number | null;
          unit: string | null;
          referenceLow: number | string | null;
          referenceHigh: number | string | null;
          abnormalFlag: string | null;
          resultedAt: Date;
          notes: string | null;
          orderStatus: string;
          visitDate: Date;
          doctorId: string | null;
          doctorName: string | null;
          department: string | null;
        }>
        >(Prisma.sql`
          SELECT 
          lr."labResultId",
          lr."labOrderId",
          lr."labOrderItemId",
          loi."testCode",
          loi."testName",
          lr."resultValue",
          lr."resultValueNum",
          lr."unit",
          lr."referenceLow"::text as "referenceLow",
          lr."referenceHigh"::text as "referenceHigh",
          lr."abnormalFlag",
          lr."resultedAt",
          lr."notes",
          lo.status as "orderStatus",
          v."visitDate",
            COALESCE(lo."doctorId", v."doctorId")::text as "doctorId",
            COALESCE(d.name, dv.name, '') as "doctorName",
            COALESCE(d.department, dv.department, v.department, '') as "department"
        FROM "LabResult" lr
        JOIN "LabOrderItem" loi ON lr."labOrderItemId" = loi."labOrderItemId"
        JOIN "LabOrder" lo ON lr."labOrderId" = lo."labOrderId"
        JOIN "Visit" v ON lo."visitId" = v."visitId"
        LEFT JOIN "Doctor" d ON lo."doctorId" = d."doctorId"
        LEFT JOIN "Doctor" dv ON v."doctorId" = dv."doctorId"
          WHERE lr."patientId" = ${validPatientId}::uuid
            AND lo."patientId" = ${validPatientId}::uuid
            AND v."patientId" = ${validPatientId}::uuid
          AND loi.status = 'RESULTED'
          AND lo.status != 'CANCELLED'
          ${
            startDate
              ? Prisma.sql`AND lr."resultedAt" >= ${new Date(
                  startDate as string
                )}`
              : Prisma.empty
          }
          ${
            endDate
              ? Prisma.sql`AND lr."resultedAt" <= ${new Date(endDate as string)}`
              : Prisma.empty
          }
          ${
              testCode && testCode.trim() !== ''
                ? Prisma.sql`AND loi."testCode" ILIKE ${`%${testCode.trim()}%`}`
              : Prisma.empty
          }
          ${
              testName && testName.trim() !== ''
                ? Prisma.sql`AND loi."testName" ILIKE ${`%${testName.trim()}%`}`
              : Prisma.empty
          }
          ORDER BY lr."resultedAt" DESC, lr."labResultId"
        `);
      } catch (error) {
        console.error(`[Agents] Error fetching lab results for patient ${validPatientId}:`, error);
        if (error instanceof Error) {
          console.error(`[Agents] Error details:`, error.message, error.stack);
        }
        // Continue with empty array
      }
      
      console.log(`[Agents] Raw lab results fetched: ${labResultsRaw.length} for patient ${validPatientId}`);
      
      if (labResultsRaw.length === 0) {
        // Try a simpler query without optional filters to debug
        try {
          const simpleQuery = await prisma.$queryRaw<
            Array<{ count: bigint }>
          >(Prisma.sql`
            SELECT COUNT(*) as count
            FROM "LabResult" lr
            JOIN "LabOrderItem" loi ON lr."labOrderItemId" = loi."labOrderItemId"
            JOIN "LabOrder" lo ON lr."labOrderId" = lo."labOrderId"
            JOIN "Visit" v ON lo."visitId" = v."visitId"
            WHERE lr."patientId" = ${validPatientId}::uuid
              AND loi.status = 'RESULTED'
              AND lo.status != 'CANCELLED'
          `);
          console.log(`[Agents] Simple count query result:`, Number(simpleQuery[0]?.count || 0));
        } catch (err) {
          console.error(`[Agents] Simple count query error:`, err);
        }
      }

      // Skip legacy VisitLabResult - only show results from proper lab order workflow
      // (Doctor creates order -> Lab admin enters result)
      const legacyLabResultsRaw: Array<{
          labId: string;
          visitId: string;
          testName: string;
          resultValue: number | null;
          unit: string | null;
          referenceRange: string | null;
          testDate: Date | null;
          visitDate: Date;
          doctorId: string;
          doctorName: string;
          department: string;
      }> = [];

      // Transform raw results to structured format compatible with code below
      type LabResultWithRelations = {
        labResultId: string;
        resultValue: string | null;
        resultValueNum: { toString: () => string } | null;
        unit: string | null;
        referenceLow: { toString: () => string } | null;
        referenceHigh: { toString: () => string } | null;
        abnormalFlag: string | null;
        resultedAt: Date;
        notes: string | null;
        LabOrder: {
          labOrderId: string;
          status: string;
          Visit: {
            visitDate: Date;
            doctor: {
              doctorId: string;
              name: string;
              department: string;
            };
          };
        };
        LabOrderItem: {
          labOrderItemId: string;
          testCode: string;
          testName: string;
          status: string;
        };
      };

      console.log(`[Agents] Raw lab results fetched: ${labResultsRaw.length} for patient ${validPatientId}`);
      
      // Fetch doctor names in batch if we have doctorIds (fallback if not in query)
      const doctorIds = [...new Set(labResultsRaw.map(r => r.doctorId).filter(Boolean).map(id => id?.trim()))] as string[];
      const doctorsMap = new Map<string, { name: string; department: string }>();
      
      // Always try to fetch doctors if we have doctorIds, even if query returned names
      // This ensures we have a fallback if the JOIN didn't work
      if (doctorIds.length > 0) {
        try {
          const doctors = await prisma.doctor.findMany({
            where: { doctorId: { in: doctorIds } },
            select: { doctorId: true, name: true, department: true },
          });
          doctors.forEach(d => {
            doctorsMap.set(d.doctorId, { name: d.name, department: d.department });
          });
          console.log(`[Agents] Fetched ${doctors.length} doctors for ${doctorIds.length} doctorIds. DoctorIds: ${doctorIds.join(', ')}`);
          if (doctors.length < doctorIds.length) {
            const foundIds = new Set(doctors.map(d => d.doctorId));
            const missingIds = doctorIds.filter(id => !foundIds.has(id));
            console.warn(`[Agents] Missing doctors for IDs: ${missingIds.join(', ')}`);
          }
        } catch (err) {
          console.error(`[Agents] Error fetching doctors:`, err);
        }
      }

      const labResults: LabResultWithRelations[] = labResultsRaw.map((r) => {
        // Convert referenceLow and referenceHigh to strings, handling Decimal types from Prisma
        const refLow = r.referenceLow !== null && r.referenceLow !== undefined 
          ? String(r.referenceLow) 
          : null;
        const refHigh = r.referenceHigh !== null && r.referenceHigh !== undefined 
          ? String(r.referenceHigh) 
          : null;
        
        // Use doctor name from query first, fallback to lookup map
        let doctorName = r.doctorName && r.doctorName.trim() !== '' ? r.doctorName.trim() : null;
        let doctorDepartment = r.department && r.department.trim() !== '' ? r.department.trim() : null;
        
        // If still no doctor name, try lookup map
        if (!doctorName && r.doctorId) {
          const doctorInfo = doctorsMap.get(r.doctorId.trim());
          if (doctorInfo) {
            doctorName = doctorInfo.name;
            doctorDepartment = doctorInfo.department;
          } else {
            // Log for debugging
            console.log(`[Agents] Doctor not found in map for doctorId: ${r.doctorId}, doctorName from query: ${r.doctorName}`);
          }
        }
        
        // Final fallback: if we have doctorId but no name, try direct lookup
        if (!doctorName && r.doctorId && r.doctorId.trim() !== '') {
          // This will be handled by the batch lookup above, but log if it still fails
          console.warn(`[Agents] Could not resolve doctor name for doctorId: ${r.doctorId}`);
        }
        
        return {
        labResultId: r.labResultId,
        resultValue: r.resultValue,
        resultValueNum: r.resultValueNum !== null ? { toString: () => String(r.resultValueNum) } : null,
        unit: r.unit,
          referenceLow: refLow ? { toString: () => refLow } : null,
          referenceHigh: refHigh ? { toString: () => refHigh } : null,
        abnormalFlag: r.abnormalFlag,
        resultedAt: r.resultedAt,
        notes: r.notes,
        LabOrder: {
          labOrderId: r.labOrderId,
          status: r.orderStatus,
          Visit: {
            visitDate: r.visitDate,
            doctor: {
              doctorId: r.doctorId || '',
              name: doctorName || 'Unknown',
              department: doctorDepartment || '',
            },
          },
        },
        LabOrderItem: {
          labOrderItemId: r.labOrderItemId,
          testCode: r.testCode,
            testName: r.testName,
            status: 'RESULTED',
          },
        };
      });
      
      console.log(`[Agents] Transformed lab results: ${labResults.length} for patient ${validPatientId}`);

      // Skip legacy results - only use proper lab order workflow results
      const legacyLabResults: LabResultWithRelations[] = [];

      // Combine both result sets, prioritizing new LabResult data
      // Only use results from proper lab order workflow (doctor creates order -> lab admin enters result)
      // Remove duplicates based on labResultId (for new) and labId (for legacy)
      // Also deduplicate by test name, date, and value to ensure only one result per unique test+date+value
      // Ensure we only keep results that belong to the requested patient
      const seenIds = new Set<string>();
      const seenTestDateValue = new Set<string>();
      const uniqueResults: LabResultWithRelations[] = [];
      
      // First, deduplicate new lab results
      // Sort by date descending to keep the most recent result when duplicates exist
      const sortedLabResults = labResults.sort((a, b) => b.resultedAt.getTime() - a.resultedAt.getTime());
      
      for (const result of sortedLabResults) {
        // Only deduplicate by labResultId (primary key) - each labResultId should be unique
        // Remove the test+date+value deduplication as it may be filtering out valid results
        if (!seenIds.has(result.labResultId)) {
          seenIds.add(result.labResultId);
          uniqueResults.push(result);
        }
      }
      
      console.log(`[Agents] Unique results after deduplication: ${uniqueResults.length} for patient ${validPatientId}`);
      
      // Skip legacy results - we only want results from the proper lab order workflow

      // Get breakdown by test type (combining both new and legacy data)
      const breakdownByTestNew = labResultsRaw.length > 0 ? await prisma.$queryRaw<
        Array<{
          testCode: string;
          testName: string;
          resultCount: number;
          abnormalCount: number;
          latestResult: Date;
        }>
      >(Prisma.sql`
        SELECT 
          loi."testCode",
          loi."testName",
          COUNT(DISTINCT lr."labResultId") as "resultCount",
          COUNT(DISTINCT CASE WHEN lr."abnormalFlag" IS NOT NULL THEN lr."labResultId" END)::integer as "abnormalCount",
          MAX(lr."resultedAt") as "latestResult"
        FROM "LabResult" lr
        JOIN "LabOrderItem" loi ON lr."labOrderItemId" = loi."labOrderItemId"
        JOIN "LabOrder" lo ON lr."labOrderId" = lo."labOrderId"
        JOIN "Visit" v ON lo."visitId" = v."visitId"
        WHERE lr."patientId" = ${validPatientId}::uuid
          AND lo."patientId" = ${validPatientId}::uuid
          AND v."patientId" = ${validPatientId}::uuid
          AND loi.status = 'RESULTED'
          AND lo.status != 'CANCELLED'
          ${
            startDate
              ? Prisma.sql`AND lr."resultedAt" >= ${new Date(
                  startDate as string
                )}`
              : Prisma.empty
          }
          ${
            endDate
              ? Prisma.sql`AND lr."resultedAt" <= ${new Date(endDate as string)}`
              : Prisma.empty
          }
          ${
            testCode && testCode.trim() !== ''
              ? Prisma.sql`AND loi."testCode" ILIKE ${`%${testCode.trim()}%`}`
              : Prisma.empty
          }
          ${
            testName && testName.trim() !== ''
              ? Prisma.sql`AND loi."testName" ILIKE ${`%${testName.trim()}%`}`
              : Prisma.empty
          }
        GROUP BY loi."testCode", loi."testName"
        ORDER BY "latestResult" DESC
      `) : [];

      // Skip legacy breakdown - only use proper lab order workflow results
      const breakdownByTestLegacy: Array<{
          testName: string;
          resultCount: number;
          latestResult: Date;
      }> = [];

      // Sort by date and use for all calculations
      // Include all results (no limit) to ensure all lab results appear
      const finalLabResults = uniqueResults
        .sort((a, b) => b.resultedAt.getTime() - a.resultedAt.getTime());

      // Merge breakdown by test type and add latest result values
      const breakdownByTest = [
        ...breakdownByTestNew.map((t) => {
          // Find the latest result for this test type from finalLabResults
          const latestResultForTest = finalLabResults
            .filter((r) => r.LabOrderItem.testCode === t.testCode)
            .sort((a, b) => b.resultedAt.getTime() - a.resultedAt.getTime())[0];
          
          return {
          testCode: t.testCode,
          testName: t.testName,
          resultCount: Number(t.resultCount),
          abnormalCount: Number(t.abnormalCount),
          latestResult: t.latestResult,
            latestResultValue: latestResultForTest?.resultValue || null,
            latestResultValueNum: latestResultForTest?.resultValueNum
              ? Number(latestResultForTest.resultValueNum.toString()).toFixed(3)
              : null,
            latestResultUnit: latestResultForTest?.unit || null,
            latestResultDoctor: latestResultForTest?.LabOrder.Visit.doctor.name || null,
            latestResultDoctorId: latestResultForTest?.LabOrder.Visit.doctor.doctorId || null,
            latestResultDepartment: latestResultForTest?.LabOrder.Visit.doctor.department || null,
          };
        }),
        ...breakdownByTestLegacy.map((t) => ({
          testCode: t.testName,
          testName: t.testName,
          resultCount: Number(t.resultCount),
          abnormalCount: 0, // Legacy doesn't track abnormal
          latestResult: t.latestResult,
          latestResultValue: null,
          latestResultValueNum: null,
          latestResultUnit: null,
          latestResultDoctor: null,
          latestResultDoctorId: null,
          latestResultDepartment: null,
        })),
      ].sort((a, b) => b.latestResult.getTime() - a.latestResult.getTime());

      // Get breakdown by abnormal flags (only from new LabResult)
      const breakdownByAbnormal = await prisma.$queryRaw<
        Array<{
          abnormalFlag: string | null;
          count: number;
        }>
      >(Prisma.sql`
        SELECT 
          COALESCE(lr."abnormalFlag", 'NORMAL') as "abnormalFlag",
          COUNT(DISTINCT lr."labResultId") as "count"
        FROM "LabResult" lr
        JOIN "LabOrderItem" loi ON lr."labOrderItemId" = loi."labOrderItemId"
        JOIN "LabOrder" lo ON lr."labOrderId" = lo."labOrderId"
        JOIN "Visit" v ON lo."visitId" = v."visitId"
        WHERE lr."patientId" = ${validPatientId}::uuid
          AND lo."patientId" = ${validPatientId}::uuid
          AND v."patientId" = ${validPatientId}::uuid
          AND loi.status = 'RESULTED'
          AND lo.status != 'CANCELLED'
          ${
            startDate
              ? Prisma.sql`AND lr."resultedAt" >= ${new Date(
                  startDate as string
                )}`
              : Prisma.empty
          }
          ${
            endDate
              ? Prisma.sql`AND lr."resultedAt" <= ${new Date(endDate as string)}`
              : Prisma.empty
          }
        GROUP BY lr."abnormalFlag"
        ORDER BY "count" DESC
      `);

      // Get monthly breakdown from new LabResult
      const monthlyBreakdownNew = labResultsRaw.length > 0 ? await prisma.$queryRaw<
        Array<{
          year: number;
          month: number;
          monthName: string;
          resultCount: number;
          abnormalCount: number;
        }>
      >(Prisma.sql`
        SELECT 
          EXTRACT(YEAR FROM lr."resultedAt")::integer as "year",
          EXTRACT(MONTH FROM lr."resultedAt")::integer as "month",
          TO_CHAR(lr."resultedAt", 'YYYY-MM') as "monthName",
          COUNT(DISTINCT lr."labResultId") as "resultCount",
          COUNT(DISTINCT CASE WHEN lr."abnormalFlag" IS NOT NULL THEN lr."labResultId" END)::integer as "abnormalCount"
        FROM "LabResult" lr
        JOIN "LabOrder" lo ON lr."labOrderId" = lo."labOrderId"
        JOIN "Visit" v ON lo."visitId" = v."visitId"
        WHERE lr."patientId" = ${validPatientId}::uuid
          AND v."patientId" = ${validPatientId}::uuid
          ${
            startDate
              ? Prisma.sql`AND lr."resultedAt" >= ${new Date(
                  startDate as string
                )}`
              : Prisma.empty
          }
          ${
            endDate
              ? Prisma.sql`AND lr."resultedAt" <= ${new Date(endDate as string)}`
              : Prisma.empty
          }
        GROUP BY EXTRACT(YEAR FROM lr."resultedAt"), EXTRACT(MONTH FROM lr."resultedAt"), TO_CHAR(lr."resultedAt", 'YYYY-MM')
        ORDER BY "year" DESC, "month" DESC
        LIMIT 12
      `) : [];

      // Skip legacy monthly breakdown - only use proper lab order workflow results
      const monthlyBreakdownLegacy: Array<{
          year: number;
          month: number;
          monthName: string;
          resultCount: number;
      }> = [];

      // Merge monthly breakdowns
      const monthlyBreakdownMap = new Map<string, { year: number; month: number; monthName: string; resultCount: number; abnormalCount: number }>();
      
      monthlyBreakdownNew.forEach((m) => {
        monthlyBreakdownMap.set(m.monthName, {
          year: Number(m.year),
          month: Number(m.month),
          monthName: m.monthName,
          resultCount: Number(m.resultCount),
          abnormalCount: Number(m.abnormalCount),
        });
      });

      monthlyBreakdownLegacy.forEach((m) => {
        const existing = monthlyBreakdownMap.get(m.monthName);
        if (existing) {
          existing.resultCount += Number(m.resultCount);
        } else {
          monthlyBreakdownMap.set(m.monthName, {
            year: Number(m.year),
            month: Number(m.month),
            monthName: m.monthName,
            resultCount: Number(m.resultCount),
            abnormalCount: 0,
          });
        }
      });

      const monthlyBreakdown = Array.from(monthlyBreakdownMap.values())
        .sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year;
          return b.month - a.month;
        })
        .slice(0, 12);

      // Get recent abnormal results (filter for non-null abnormal flags)
      const recentAbnormal = finalLabResults
        .filter((result) => result.abnormalFlag !== null && result.abnormalFlag !== undefined && result.abnormalFlag !== '')
        .slice(0, 10);

      // Calculate summary statistics
      const totalResults = finalLabResults.length;
      const totalAbnormal = finalLabResults.filter(
        (r) => r.abnormalFlag !== null && r.abnormalFlag !== undefined && r.abnormalFlag !== ''
      ).length;
      const uniqueTests = new Set(
        finalLabResults.map((r) => r.LabOrderItem.testCode || r.LabOrderItem.testName)
      ).size;
      const uniqueDoctors = new Set(
        finalLabResults.map((r) => r.LabOrder.Visit.doctor.doctorId).filter(Boolean)
      );
      const uniqueDoctorNames = Array.from(uniqueDoctors)
        .map(doctorId => {
          const result = finalLabResults.find(r => r.LabOrder.Visit.doctor.doctorId === doctorId);
          return result?.LabOrder.Visit.doctor.name || null;
        })
        .filter(Boolean);
      const latestResult = finalLabResults.length > 0 ? finalLabResults[0] : null;

      // Date formatting helper
      const formatDate = (date: Date): string => {
        return date.toISOString().split("T")[0];
      };

      // FLAT RESPONSE - Numbered flat keys
      const result: any = {
        // Summary
        totalResults,
        totalAbnormal,
        normalResults: totalResults - totalAbnormal,
        uniqueTests,
        uniqueDoctorsCount: uniqueDoctors.size,
        uniqueDoctorNames: uniqueDoctorNames.join(", "),
        
        // Latest Result (flat fields)
        latestResultTestName:
          latestResult?.LabOrderItem.testName || null,
        latestResultTestCode:
          latestResult?.LabOrderItem.testCode || null,
        latestResultValue: latestResult?.resultValue || null,
        latestResultValueNum:
          latestResult?.resultValueNum
            ? Number(latestResult.resultValueNum.toString()).toFixed(3)
            : null,
        latestResultUnit: latestResult?.unit || null,
        latestResultFlag: latestResult?.abnormalFlag || null,
        latestResultDate: latestResult
          ? formatDate(latestResult.resultedAt)
          : null,
        latestResultReferenceLow: latestResult?.referenceLow
          ? Number(latestResult.referenceLow.toString()).toFixed(3)
          : null,
        latestResultReferenceHigh: latestResult?.referenceHigh
          ? Number(latestResult.referenceHigh.toString()).toFixed(3)
          : null,
        latestResultReferenceRange:
          latestResult?.referenceLow && latestResult?.referenceHigh
            ? `${Number(latestResult.referenceLow.toString()).toFixed(3)} - ${Number(latestResult.referenceHigh.toString()).toFixed(3)}`
            : latestResult?.referenceLow
            ? Number(latestResult.referenceLow.toString()).toFixed(3)
            : latestResult?.referenceHigh
            ? Number(latestResult.referenceHigh.toString()).toFixed(3)
          : null,
        latestResultOrderDoctorName:
          latestResult?.LabOrder.Visit.doctor.name || null,
        
        // Breakdown counts
        testTypeCount: breakdownByTest.length,
        abnormalBreakdownCount: breakdownByAbnormal.length,
        monthlyBreakdownCount: monthlyBreakdown.length,
        recentAbnormalCount: recentAbnormal.length,
      };

      // Add numbered test type fields (testType1, testType2, etc.)
      breakdownByTest.slice(0, 20).forEach((test, index) => {
        const prefix = `testType${index + 1}`;
        result[`${prefix}Code`] = test.testCode;
        result[`${prefix}Name`] = test.testName;
        result[`${prefix}ResultCount`] = Number(test.resultCount);
        result[`${prefix}AbnormalCount`] = Number(test.abnormalCount);
        result[`${prefix}LatestResultDate`] = formatDate(test.latestResult);
        result[`${prefix}LatestResultValue`] = test.latestResultValue || null;
        result[`${prefix}LatestResultValueNum`] = test.latestResultValueNum || null;
        result[`${prefix}LatestResultUnit`] = test.latestResultUnit || null;
        result[`${prefix}LatestResultDoctor`] = test.latestResultDoctor || null;
        result[`${prefix}LatestResultDoctorId`] = test.latestResultDoctorId || null;
        result[`${prefix}LatestResultDepartment`] = test.latestResultDepartment || null;
      });

      // Add numbered abnormal breakdown (abnormal1, abnormal2, etc.)
      breakdownByAbnormal.forEach((item, index) => {
        const prefix = `abnormal${index + 1}`;
        result[`${prefix}Flag`] = item.abnormalFlag;
        result[`${prefix}Count`] = Number(item.count);
      });

      // Add numbered monthly breakdown (labMonth1, labMonth2, etc.)
      monthlyBreakdown.forEach((month, index) => {
        const prefix = `labMonth${index + 1}`;
        result[`${prefix}Year`] = Number(month.year);
        result[`${prefix}Month`] = Number(month.month);
        result[`${prefix}MonthName`] = month.monthName;
        result[`${prefix}ResultCount`] = Number(month.resultCount);
        result[`${prefix}AbnormalCount`] = Number(month.abnormalCount);
      });

      // Group lab results by labOrderId and doctor to create order number mapping (before processing results)
      // Orders are numbered per doctor (each doctor's orders start from 1, 2, 3, etc.)
      const ordersByDoctor = new Map<string, Array<{
        labOrderId: string;
        visitDate: Date;
        doctorId: string;
      }>>();
      
      finalLabResults.forEach((labResult) => {
        const orderId = labResult.LabOrder.labOrderId;
        const doctorId = labResult.LabOrder.Visit.doctor.doctorId || 'unknown';
        
        if (!ordersByDoctor.has(doctorId)) {
          ordersByDoctor.set(doctorId, []);
        }
        
        const doctorOrders = ordersByDoctor.get(doctorId)!;
        if (!doctorOrders.find(o => o.labOrderId === orderId)) {
          doctorOrders.push({
            labOrderId: orderId,
            visitDate: labResult.LabOrder.Visit.visitDate,
            doctorId: doctorId,
          });
        }
      });
      
      // Sort orders by visit date (most recent first) for each doctor and create mapping
      const orderIdToNumberMap = new Map<string, string>();
      
      ordersByDoctor.forEach((doctorOrders, doctorId) => {
        // Sort this doctor's orders by visit date (most recent first)
        const sortedDoctorOrders = doctorOrders.sort((a, b) => 
          b.visitDate.getTime() - a.visitDate.getTime()
        );
        
        // Number this doctor's orders starting from 1
        sortedDoctorOrders.forEach((order, index) => {
          orderIdToNumberMap.set(order.labOrderId, String(index + 1));
        });
      });

      // Add numbered recent abnormal results (abnormalResult1, abnormalResult2, etc.)
      recentAbnormal.slice(0, 10).forEach((resultItem, index) => {
        const prefix = `abnormalResult${index + 1}`;
        const orderNumber = orderIdToNumberMap.get(resultItem.LabOrder.labOrderId) || null;
        result[`${prefix}TestName`] = resultItem.LabOrderItem.testName;
        result[`${prefix}TestCode`] = resultItem.LabOrderItem.testCode;
        result[`${prefix}Value`] = resultItem.resultValue;
        result[`${prefix}ValueNum`] = resultItem.resultValueNum
          ? Number(resultItem.resultValueNum.toString()).toFixed(3)
          : null;
        result[`${prefix}Unit`] = resultItem.unit;
        result[`${prefix}Flag`] = resultItem.abnormalFlag;
        result[`${prefix}Date`] = formatDate(resultItem.resultedAt);
        result[`${prefix}ReferenceLow`] = resultItem.referenceLow
          ? Number(resultItem.referenceLow.toString()).toFixed(3)
          : null;
        result[`${prefix}ReferenceHigh`] = resultItem.referenceHigh
          ? Number(resultItem.referenceHigh.toString()).toFixed(3)
          : null;
        // Formatted reference range string (e.g., "233 - 44 44")
        const abnormalRefLowStr = resultItem.referenceLow
          ? Number(resultItem.referenceLow.toString()).toFixed(3)
          : null;
        const abnormalRefHighStr = resultItem.referenceHigh
          ? Number(resultItem.referenceHigh.toString()).toFixed(3)
          : null;
        result[`${prefix}ReferenceRange`] =
          abnormalRefLowStr && abnormalRefHighStr
            ? `${abnormalRefLowStr} - ${abnormalRefHighStr}`
            : abnormalRefLowStr
            ? abnormalRefLowStr
            : abnormalRefHighStr
            ? abnormalRefHighStr
          : null;
        result[`${prefix}OrderId`] = orderNumber; // Use numbered order (1, 2, 3, etc.) - per doctor
        result[`${prefix}OrderDoctorName`] =
          resultItem.LabOrder.Visit.doctor.name;
        result[`${prefix}Department`] =
          resultItem.LabOrder.Visit.doctor.department;
      });

      // Add numbered recent lab results (labResult1, labResult2, etc.)
      // Show up to 100 results in numbered fields for better coverage
      finalLabResults.slice(0, 100).forEach((labResult, index) => {
        const prefix = `labResult${index + 1}`;
        const orderNumber = orderIdToNumberMap.get(labResult.LabOrder.labOrderId) || null;
        result[`${prefix}TestName`] = labResult.LabOrderItem.testName;
        result[`${prefix}TestCode`] = labResult.LabOrderItem.testCode;
        result[`${prefix}Value`] = labResult.resultValue;
        result[`${prefix}ResultValue`] = labResult.resultValue; // Explicit result value field
        result[`${prefix}ValueNum`] = labResult.resultValueNum
          ? Number(labResult.resultValueNum.toString()).toFixed(3)
          : null;
        result[`${prefix}ResultValueNum`] = labResult.resultValueNum
          ? Number(labResult.resultValueNum.toString()).toFixed(3)
          : null; // Explicit numeric result value field
        result[`${prefix}Unit`] = labResult.unit;
        result[`${prefix}Flag`] = labResult.abnormalFlag;
        result[`${prefix}Date`] = formatDate(labResult.resultedAt);
        result[`${prefix}ReferenceLow`] = labResult.referenceLow
          ? Number(labResult.referenceLow.toString()).toFixed(3)
          : null;
        result[`${prefix}ReferenceHigh`] = labResult.referenceHigh
          ? Number(labResult.referenceHigh.toString()).toFixed(3)
          : null;
        // Formatted reference range string (e.g., "233 - 44 44")
        const refLowStr = labResult.referenceLow
          ? Number(labResult.referenceLow.toString()).toFixed(3)
          : null;
        const refHighStr = labResult.referenceHigh
          ? Number(labResult.referenceHigh.toString()).toFixed(3)
          : null;
        result[`${prefix}ReferenceRange`] =
          refLowStr && refHighStr
            ? `${refLowStr} - ${refHighStr}`
            : refLowStr
            ? refLowStr
            : refHighStr
            ? refHighStr
          : null;
        result[`${prefix}OrderId`] = orderNumber; // Use numbered order (1, 2, 3, etc.) - per doctor
        result[`${prefix}OrderDoctorName`] = labResult.LabOrder.Visit.doctor.name;
        result[`${prefix}Department`] =
          labResult.LabOrder.Visit.doctor.department;
        result[`${prefix}OrderStatus`] = labResult.LabOrder.status;
        result[`${prefix}Notes`] = labResult.notes;
      });

      // Group lab results by labOrderId and create numbered order fields (order1, order2, etc.)
      const ordersMap = new Map<string, {
        labOrderId: string;
        status: string;
        visitDate: Date;
        doctorName: string;
        doctorId: string;
        department: string;
        results: typeof finalLabResults;
      }>();
      
      finalLabResults.forEach((labResult) => {
        const orderId = labResult.LabOrder.labOrderId;
        if (!ordersMap.has(orderId)) {
          ordersMap.set(orderId, {
            labOrderId: orderId,
            status: labResult.LabOrder.status,
            visitDate: labResult.LabOrder.Visit.visitDate,
            doctorName: labResult.LabOrder.Visit.doctor.name,
            doctorId: labResult.LabOrder.Visit.doctor.doctorId,
            department: labResult.LabOrder.Visit.doctor.department,
            results: [],
          });
        }
        ordersMap.get(orderId)!.results.push(labResult);
      });
      
      // Sort orders by visit date (most recent first)
      const sortedOrders = Array.from(ordersMap.values()).sort((a, b) => 
        b.visitDate.getTime() - a.visitDate.getTime()
      );
      
      // Add numbered order fields (order1, order2, etc.)
      // Use the orderIdToNumberMap that maps to doctor-specific order numbers
      sortedOrders.slice(0, 50).forEach((order, index) => {
        const prefix = `order${index + 1}`;
        const orderNumber = orderIdToNumberMap.get(order.labOrderId) || String(index + 1);
        result[`${prefix}OrderId`] = orderNumber; // Use doctor-specific number (1, 2, 3, etc.)
        result[`${prefix}Status`] = order.status;
        result[`${prefix}VisitDate`] = formatDate(order.visitDate);
        result[`${prefix}DoctorName`] = order.doctorName;
        result[`${prefix}DoctorId`] = order.doctorId;
        result[`${prefix}Department`] = order.department;
        result[`${prefix}ResultsCount`] = order.results.length;
      });
      
      result.totalOrders = sortedOrders.length;

      // NESTED DETAILED BREAKDOWN (for structured access)
      result.detailBreakdown = {
        byTestType: breakdownByTest.map((test) => ({
          testCode: test.testCode,
          testName: test.testName,
          resultCount: Number(test.resultCount),
          abnormalCount: Number(test.abnormalCount),
          latestResultDate: formatDate(test.latestResult),
          latestResultDoctor: test.latestResultDoctor || null,
          latestResultDoctorId: test.latestResultDoctorId || null,
          latestResultDepartment: test.latestResultDepartment || null,
        })),
        byAbnormalFlag: breakdownByAbnormal.map((item) => ({
          flag: item.abnormalFlag,
          count: Number(item.count),
        })),
        byMonth: monthlyBreakdown.map((month) => ({
          year: Number(month.year),
          month: Number(month.month),
          monthName: month.monthName,
          resultCount: Number(month.resultCount),
          abnormalCount: Number(month.abnormalCount),
        })),
        recentAbnormal: recentAbnormal.map((resultItem) => {
          const orderNumber = orderIdToNumberMap.get(resultItem.LabOrder.labOrderId) || null;
          return {
          testName: resultItem.LabOrderItem.testName,
          testCode: resultItem.LabOrderItem.testCode,
          resultValue: resultItem.resultValue,
          resultValueNum: resultItem.resultValueNum
            ? Number(resultItem.resultValueNum.toString()).toFixed(3)
            : null,
          unit: resultItem.unit,
          abnormalFlag: resultItem.abnormalFlag,
          resultedAt: resultItem.resultedAt.toISOString(),
          date: formatDate(resultItem.resultedAt),
          referenceLow: resultItem.referenceLow
            ? Number(resultItem.referenceLow.toString()).toFixed(3)
            : null,
          referenceHigh: resultItem.referenceHigh
            ? Number(resultItem.referenceHigh.toString()).toFixed(3)
            : null,
          referenceRange:
            resultItem.referenceLow && resultItem.referenceHigh
              ? `${Number(resultItem.referenceLow.toString()).toFixed(3)} - ${Number(resultItem.referenceHigh.toString()).toFixed(3)}`
              : resultItem.referenceLow
              ? Number(resultItem.referenceLow.toString()).toFixed(3)
              : resultItem.referenceHigh
            ? Number(resultItem.referenceHigh.toString()).toFixed(3)
            : null,
            orderId: orderNumber, // Use numbered order (1, 2, 3, etc.) - per doctor
          orderDoctorName: resultItem.LabOrder.Visit.doctor.name,
          department: resultItem.LabOrder.Visit.doctor.department,
          };
        }),
        allResults: finalLabResults.map((labResult) => {
          // Format date and time separately
          const resultDate = new Date(labResult.resultedAt);
          const dateStr = resultDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
          const timeStr = resultDate.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          });
          
          // Format reference range with unit if available
          const refLow = labResult.referenceLow
            ? Number(labResult.referenceLow.toString()).toFixed(3)
            : null;
          const refHigh = labResult.referenceHigh
            ? Number(labResult.referenceHigh.toString()).toFixed(3)
            : null;
          const unit = labResult.unit || '';
          const referenceRange = refLow && refHigh
            ? `${refLow} - ${refHigh}${unit ? ` ${unit}` : ''}`
            : refLow
            ? `${refLow}${unit ? ` ${unit}` : ''}`
            : refHigh
            ? `${refHigh}${unit ? ` ${unit}` : ''}`
            : null;
          
          const orderNumber = orderIdToNumberMap.get(labResult.LabOrder.labOrderId) || null;
          
          return {
          labResultId: labResult.labResultId,
          testName: labResult.LabOrderItem.testName,
          testCode: labResult.LabOrderItem.testCode,
          resultValue: labResult.resultValue,
          resultValueNum: labResult.resultValueNum
            ? Number(labResult.resultValueNum.toString()).toFixed(3)
            : null,
          unit: labResult.unit,
          abnormalFlag: labResult.abnormalFlag,
          resultedAt: labResult.resultedAt.toISOString(),
          date: formatDate(labResult.resultedAt),
            resultDate: dateStr,
            resultTime: timeStr,
            referenceLow: refLow,
            referenceHigh: refHigh,
            referenceRange: referenceRange,
            status: labResult.abnormalFlag ? `Flagged: ${labResult.abnormalFlag}` : 'Normal',
          notes: labResult.notes,
          orderId: orderNumber, // Use numbered order (1, 2, 3, etc.) - per doctor
          orderStatus: labResult.LabOrder.status,
          visitDate: formatDate(labResult.LabOrder.Visit.visitDate),
          orderDoctorName: labResult.LabOrder.Visit.doctor.name,
          doctorId: labResult.LabOrder.Visit.doctor.doctorId,
          department: labResult.LabOrder.Visit.doctor.department,
          };
        }),
      };
      
      res.json(result);
    } catch (error) {
      console.error("Lab Report Agent Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch lab report information",
        msg: "Failed",
      });
    }
  }
);

// 6. Appointment Letter Agent API
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
