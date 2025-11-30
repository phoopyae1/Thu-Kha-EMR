import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient } from "@prisma/client";
import { CreateLabOrderSchema } from "../validation/clinical.js";
import * as labService from "../services/labService.js";
import { createPrescription } from "../services/pharmacyService.js";
import { z } from "zod";
import { toDateOnly, toMinutes } from "../utils/time.js";

const prisma = new PrismaClient();
const router = Router();

// Validation schema for medication agent
const MedicationAgentSchema = z.object({
  doctorId: z.string().uuid(),
});

// Validation schema for patient overview
const PatientOverviewSchema = z.object({
  doctorId: z.string().uuid(),
});

// Validation schema for doctor agent lab order (uses patientName, date, time instead of visitId)
const DoctorAgentLabOrderSchema = z.object({
  doctorId: z.string().uuid(),
  patientName: z.string().min(1),
  date: z.string(), // Date string (YYYY-MM-DD format)
  startTime: z.string(), // Time string: 24-hour format (HH:MM, e.g., "16:00") or 12-hour format with AM/PM (e.g., "4:00 PM", "4:00PM", "4:00 AM", "4:00AM")
  priority: z.string().optional(),
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        testCode: z.string().min(1),
        testName: z.string().min(1),
        specimen: z.string().optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .min(1),
});

// Patient Record Agent API - Returns patient record with visit information, BMI, SpO2, etc.
router.post(
  "/patient-record",
  requireAuth,
  requireRole("Doctor"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body for doctorId
      const validationResult = MedicationAgentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorId } = validationResult.data;

      // Get doctor info
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        select: { doctorId: true, name: true, department: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      // Get visits for this doctor to find unique patients
      const visits = await prisma.visit.findMany({
        where: { doctorId },
        include: {
          doctor: true,
          patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
              contact: true,
              insurance: true,
              drugAllergies: true,
            },
          },
        },
        orderBy: { visitDate: "desc" },
      });

      // Get unique patient IDs from visits
      const uniquePatientIds = [...new Set(visits.map(v => v.patientId))];

      // Get all patients with their profiles
      const patients = await prisma.patient.findMany({
        where: {
          patientId: { in: uniquePatientIds },
        },
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

      // Get observations for this doctor (which contain BMI, SpO2, vitals, etc.)
      const observations = await prisma.observation.findMany({
        where: {
          doctorId,
          patientId: { in: uniquePatientIds },
        },
        orderBy: { createdAt: "desc" },
      });

      // Get vitals for all these patients (fallback source)
      const vitals = await prisma.vitals.findMany({
        where: {
          patientId: { in: uniquePatientIds },
        },
        orderBy: { recordedAt: "desc" },
      });

      // Helper function to calculate age
      const calculateAge = (dob: Date): number => {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }
        return age;
      };

      // Group observations by patientId to get latest observation per patient (prioritize observations)
      const observationsByPatient = new Map<string, typeof observations[0]>();
      observations.forEach(obs => {
        const existing = observationsByPatient.get(obs.patientId);
        if (!existing || new Date(obs.createdAt) > new Date(existing.createdAt)) {
          observationsByPatient.set(obs.patientId, obs);
        }
      });

      // Group vitals by patientId to get latest vitals per patient (fallback)
      const vitalsByPatient = new Map<string, typeof vitals[0]>();
      vitals.forEach(vital => {
        const existing = vitalsByPatient.get(vital.patientId);
        if (!existing || new Date(vital.recordedAt) > new Date(existing.recordedAt)) {
          vitalsByPatient.set(vital.patientId, vital);
        }
      });

      // Build flat response structure
      const result: any = {
        // Doctor Information
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        doctorDepartment: doctor.department,

        // Summary counts
        totalPatients: patients.length,
        totalVisits: visits.length,
        totalObservations: observations.length,
        totalVitals: vitals.length,

        status: "Success",
      };

      // Helper function to get vitals from observation or vitals table
      const getVitalsData = (patientId: string) => {
        const obs = observationsByPatient.get(patientId);
        const vital = vitalsByPatient.get(patientId);
        
        // Prioritize observation data, fallback to vitals
        if (obs) {
          return {
            bmi: obs.bmi ? obs.bmi.toString() : null,
            spo2: obs.spo2 ? `${obs.spo2}%` : null,
            bloodPressure: obs.bpSystolic && obs.bpDiastolic
              ? `${obs.bpSystolic}/${obs.bpDiastolic} mmHg`
              : null,
            heartRate: obs.heartRate ? `${obs.heartRate} bpm` : null,
            temperature: obs.temperatureC ? `${obs.temperatureC}°C` : null,
            weight: null, // Observations don't have weight
            height: null, // Observations don't have height
            note: obs.noteText || null, // Observation note
            recordedDate: obs.createdAt.toISOString().split("T")[0],
            recordedTime: obs.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
            visitId: obs.visitId,
            source: "observation",
          };
        } else if (vital) {
          return {
            bmi: vital.bmi ? vital.bmi.toString() : null,
            spo2: vital.spo2 ? `${vital.spo2}%` : null,
            bloodPressure: vital.systolic && vital.diastolic
              ? `${vital.systolic}/${vital.diastolic} mmHg`
              : null,
            heartRate: vital.heartRate ? `${vital.heartRate} bpm` : null,
            temperature: vital.temperature ? `${vital.temperature}°C` : null,
            weight: vital.weightKg ? `${vital.weightKg} kg` : null,
            height: vital.heightCm ? `${vital.heightCm} cm` : null,
            note: vital.notes || null, // Vitals notes
            recordedDate: vital.recordedAt.toISOString().split("T")[0],
            recordedTime: vital.recordedAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
            visitId: vital.visitId,
            source: "vitals",
          };
        }
        return null;
      };

      // Add patient records with their profiles and vitals
      patients.forEach((patient, index) => {
        const prefix = `patient${index + 1}`;
        const age = calculateAge(patient.dob);
        const vitalsData = getVitalsData(patient.patientId);

        // Patient Profile
        result[`${prefix}Id`] = patient.patientId;
        result[`${prefix}Name`] = patient.name;
        result[`${prefix}Record`] = `${patient.name} (${patient.patientId}) - Age: ${age}`;
        result[`${prefix}Age`] = age;
        result[`${prefix}DateOfBirth`] = patient.dob.toISOString().split("T")[0];
        result[`${prefix}Gender`] = patient.gender;
        result[`${prefix}Contact`] = patient.contact || "Not provided";
        result[`${prefix}Insurance`] = patient.insurance || "Not provided";
        result[`${prefix}DrugAllergies`] = patient.drugAllergies || "No known allergies";

        // Latest Vitals (BMI, SpO2, etc.) - from observations or vitals
        if (vitalsData) {
          result[`${prefix}BMI`] = vitalsData.bmi || "Not recorded";
          result[`${prefix}SpO2`] = vitalsData.spo2 || "Not recorded";
          result[`${prefix}BloodPressure`] = vitalsData.bloodPressure || "Not recorded";
          result[`${prefix}HeartRate`] = vitalsData.heartRate || "Not recorded";
          result[`${prefix}Temperature`] = vitalsData.temperature || "Not recorded";
          result[`${prefix}Weight`] = vitalsData.weight || "Not recorded";
          result[`${prefix}Height`] = vitalsData.height || "Not recorded";
          result[`${prefix}ObservationNote`] = vitalsData.note || "No note";
          result[`${prefix}VitalRecordedDate`] = vitalsData.recordedDate;
          result[`${prefix}VitalRecordedTime`] = vitalsData.recordedTime;
          result[`${prefix}VitalVisitId`] = vitalsData.visitId;
        } else {
          result[`${prefix}BMI`] = "Not recorded";
          result[`${prefix}SpO2`] = "Not recorded";
          result[`${prefix}BloodPressure`] = "Not recorded";
          result[`${prefix}HeartRate`] = "Not recorded";
          result[`${prefix}Temperature`] = "Not recorded";
          result[`${prefix}Weight`] = "Not recorded";
          result[`${prefix}Height`] = "Not recorded";
          result[`${prefix}ObservationNote`] = "No note";
        }
      });

      // Add latest patient info (most recent visit)
      if (patients.length > 0 && visits.length > 0) {
        const latestVisit = visits[0];
        const latestPatient = patients.find(p => p.patientId === latestVisit.patientId);
        if (latestPatient) {
          const age = calculateAge(latestPatient.dob);
          const vitalsData = getVitalsData(latestPatient.patientId);
          
          result.latestPatientId = latestPatient.patientId;
          result.latestPatientName = latestPatient.name;
          result.latestPatientRecord = `${latestPatient.name} (${latestPatient.patientId}) - Age: ${age}`;
          result.latestPatientAge = age;
          result.latestAge = age; // Additional age field for easy access
          result.latestVisitId = latestVisit.visitId;
          result.latestVisitDate = latestVisit.visitDate.toISOString().split("T")[0];
          
          if (vitalsData) {
            result.latestBMI = vitalsData.bmi || "Not recorded";
            result.latestSpO2 = vitalsData.spo2 || "Not recorded";
            result.latestBloodPressure = vitalsData.bloodPressure || "Not recorded";
            result.latestHeartRate = vitalsData.heartRate || "Not recorded";
            result.latestTemperature = vitalsData.temperature || "Not recorded";
            result.latestObservationNote = vitalsData.note || "No note";
          } else {
            result.latestBMI = "Not recorded";
            result.latestSpO2 = "Not recorded";
            result.latestBloodPressure = "Not recorded";
            result.latestHeartRate = "Not recorded";
            result.latestTemperature = "Not recorded";
            result.latestObservationNote = "No note";
          }
        }
      }

      res.json(result);
    } catch (error) {
      console.error("Doctor Agent Patient Record Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch patient record",
        msg: "Failed",
      });
    }
  }
);

// Clinical Documentation API - Returns comprehensive clinical documentation with observations, notes, vitals, etc.
router.post(
  "/clinical-doc",
  requireAuth,
  requireRole("Doctor"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body for doctorId
      const validationResult = MedicationAgentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorId } = validationResult.data;

      // Get doctor info
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        select: { doctorId: true, name: true, department: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      // Get visits for this doctor to find unique patients
      const visits = await prisma.visit.findMany({
        where: { doctorId },
        include: {
          doctor: true,
          patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
              contact: true,
              insurance: true,
              drugAllergies: true,
            },
          },
        },
        orderBy: { visitDate: "desc" },
      });

      // Get unique patient IDs from visits
      const uniquePatientIds = [...new Set(visits.map(v => v.patientId))];

      // Get all observations for this doctor with patient and visit info
      const observations = await prisma.observation.findMany({
        where: {
          doctorId,
          patientId: { in: uniquePatientIds },
        },
        include: {
          patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
            },
          },
          visit: {
            include: {
              doctor: true,
            },
          },
          doctor: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // Helper function to calculate age
      const calculateAge = (dob: Date): number => {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }
        return age;
      };

      // Build flat response structure
      const result: any = {
        // Doctor Information
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        doctorDepartment: doctor.department,

        // Summary counts
        totalObservations: observations.length,
        totalVisits: visits.length,
        totalPatients: uniquePatientIds.length,

        status: "Success",
      };

      // Add clinical documentation entries (observations with notes)
      observations.forEach((obs, index) => {
        const prefix = `clinicalDoc${index + 1}`;
        const patient = obs.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result[`${prefix}Id`] = obs.obsId;
        result[`${prefix}PatientId`] = obs.patientId;
        result[`${prefix}PatientName`] = patient?.name || "Unknown";
        result[`${prefix}PatientRecord`] = patient ? `${patient.name} (${obs.patientId}) - Age: ${age}` : "Unknown";
        result[`${prefix}PatientAge`] = age;
        result[`${prefix}VisitId`] = obs.visitId;
        result[`${prefix}VisitDate`] = obs.visit?.visitDate
          ? new Date(obs.visit.visitDate).toISOString().split("T")[0]
          : "Not available";
        result[`${prefix}Department`] = obs.visit?.department || "Not specified";
        result[`${prefix}Note`] = obs.noteText || "No note";
        result[`${prefix}ObservationNote`] = obs.noteText || "No note";
        result[`${prefix}ClinicalNote`] = obs.noteText || "No note";
        result[`${prefix}BMI`] = obs.bmi ? obs.bmi.toString() : "Not recorded";
        result[`${prefix}SpO2`] = obs.spo2 ? `${obs.spo2}%` : "Not recorded";
        result[`${prefix}BloodPressure`] = obs.bpSystolic && obs.bpDiastolic
          ? `${obs.bpSystolic}/${obs.bpDiastolic} mmHg`
          : "Not recorded";
        result[`${prefix}HeartRate`] = obs.heartRate ? `${obs.heartRate} bpm` : "Not recorded";
        result[`${prefix}Temperature`] = obs.temperatureC ? `${obs.temperatureC}°C` : "Not recorded";
        result[`${prefix}RecordedDate`] = obs.createdAt.toISOString().split("T")[0];
        result[`${prefix}RecordedTime`] = obs.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";
        result[`${prefix}DoctorName`] = obs.doctor?.name || obs.visit?.doctor?.name || "Unknown";
      });

      // Add latest clinical documentation entry
      if (observations.length > 0) {
        const latest = observations[0];
        const patient = latest.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result.latestClinicalDocId = latest.obsId;
        result.latestPatientId = latest.patientId;
        result.latestPatientName = patient?.name || "Unknown";
        result.latestPatientRecord = patient ? `${patient.name} (${latest.patientId}) - Age: ${age}` : "Unknown";
        result.latestPatientAge = age;
        result.latestVisitId = latest.visitId;
        result.latestVisitDate = latest.visit?.visitDate
          ? new Date(latest.visit.visitDate).toISOString().split("T")[0]
          : "Not available";
        result.latestNote = latest.noteText || "No note";
        result.latestObservationNote = latest.noteText || "No note";
        result.latestClinicalNote = latest.noteText || "No note";
        result.latestBMI = latest.bmi ? latest.bmi.toString() : "Not recorded";
        result.latestSpO2 = latest.spo2 ? `${latest.spo2}%` : "Not recorded";
        result.latestBloodPressure = latest.bpSystolic && latest.bpDiastolic
          ? `${latest.bpSystolic}/${latest.bpDiastolic} mmHg`
          : "Not recorded";
        result.latestHeartRate = latest.heartRate ? `${latest.heartRate} bpm` : "Not recorded";
        result.latestTemperature = latest.temperatureC ? `${latest.temperatureC}°C` : "Not recorded";
        result.latestRecordedDate = latest.createdAt.toISOString().split("T")[0];
        result.latestRecordedTime = latest.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";
      }

      res.json(result);
    } catch (error) {
      console.error("Doctor Agent Clinical Doc Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch clinical documentation",
        msg: "Failed",
      });
    }
  }
);

// Create Lab Order API - Allows doctors to create lab orders
router.post(
  "/lab-order",
  requireAuth,
  requireRole("Doctor"),
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
      const validationResult = DoctorAgentLabOrderSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const payload = validationResult.data;

      // Use doctorId from request body
      const doctorId = payload.doctorId;

      // Verify the doctorId exists and is valid
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        select: { doctorId: true, name: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      // Search for patient by name
      const patients = await prisma.patient.findMany({
        where: {
          name: {
            contains: payload.patientName.trim(),
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
          error: `No patient found with name matching "${payload.patientName}"`,
          msg: "Failed",
        });
      }

      if (patients.length > 1) {
        return res.status(400).json({
          error: "Multiple patients found with that name. Please provide a more specific patient name.",
          msg: "Failed",
          matches: patients.map(p => ({
            patientId: p.patientId,
            name: p.name,
          })),
        });
      }

      const patient = patients[0];

      // Parse date and time
      const visitDate = toDateOnly(payload.date);
      let startTimeMin: number;
      try {
        startTimeMin = toMinutes(payload.startTime);
      } catch (error) {
        return res.status(400).json({
          error: `Invalid time format: ${payload.startTime}. Please use 24-hour format (HH:MM, e.g., "16:00") or 12-hour format with AM/PM (e.g., "4:00 PM", "4:00PM", "4:00 AM", "4:00AM")`,
          msg: "Failed",
        });
      }

      // Create date range for the day (appointment.date is DateTime, so we need to query the entire day)
      // visitDate is already a Date object with time set to 00:00:00 UTC from toDateOnly
      const startOfDay = new Date(visitDate);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(visitDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      
      // Also create a date-only version for visit lookup (visitDate is stored as date-only in DB)
      const visitDateOnly = new Date(visitDate);
      visitDateOnly.setUTCHours(0, 0, 0, 0);

      // Find visit that matches patient, doctor, date, and time
      // First, find appointments for this patient, doctor, and date
      let appointments = await prisma.appointment.findMany({
        where: {
          patientId: patient.patientId,
          doctorId: doctorId,
          date: {
            gte: startOfDay,
            lte: endOfDay,
          },
          startTimeMin: startTimeMin,
          status: {
            not: 'Cancelled',
          },
        },
        select: {
          appointmentId: true,
          startTimeMin: true,
          date: true,
          status: true,
        },
      });

      // If no appointment found and time is ambiguous (less than 12 hours and no AM/PM in input),
      // try the PM version (add 12 hours)
      if (appointments.length === 0 && !payload.startTime.toUpperCase().includes('AM') && !payload.startTime.toUpperCase().includes('PM')) {
        const hours = Math.floor(startTimeMin / 60);
        if (hours < 12) {
          // Try PM version (add 12 hours)
          const pmTimeMin = startTimeMin + 12 * 60;
          appointments = await prisma.appointment.findMany({
            where: {
              patientId: patient.patientId,
              doctorId: doctorId,
              date: {
                gte: startOfDay,
                lte: endOfDay,
              },
              startTimeMin: pmTimeMin,
              status: {
                not: 'Cancelled',
              },
            },
            select: {
              appointmentId: true,
              startTimeMin: true,
              date: true,
              status: true,
            },
          });
          // Update startTimeMin to the PM version if found
          if (appointments.length > 0) {
            startTimeMin = pmTimeMin;
          }
        }
      }

      // Debug: Log what we found
      console.log(`[lab-order] Looking for appointment: patient=${patient.patientId}, doctor=${doctorId}, date=${payload.date}, time=${payload.startTime} (${startTimeMin} minutes)`);
      console.log(`[lab-order] Found ${appointments.length} appointments matching criteria`);

      // Find visit linked to the appointment or matching the criteria
      // visitDate is stored as date-only in DB, so we need to compare just the date part
      let visit = await prisma.visit.findFirst({
        where: {
          patientId: patient.patientId,
          doctorId: doctorId,
          visitDate: visitDateOnly,
        },
        select: {
          visitId: true,
          patientId: true,
          doctorId: true,
          visitDate: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // If no visit found but appointment exists, create a visit
      if (!visit && appointments.length > 0) {
        const appointment = appointments[0];
        // Get doctor info for department
        const doctorInfo = await prisma.doctor.findUnique({
          where: { doctorId },
          select: { department: true },
        });

        if (!doctorInfo) {
          return res.status(404).json({
            error: "Doctor not found",
            msg: "Failed",
          });
        }

        // Create a new visit for this appointment
        visit = await prisma.visit.create({
          data: {
            patientId: patient.patientId,
            doctorId: doctorId,
            visitDate: visitDate,
            department: doctorInfo.department,
            reason: null,
          },
          select: {
            visitId: true,
            patientId: true,
            doctorId: true,
            visitDate: true,
          },
        });
      }

      if (!visit) {
        // Check if appointment exists but was cancelled or doesn't match exactly
        const allAppointments = await prisma.appointment.findMany({
          where: {
            patientId: patient.patientId,
            doctorId: doctorId,
            date: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          select: {
            status: true,
            startTimeMin: true,
            date: true,
          },
        });

        console.log(`[lab-order] All appointments for patient ${patient.patientId}, doctor ${doctorId} on ${payload.date}:`, allAppointments.map(apt => ({
          status: apt.status,
          startTimeMin: apt.startTimeMin,
          time: `${Math.floor(apt.startTimeMin / 60)}:${String(apt.startTimeMin % 60).padStart(2, '0')}`,
        })));

        const exactMatch = allAppointments.find(apt => apt.startTimeMin === startTimeMin);
        const cancelledMatch = exactMatch && exactMatch.status === 'Cancelled';

        if (cancelledMatch) {
          return res.status(400).json({
            error: `Appointment for patient "${patient.name}" on ${payload.date} at ${payload.startTime} is cancelled. Cannot create lab order.`,
            msg: "Failed",
          });
        }

        if (allAppointments.length > 0) {
          // Appointment exists but time doesn't match exactly
          const times = allAppointments.map(apt => {
            const hours = Math.floor(apt.startTimeMin / 60);
            const minutes = apt.startTimeMin % 60;
            const period = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
            return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
          }).join(', ');
          return res.status(400).json({
            error: `Appointment found for patient "${patient.name}" on ${payload.date}, but time ${payload.startTime} (parsed as ${startTimeMin} minutes) doesn't match. Available times: ${times}. Please use 24-hour format (HH:MM) or 12-hour format with AM/PM (e.g., "4:00 PM" or "16:00").`,
            msg: "Failed",
          });
        }

        // Check if there are any appointments for this patient with this doctor on any date
        const anyAppointments = await prisma.appointment.findMany({
          where: {
            patientId: patient.patientId,
            doctorId: doctorId,
            status: {
              not: 'Cancelled',
            },
          },
          select: {
            date: true,
            startTimeMin: true,
            status: true,
          },
          take: 5,
          orderBy: {
            date: 'desc',
          },
        });

        if (anyAppointments.length > 0) {
          const recentDates = [...new Set(anyAppointments.map(apt => apt.date.toISOString().split('T')[0]))].slice(0, 3);
          return res.status(404).json({
            error: `No appointment found for patient "${patient.name}" on ${payload.date} at ${payload.startTime} with this doctor. Recent appointment dates: ${recentDates.join(', ')}. Please check the date and time. If using time without AM/PM, use 24-hour format (e.g., "16:00" for 4:00 PM) or include AM/PM (e.g., "4:00 PM").`,
            msg: "Failed",
          });
        }

        return res.status(404).json({
          error: `No appointment or visit found for patient "${patient.name}" on ${payload.date} at ${payload.startTime} with this doctor. Please ensure the appointment exists and is not cancelled. If using time without AM/PM, use 24-hour format (e.g., "16:00" for 4:00 PM) or include AM/PM (e.g., "4:00 PM").`,
          msg: "Failed",
        });
      }

      // Verify visit belongs to the doctor
      if (visit.doctorId !== doctorId) {
        return res.status(403).json({
          error: "Visit does not belong to this doctor",
          msg: "Failed",
        });
      }

      // Create lab order payload with visitId and patientId
      const labOrderPayload = {
        visitId: visit.visitId,
        patientId: patient.patientId,
        priority: payload.priority,
        notes: payload.notes,
        items: payload.items,
      };

      // Create lab order using the lab service
      const labOrder = await labService.createLabOrder(doctorId, labOrderPayload);

      // Notify Atenxion agent about lab order creation (doctor-specific)
      try {
        const { recordAtenxionTransactionForDoctor } = await import("../services/atenxion.js");
        await recordAtenxionTransactionForDoctor(doctorId);
        console.log("Atenxion transaction recorded for lab order creation:", labOrder.labOrderId);
      } catch (error) {
        console.warn("Failed to record Atenxion transaction for lab order creation:", error);
        // Don't fail the request if Atenxion notification fails
      }

      res.status(201).json({
        labOrderId: labOrder.labOrderId,
        visitId: labOrder.visitId,
        patientId: labOrder.patientId,
        patientName: patient.name,
        doctorId: labOrder.doctorId,
        status: labOrder.status,
        priority: labOrder.priority,
        notes: labOrder.notes,
        createdAt: labOrder.createdAt,
        items: labOrder.items.map((item) => ({
          labOrderItemId: item.labOrderItemId,
          testCode: item.testCode,
          testName: item.testName,
          status: item.status,
          specimen: item.specimen,
          notes: item.notes,
        })),
        msg: "Success",
      });
    } catch (error) {
      console.error("Doctor Agent Create Lab Order Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create lab order",
        msg: "Failed",
      });
    }
  }
);

// Medication Agent API - Returns medications/prescriptions given by the doctor to patients
router.post(
  "/medication",
  requireAuth,
  requireRole("Doctor"),
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
      const validationResult = MedicationAgentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorId } = validationResult.data;

      // Get doctor info
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        select: { doctorId: true, name: true, department: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      // Get all prescriptions for this doctor with related data
      const prescriptions = await prisma.prescription.findMany({
        where: { doctorId },
        include: {
          patient: {
            select: {
              patientId: true,
              name: true,
              dob: true,
              gender: true,
            },
          },
          visit: {
            select: {
              visitId: true,
              visitDate: true,
              department: true,
            },
          },
          items: {
            include: {
              drug: {
                select: {
                  drugId: true,
                  name: true,
                  genericName: true,
                  form: true,
                  strength: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Helper function to calculate age
      const calculateAge = (dob: Date): number => {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }
        return age;
      };

      // Build flat response structure
      const result: any = {
        // Doctor Information
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        doctorDepartment: doctor.department,

        // Summary counts
        totalPrescriptions: prescriptions.length,
        totalMedications: prescriptions.reduce((sum, rx) => sum + rx.items.length, 0),

        status: "Success",
      };

      // Add unique patient names summary
      const uniquePatients = new Set<string>();
      prescriptions.forEach((rx) => {
        if (rx.patient?.name) {
          uniquePatients.add(rx.patient.name);
        }
      });
      result.uniquePatientNames = Array.from(uniquePatients).join(", ");
      result.uniquePatientCount = uniquePatients.size;

      // Group prescriptions by patient name (case-insensitive), fallback to patientId if name is missing
      const patientMap = new Map<string, Array<{ prescription: any; item: any; patientId: string }>>();
      
      prescriptions.forEach((prescription) => {
        const patientName = prescription.patient?.name;
        const patientId = prescription.patientId;
        
        // Use patient name if available, otherwise use patientId as the key
        const groupKey = patientName 
          ? patientName.toLowerCase().trim() 
          : `patient_${patientId}`;
        
        if (!patientMap.has(groupKey)) {
          patientMap.set(groupKey, []);
        }
        prescription.items.forEach((item: any) => {
          patientMap.get(groupKey)!.push({ prescription, item, patientId });
        });
      });

      // Flatten by patient name, then by medication
      let patientIndex = 0;
      patientMap.forEach((medications, normalizedName) => {
        patientIndex++;
        const patientPrefix = `patient${patientIndex}`;
        const firstPrescription = medications[0].prescription;
        const patient = firstPrescription.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        // Get all unique patient IDs for this patient name (in case there are duplicates)
        const uniquePatientIds = [...new Set(medications.map(m => m.patientId))];
        const primaryPatientId = uniquePatientIds[0]; // Use first patient ID as primary

        // Patient info (once per patient name)
        result[`${patientPrefix}PatientId`] = primaryPatientId;
        result[`${patientPrefix}PatientName`] = patient?.name || "Unknown";
        result[`${patientPrefix}PatientRecord`] = patient ? `${patient.name} (${primaryPatientId}) - Age: ${age}` : "Unknown";
        result[`${patientPrefix}PatientAge`] = age;
        result[`${patientPrefix}PatientGender`] = patient?.gender || "Unknown";
        result[`${patientPrefix}TotalMedications`] = medications.length;

        // Medications for this patient
        medications.forEach((med, medIndex) => {
          const medicationIndex = medIndex + 1;
          const prefix = `${patientPrefix}Medicine${medicationIndex}`;
          const prescription = med.prescription;
          const item = med.item;

          // Prescription info
          result[`${prefix}PrescriptionId`] = prescription.prescriptionId;
          result[`${prefix}PrescriptionStatus`] = prescription.status;
          result[`${prefix}PrescriptionNotes`] = prescription.notes || "No notes";
          result[`${prefix}PrescriptionCreatedAt`] = prescription.createdAt.toISOString().split("T")[0];
          result[`${prefix}PrescriptionCreatedTime`] = prescription.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";

          // Visit info
          result[`${prefix}VisitId`] = prescription.visitId;
          result[`${prefix}VisitDate`] = prescription.visit?.visitDate
            ? new Date(prescription.visit.visitDate).toISOString().split("T")[0]
            : "Not available";
          result[`${prefix}Department`] = prescription.visit?.department || "Not specified";

          // Drug/Medication info
          result[`${prefix}DrugId`] = item.drugId;
          result[`${prefix}DrugName`] = item.drug.name;
          result[`${prefix}GenericName`] = item.drug.genericName || "Not specified";
          result[`${prefix}DrugForm`] = item.drug.form;
          result[`${prefix}DrugStrength`] = item.drug.strength;
          result[`${prefix}MedicationName`] = `${item.drug.name} ${item.drug.strength}`.trim();
          result[`${prefix}MedicationFullName`] = `${item.drug.name} ${item.drug.strength} (${item.drug.form})`.trim();

          // Prescription item details
          result[`${prefix}ItemId`] = item.itemId;
          result[`${prefix}Dose`] = item.dose;
          result[`${prefix}Route`] = item.route;
          result[`${prefix}Frequency`] = item.frequency;
          result[`${prefix}DurationDays`] = item.durationDays;
          result[`${prefix}QuantityPrescribed`] = item.quantityPrescribed;
          result[`${prefix}IsPRN`] = item.prn ? "Yes" : "No";
          result[`${prefix}AllowGeneric`] = item.allowGeneric ? "Yes" : "No";
          result[`${prefix}ItemNotes`] = item.notes || "No notes";

          // Combined medication instruction
          result[`${prefix}Instruction`] = `${item.dose} ${item.route}, ${item.frequency}${item.prn ? " (PRN)" : ""} for ${item.durationDays} day(s)`;
        });
      });

      result.totalPatients = patientIndex;

      // Add latest medication info (most recent prescription item)
      if (prescriptions.length > 0 && prescriptions[0].items.length > 0) {
        const latestPrescription = prescriptions[0];
        const latestItem = latestPrescription.items[0];
        const patient = latestPrescription.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result.latestPrescriptionId = latestPrescription.prescriptionId;
        result.latestPatientId = latestPrescription.patientId;
        result.latestPatientName = patient?.name || "Unknown";
        result.latestPatientRecord = patient ? `${patient.name} (${latestPrescription.patientId}) - Age: ${age}` : "Unknown";
        result.latestPatientAge = age;
        result.latestVisitId = latestPrescription.visitId;
        result.latestVisitDate = latestPrescription.visit?.visitDate
          ? new Date(latestPrescription.visit.visitDate).toISOString().split("T")[0]
          : "Not available";
        result.latestDrugName = latestItem.drug.name;
        result.latestMedicationName = `${latestItem.drug.name} ${latestItem.drug.strength}`.trim();
        result.latestDose = latestItem.dose;
        result.latestRoute = latestItem.route;
        result.latestFrequency = latestItem.frequency;
        result.latestInstruction = `${latestItem.dose} ${latestItem.route}, ${latestItem.frequency}${latestItem.prn ? " (PRN)" : ""} for ${latestItem.durationDays} day(s)`;
        result.latestPrescriptionStatus = latestPrescription.status;
        result.latestPrescriptionCreatedAt = latestPrescription.createdAt.toISOString().split("T")[0];
      }

      res.json(result);
    } catch (error) {
      console.error("Doctor Agent Medication Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch medication records",
        msg: "Failed",
      });
    }
  }
);

// Doctor Profile API - Returns doctor profile information and statistics
router.post(
  "/doctor-profile",
  requireAuth,
  requireRole("Doctor"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body for doctorId
      const validationResult = MedicationAgentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorId } = validationResult.data;

      // Get doctor info with user account if linked
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        include: {
          user: {
            select: {
              userId: true,
              email: true,
              role: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      // Get statistics
      const [totalPatients, totalVisits, totalAppointments, totalPrescriptions, totalObservations] = await Promise.all([
        prisma.visit.findMany({
          where: { doctorId },
          select: { patientId: true },
          distinct: ['patientId'],
        }).then(visits => visits.length),
        prisma.visit.count({ where: { doctorId } }),
        prisma.appointment.count({ where: { doctorId } }),
        prisma.prescription.count({ where: { doctorId } }),
        prisma.observation.count({ where: { doctorId } }),
      ]);

      // Get availability info
      const availabilities = await prisma.doctorAvailability.findMany({
        where: { doctorId },
        orderBy: { dayOfWeek: 'asc' },
      });

      // Get recent appointments count (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentAppointments = await prisma.appointment.count({
        where: {
          doctorId,
          date: { gte: thirtyDaysAgo },
        },
      });

      // Build flat response structure
      const result: any = {
        status: "Success",
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        doctorDepartment: doctor.department,
        doctorCreatedAt: doctor.createdAt.toISOString().split("T")[0],
        doctorCreatedTime: doctor.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00",
        
        // User account info (if linked)
        hasUserAccount: !!doctor.user,
        userId: doctor.user?.userId || null,
        userEmail: doctor.user?.email || null,
        userRole: doctor.user?.role || null,
        userStatus: doctor.user?.status || null,
        userCreatedAt: doctor.user?.createdAt ? doctor.user.createdAt.toISOString().split("T")[0] : null,

        // Statistics
        totalPatients,
        totalVisits,
        totalAppointments,
        totalPrescriptions,
        totalObservations,
        recentAppointmentsLast30Days: recentAppointments,

        // Availability
        totalAvailabilitySlots: availabilities.length,
      };

      // Add availability details
      availabilities.forEach((avail, index) => {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const prefix = `availability${index + 1}`;
        const hours = Math.floor(avail.startMin / 60);
        const minutes = avail.startMin % 60;
        const endHours = Math.floor(avail.endMin / 60);
        const endMinutes = avail.endMin % 60;
        
        result[`${prefix}DayOfWeek`] = avail.dayOfWeek;
        result[`${prefix}DayName`] = dayNames[avail.dayOfWeek];
        result[`${prefix}StartTime`] = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        result[`${prefix}EndTime`] = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
        result[`${prefix}StartMin`] = avail.startMin;
        result[`${prefix}EndMin`] = avail.endMin;
      });

      res.json(result);
    } catch (error) {
      console.error("Doctor Agent Profile Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch doctor profile",
        msg: "Failed",
      });
    }
  }
);

// Doctor Appointments Queue API - Returns upcoming appointments and today's queue
router.post(
  "/appointments-queue",
  requireAuth,
  requireRole("Doctor"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      // Validate request body for doctorId
      const validationResult = MedicationAgentSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorId } = validationResult.data;

      // Get doctor info
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        select: { doctorId: true, name: true, department: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      // Get today's date at midnight UTC
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      
      // Get today's appointments (queue)
      const todayAppointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          date: todayUTC,
          status: { in: ['Scheduled', 'CheckedIn', 'InProgress'] },
        },
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
        },
        orderBy: [
          { startTimeMin: 'asc' },
        ],
      });

      // Get upcoming appointments (next 30 days, excluding today)
      const thirtyDaysFromNow = new Date(todayUTC);
      thirtyDaysFromNow.setUTCDate(thirtyDaysFromNow.getUTCDate() + 30);
      
      const upcomingAppointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          date: {
            gt: todayUTC,
            lt: thirtyDaysFromNow,
          },
          status: { in: ['Scheduled', 'CheckedIn', 'InProgress'] },
        },
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
        },
        orderBy: [
          { date: 'asc' },
          { startTimeMin: 'asc' },
        ],
      });

      // Helper function to calculate age
      const calculateAge = (dob: Date): number => {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }
        return age;
      };

      // Helper function to format time from minutes
      const formatTime = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      };

      // Build flat response structure
      const result: any = {
        status: "Success",
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        doctorDepartment: doctor.department,
        todayDate: todayUTC.toISOString().split("T")[0],
        
        // Today's queue summary
        todayQueueTotal: todayAppointments.length,
        todayQueueScheduled: todayAppointments.filter(a => a.status === 'Scheduled').length,
        todayQueueCheckedIn: todayAppointments.filter(a => a.status === 'CheckedIn').length,
        todayQueueInProgress: todayAppointments.filter(a => a.status === 'InProgress').length,
        
        // Upcoming appointments summary
        upcomingAppointmentsTotal: upcomingAppointments.length,
      };

      // Add today's queue appointments
      todayAppointments.forEach((appointment, index) => {
        const prefix = `todayQueue${index + 1}`;
        const patient = appointment.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result[`${prefix}AppointmentId`] = appointment.appointmentId;
        result[`${prefix}PatientId`] = appointment.patientId;
        result[`${prefix}PatientName`] = patient?.name || "Unknown";
        result[`${prefix}PatientRecord`] = patient ? `${patient.name} (${appointment.patientId}) - Age: ${age}` : "Unknown";
        result[`${prefix}PatientAge`] = age;
        result[`${prefix}PatientGender`] = patient?.gender || "Unknown";
        result[`${prefix}PatientContact`] = patient?.contact || "Not provided";
        result[`${prefix}Date`] = appointment.date.toISOString().split("T")[0];
        result[`${prefix}StartTime`] = formatTime(appointment.startTimeMin);
        result[`${prefix}EndTime`] = formatTime(appointment.endTimeMin);
        result[`${prefix}StartTimeMin`] = appointment.startTimeMin;
        result[`${prefix}EndTimeMin`] = appointment.endTimeMin;
        result[`${prefix}Status`] = appointment.status;
        result[`${prefix}Reason`] = appointment.reason || "Not specified";
        result[`${prefix}Location`] = appointment.location || "Not specified";
        result[`${prefix}Department`] = appointment.department;
      });

      // Add upcoming appointments
      upcomingAppointments.forEach((appointment, index) => {
        const prefix = `upcoming${index + 1}`;
        const patient = appointment.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result[`${prefix}AppointmentId`] = appointment.appointmentId;
        result[`${prefix}PatientId`] = appointment.patientId;
        result[`${prefix}PatientName`] = patient?.name || "Unknown";
        result[`${prefix}PatientRecord`] = patient ? `${patient.name} (${appointment.patientId}) - Age: ${age}` : "Unknown";
        result[`${prefix}PatientAge`] = age;
        result[`${prefix}PatientGender`] = patient?.gender || "Unknown";
        result[`${prefix}PatientContact`] = patient?.contact || "Not provided";
        result[`${prefix}Date`] = appointment.date.toISOString().split("T")[0];
        result[`${prefix}StartTime`] = formatTime(appointment.startTimeMin);
        result[`${prefix}EndTime`] = formatTime(appointment.endTimeMin);
        result[`${prefix}StartTimeMin`] = appointment.startTimeMin;
        result[`${prefix}EndTimeMin`] = appointment.endTimeMin;
        result[`${prefix}Status`] = appointment.status;
        result[`${prefix}Reason`] = appointment.reason || "Not specified";
        result[`${prefix}Location`] = appointment.location || "Not specified";
        result[`${prefix}Department`] = appointment.department;
      });

      // Add latest/next appointment info
      if (todayAppointments.length > 0) {
        const nextToday = todayAppointments[0];
        const patient = nextToday.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result.nextTodayAppointmentId = nextToday.appointmentId;
        result.nextTodayPatientId = nextToday.patientId;
        result.nextTodayPatientName = patient?.name || "Unknown";
        result.nextTodayPatientRecord = patient ? `${patient.name} (${nextToday.patientId}) - Age: ${age}` : "Unknown";
        result.nextTodayPatientAge = age;
        result.nextTodayStartTime = formatTime(nextToday.startTimeMin);
        result.nextTodayEndTime = formatTime(nextToday.endTimeMin);
        result.nextTodayStatus = nextToday.status;
        result.nextTodayReason = nextToday.reason || "Not specified";
      }

      if (upcomingAppointments.length > 0) {
        const nextUpcoming = upcomingAppointments[0];
        const patient = nextUpcoming.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        result.nextUpcomingAppointmentId = nextUpcoming.appointmentId;
        result.nextUpcomingPatientId = nextUpcoming.patientId;
        result.nextUpcomingPatientName = patient?.name || "Unknown";
        result.nextUpcomingPatientRecord = patient ? `${patient.name} (${nextUpcoming.patientId}) - Age: ${age}` : "Unknown";
        result.nextUpcomingPatientAge = age;
        result.nextUpcomingDate = nextUpcoming.date.toISOString().split("T")[0];
        result.nextUpcomingStartTime = formatTime(nextUpcoming.startTimeMin);
        result.nextUpcomingEndTime = formatTime(nextUpcoming.endTimeMin);
        result.nextUpcomingStatus = nextUpcoming.status;
        result.nextUpcomingReason = nextUpcoming.reason || "Not specified";
      }

      res.json(result);
    } catch (error) {
      console.error("Doctor Agent Appointments Queue Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch appointments queue",
        msg: "Failed",
      });
    }
  }
);

// Validation schema for clinical documentation creation
const CreateClinicalDocSchema = z.object({
  // visitId is optional - if not provided, will create new visit with patientId, visitDate, and doctorId
  visitId: z.string().uuid().optional(),
  // Visit creation fields (required if visitId is not provided and you want to create clinical docs)
  patientId: z.string().uuid().optional(),
  visitDate: z.coerce.date().optional(),
  doctorId: z.string().uuid().optional(), // Required if visitId is not provided
  startTime: z.union([z.string(), z.number().int().min(0).max(1439)]).optional(), // Time as string (HH:MM) or minutes from midnight
  // Clinical documentation fields
  diagnoses: z.array(z.object({
    diagnosis: z.string().min(1),
  })).optional(),
  prescriptions: z.array(z.object({
    drugName: z.string().min(1), // Accept drugName instead of drugId
    dose: z.string().optional().default(""),
    route: z.string().optional().default("Oral"),
    frequency: z.string().optional().default("OD"),
    durationDays: z.number().int().positive().max(365).optional().default(1),
    quantityPrescribed: z.number().int().positive().max(1000).optional().default(1),
    prn: z.boolean().optional().default(false),
    allowGeneric: z.boolean().optional().default(true),
    notes: z.string().max(300).optional(),
  })).optional(),
  labResults: z.array(z.object({
    testName: z.string().min(1),
    value: z.number().optional(),
    unit: z.string().optional(),
  })).optional(),
  observationNote: z.object({
    noteText: z.string().optional(),
    bpSystolic: z.number().int().optional(),
    bpDiastolic: z.number().int().optional(),
    heartRate: z.number().int().optional(),
    temperatureC: z.number().optional(),
    spo2: z.number().int().optional(),
    bmi: z.number().optional(),
  }).optional(),
}).refine(
  (data) => {
    // If visitId is provided, we're good
    if (data.visitId) {
      return true;
    }
    // If no visitId but we have clinical docs to save, we need patientId, visitDate, and doctorId to create a visit
    const hasClinicalDocs = 
      (data.diagnoses && data.diagnoses.length > 0) ||
      (data.prescriptions && data.prescriptions.length > 0) ||
      (data.labResults && data.labResults.length > 0) ||
      (data.observationNote && (
        data.observationNote.noteText?.trim() ||
        data.observationNote.bpSystolic !== undefined ||
        data.observationNote.bpDiastolic !== undefined ||
        data.observationNote.heartRate !== undefined ||
        data.observationNote.temperatureC !== undefined ||
        data.observationNote.spo2 !== undefined ||
        data.observationNote.bmi !== undefined
      ));
    
    // If there's no visitId and no clinical docs, that's fine (empty request)
    if (!hasClinicalDocs) {
      return true;
    }
    
    // If there are clinical docs but no visitId, we need patientId, visitDate, and doctorId
    return !!(data.patientId && data.visitDate && data.doctorId);
  },
  {
    message: "If visitId is not provided and you want to save clinical documentation, patientId, visitDate, and doctorId are required to create a visit.",
  }
);

// Create Clinical Documentation API - Creates diagnoses, prescriptions, lab results, and observations
router.post(
  "/create-clinical-doc",
  requireAuth,
  requireRole("Doctor"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          msg: "Failed",
        });
      }

      const doctorId = user.doctorId;
      console.log("doctorId", doctorId);
      if (!doctorId) {
        return res.status(403).json({
          error: "User is not linked to a doctor profile",
          msg: "Failed",
        });
      }

      // Validate request body
      const validationResult = CreateClinicalDocSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const payload = validationResult.data;

      // Note: We always use the authenticated doctor's ID (doctorId from user)
      // The doctorId in request body is optional and ignored - we use the authenticated doctor's ID
      // If doctorId is provided but doesn't match, we just ignore it and use the authenticated one
      if (payload.doctorId && payload.doctorId !== doctorId) {
        console.warn(`[create-clinical-doc] doctorId in request body (${payload.doctorId}) does not match authenticated doctor (${doctorId}). Using authenticated doctor's ID.`);
      }

      // Wrap all database operations in a transaction for atomicity
      const transactionResult = await prisma.$transaction(async (tx) => {
        let visit: { visitId: string; patientId: string; doctorId: string } | null = null;
        let isNewVisit = false;

        // If visitId is provided, use existing visit
        if (payload.visitId) {
          visit = await tx.visit.findUnique({
            where: { visitId: payload.visitId },
            select: { visitId: true, patientId: true, doctorId: true },
          });

          if (!visit) {
            throw new Error("Visit not found");
          }

          if (visit.doctorId !== doctorId) {
            throw new Error("Visit does not belong to this doctor");
          }
        } else {
          // Create new visit if visitId is not provided
          // Verify patient exists
          if (!payload.patientId) {
            throw new Error("Patient ID is required when creating a new visit");
          }
          
          const patient = await tx.patient.findUnique({
            where: { patientId: payload.patientId },
            select: { patientId: true, name: true },
          });

          if (!patient) {
            throw new Error("Patient not found");
          }

          // Use doctorId from request body if provided, otherwise use authenticated doctor's ID
          const visitDoctorId = payload.doctorId || doctorId;

          // Get doctor's department from database
          const doctor = await tx.doctor.findUnique({
            where: { doctorId: visitDoctorId },
            select: { department: true, name: true },
          });

          if (!doctor) {
            throw new Error("Doctor not found");
          }

          // Check if doctor has an appointment with this patient for the given date
          if (!payload.visitDate) {
            throw new Error("Visit date is required when creating a new visit");
          }

          const visitDate = payload.visitDate instanceof Date 
            ? payload.visitDate 
            : new Date(payload.visitDate);
          const appointmentDateOnly = toDateOnly(visitDate.toISOString().slice(0, 10));
          
          // Parse startTime if provided (for more precise appointment matching)
          let startTimeMin: number | null = null;
          if (payload.startTime !== undefined) {
            if (typeof payload.startTime === 'string') {
              try {
                startTimeMin = toMinutes(payload.startTime);
              } catch (error) {
                console.warn(`[create-clinical-doc] Invalid startTime format: ${payload.startTime}`);
              }
            } else if (typeof payload.startTime === 'number') {
              startTimeMin = payload.startTime;
            }
          }

          // Build where clause for appointment check
          const startOfDay = new Date(appointmentDateOnly);
          startOfDay.setUTCHours(0, 0, 0, 0);
          const endOfDay = new Date(appointmentDateOnly);
          endOfDay.setUTCDate(endOfDay.getUTCDate() + 1); // Next day (exclusive)
          endOfDay.setUTCHours(0, 0, 0, 0);

          const appointmentWhere: any = {
            patientId: payload.patientId,
            doctorId: visitDoctorId,
            date: {
              gte: startOfDay,
              lt: endOfDay,
            },
            status: {
              not: 'Cancelled', // Only check non-cancelled appointments
            },
          };

          // If startTime is provided, match appointments with that specific start time
          if (startTimeMin !== null) {
            appointmentWhere.startTimeMin = startTimeMin;
          }

          // Check if appointment exists
          const existingAppointment = await tx.appointment.findFirst({
            where: appointmentWhere,
            select: {
              appointmentId: true,
              status: true,
              startTimeMin: true,
            },
          });

          if (!existingAppointment) {
            const patientName = patient.name || "the patient";
            const doctorName = doctor.name || "the doctor";
            const dateStr = appointmentDateOnly.toISOString().slice(0, 10);
            const timeStr = startTimeMin !== null 
              ? ` at ${Math.floor(startTimeMin / 60)}:${String(startTimeMin % 60).padStart(2, '0')}` 
              : "";
            
            throw new Error(
              `No appointment found between ${doctorName} and ${patientName} on ${dateStr}${timeStr}. ` +
              `Please ensure the doctor has a scheduled appointment with this patient before creating clinical documentation.`
            );
          }

          // Create the visit using the specified doctorId (from request or authenticated)
          // Department is fetched from doctor profile, reason is set to null
          const newVisit = await tx.visit.create({
            data: {
              patientId: payload.patientId,
              visitDate: payload.visitDate!,
              doctorId: visitDoctorId,
              department: doctor.department,
              reason: null,
            },
            select: { visitId: true, patientId: true, doctorId: true },
          });

          visit = newVisit;
          isNewVisit = true;
        }

        // At this point, visit is guaranteed to be non-null
        if (!visit) {
          throw new Error("Failed to get or create visit");
        }

        const results: any = {
          status: "Success",
          visitId: visit.visitId,
          patientId: visit.patientId,
          doctorId: doctorId,
        };

        // Create diagnoses
        if (payload.diagnoses && payload.diagnoses.length > 0) {
          const createdDiagnoses = await Promise.all(
            payload.diagnoses.map((diag) =>
              tx.diagnosis.create({
                data: {
                  visitId: visit!.visitId,
                  diagnosis: diag.diagnosis,
                },
              })
            )
          );
          results.diagnoses = createdDiagnoses.map((d) => ({
            diagId: d.diagId,
            diagnosis: d.diagnosis,
          }));
          results.diagnosesCount = createdDiagnoses.length;
        } else {
          results.diagnoses = [];
          results.diagnosesCount = 0;
        }

        // Create prescriptions
        if (payload.prescriptions && payload.prescriptions.length > 0) {
          try {
            // Look up drugs by name for each prescription (outside transaction for read)
            const prescriptionItems = await Promise.all(
              payload.prescriptions.map(async (rx) => {
                // Search for drug by name (case-insensitive, partial match)
                const drugs = await prisma.drug.findMany({
                  where: {
                    isActive: true,
                    OR: [
                      { name: { contains: rx.drugName, mode: 'insensitive' } },
                      { genericName: { contains: rx.drugName, mode: 'insensitive' } },
                    ],
                  },
                  take: 1,
                  orderBy: { name: 'asc' },
                });

                if (drugs.length === 0) {
                  throw new Error(`Drug not found: "${rx.drugName}". Please check the drug name.`);
                }

                const drug = drugs[0];
                return {
                  drugId: drug.drugId,
                  dose: rx.dose || "",
                  route: rx.route || "Oral",
                  frequency: rx.frequency || "OD",
                  durationDays: rx.durationDays || 1,
                  quantityPrescribed: rx.quantityPrescribed || 1,
                  prn: rx.prn || false,
                  allowGeneric: rx.allowGeneric !== undefined ? rx.allowGeneric : true,
                  notes: rx.notes,
                };
              })
            );

            // Check allergies
            const drugIds = prescriptionItems.map((item) => item.drugId);
            const drugs = await tx.drug.findMany({ where: { drugId: { in: drugIds } } });
            const drugNames = drugs.map((drug) => `${drug.name} ${drug.strength}`.trim());
            const allergyHits: string[] = [];
            if (visit.patientId) {
              const patient = await tx.patient.findUnique({
                where: { patientId: visit.patientId },
                select: { drugAllergies: true },
              });
              if (patient?.drugAllergies) {
                const allergies = String(patient.drugAllergies)
                  .split(/[,;\n]+/)
                  .map((a) => a.trim().toLowerCase())
                  .filter(Boolean);
                drugNames.forEach((drugName) => {
                  const lowerDrug = drugName.toLowerCase();
                  if (allergies.some((allergy) => lowerDrug.includes(allergy) || allergy.includes(lowerDrug))) {
                    allergyHits.push(drugName);
                  }
                });
              }
            }

            // Create prescription within transaction
            const prescription = await tx.prescription.create({
              data: {
                visitId: visit.visitId,
                doctorId: doctorId,
                patientId: visit.patientId,
                notes: null,
                items: {
                  create: prescriptionItems.map((item) => ({
                    drugId: item.drugId,
                    dose: item.dose || "",
                    route: item.route || "Oral",
                    frequency: item.frequency || "OD",
                    durationDays: item.durationDays || 1,
                    quantityPrescribed: item.quantityPrescribed || 1,
                    prn: Boolean(item.prn),
                    allowGeneric: item.allowGeneric ?? true,
                    notes: item.notes ?? null,
                  })),
                },
              },
              include: { items: { include: { drug: true } } },
            });

            // Also create Medication records for "Past Medications (Visit History)" display
            // This ensures medications show up in the patient portal's visit history
            const createdMedications = await Promise.all(
              prescription.items.map(async (item) => {
                const drug = item.drug;
                const drugName = drug ? `${drug.name} ${drug.strength}`.trim() : 'Unknown medication';
                const dosage = [item.dose, item.route, item.frequency]
                  .filter(Boolean)
                  .join(' ');
                const instructions = [
                  item.frequency,
                  item.durationDays ? `for ${item.durationDays} days` : null,
                  item.prn ? 'PRN' : null,
                  item.notes,
                ]
                  .filter(Boolean)
                  .join(' - ');

                return tx.medication.create({
                  data: {
                    visitId: visit!.visitId,
                    drugName: drugName,
                    dosage: dosage || null,
                    instructions: instructions || null,
                  },
                });
              })
            );

            results.prescription = {
              prescriptionId: prescription.prescriptionId,
              status: prescription.status,
              itemsCount: prescription.items.length,
            };
            results.prescriptionsCount = 1;
            results.medicationsCreated = createdMedications.length;
            if (allergyHits.length > 0) {
              results.allergyHits = allergyHits;
            }
          } catch (error) {
            results.prescriptionError = error instanceof Error ? error.message : "Failed to create prescription";
            results.prescriptionsCount = 0;
          }
        } else {
          results.prescriptionsCount = 0;
        }

        // Create lab results
        if (payload.labResults && payload.labResults.length > 0) {
          const createdLabResults = await Promise.all(
            payload.labResults.map((lab) =>
              tx.visitLabResult.create({
                data: {
                  visitId: visit!.visitId,
                  testName: lab.testName,
                  resultValue: lab.value || null,
                  unit: lab.unit || null,
                },
              })
            )
          );
          results.labResults = createdLabResults.map((lr) => ({
            labId: lr.labId,
            testName: lr.testName,
            resultValue: lr.resultValue,
            unit: lr.unit,
          }));
          results.labResultsCount = createdLabResults.length;
        } else {
          results.labResults = [];
          results.labResultsCount = 0;
        }

        // Create observation note with vitals
        if (payload.observationNote) {
          const obsData = payload.observationNote;
          // At least one field must be provided
          if (
            obsData.noteText?.trim() ||
            obsData.bpSystolic !== undefined ||
            obsData.bpDiastolic !== undefined ||
            obsData.heartRate !== undefined ||
            obsData.temperatureC !== undefined ||
            obsData.spo2 !== undefined ||
            obsData.bmi !== undefined
          ) {
            const observation = await tx.observation.create({
              data: {
                visitId: visit!.visitId,
                patientId: visit.patientId,
                doctorId: doctorId,
                noteText: obsData.noteText?.trim() || "Vitals recorded",
                bpSystolic: obsData.bpSystolic || null,
                bpDiastolic: obsData.bpDiastolic || null,
                heartRate: obsData.heartRate || null,
                temperatureC: obsData.temperatureC || null,
                spo2: obsData.spo2 || null,
                bmi: obsData.bmi || null,
              },
            });

            results.observation = {
              obsId: observation.obsId,
              noteText: observation.noteText,
              bpSystolic: observation.bpSystolic,
              bpDiastolic: observation.bpDiastolic,
              heartRate: observation.heartRate,
              temperatureC: observation.temperatureC,
              spo2: observation.spo2,
              bmi: observation.bmi,
            };
            results.observationCreated = true;
          } else {
            results.observationCreated = false;
            results.observationError = "At least one observation field must be provided";
          }
        } else {
          results.observationCreated = false;
        }

        // Find and update related appointments to "Completed" status
        // This simulates the "Save & Complete" button behavior
        let appointmentDateOnly: Date | null = null;
        
        if (payload.visitId) {
          // If using existing visit, get the visit date
          const visitWithDate = await tx.visit.findUnique({
            where: { visitId: visit!.visitId },
            select: { visitDate: true },
          });
          if (visitWithDate?.visitDate) {
            appointmentDateOnly = toDateOnly(visitWithDate.visitDate.toISOString().slice(0, 10));
          }
        } else if (payload.visitDate) {
          // If creating new visit, use the provided visitDate (zod coerces it to Date)
          const visitDate = payload.visitDate instanceof Date 
            ? payload.visitDate 
            : new Date(payload.visitDate);
          appointmentDateOnly = toDateOnly(visitDate.toISOString().slice(0, 10));
        }

        if (appointmentDateOnly) {
          // Find matching appointments that are not already completed or cancelled
          // Use date range to match appointments for the entire day (like queue endpoint)
          // appointment.date is DateTime, so we need to match the entire day range
          const startOfDay = new Date(appointmentDateOnly);
          startOfDay.setUTCHours(0, 0, 0, 0);
          const endOfDay = new Date(appointmentDateOnly);
          endOfDay.setUTCDate(endOfDay.getUTCDate() + 1); // Next day (exclusive)
          endOfDay.setUTCHours(0, 0, 0, 0);
          
          // Parse startTime if provided (for more precise appointment matching)
          let startTimeMin: number | null = null;
          if (payload.startTime !== undefined) {
            if (typeof payload.startTime === 'string') {
              try {
                startTimeMin = toMinutes(payload.startTime);
              } catch (error) {
                console.warn(`[create-clinical-doc] Invalid startTime format: ${payload.startTime}`);
              }
            } else if (typeof payload.startTime === 'number') {
              startTimeMin = payload.startTime;
            }
          }
          
          // Build where clause for appointment matching
          const appointmentWhere: any = {
              patientId: visit!.patientId,
            doctorId: visit!.doctorId,
              date: {
                gte: startOfDay,
                lt: endOfDay,
              },
          };
          
          // If startTime is provided, match appointments with that specific start time
          if (startTimeMin !== null) {
            appointmentWhere.startTimeMin = startTimeMin;
          }
          
          // First, check if any appointments exist for this patient/doctor/date (for debugging)
          const allAppointmentsForDate = await tx.appointment.findMany({
            where: appointmentWhere,
            select: {
              appointmentId: true,
              status: true,
              date: true,
              startTimeMin: true,
            },
          });
          
          console.log(`[create-clinical-doc] All appointments for patient ${visit!.patientId}, doctor ${visit!.doctorId}, date range ${startOfDay.toISOString()} to ${endOfDay.toISOString()}${startTimeMin !== null ? `, startTimeMin: ${startTimeMin}` : ''}:`, allAppointmentsForDate);
          
          // Now find only those that need to be completed
          const matchingAppointments = allAppointmentsForDate.filter(
            (appt) => appt.status !== 'Completed' && appt.status !== 'Cancelled'
          );

          // Update all matching appointments to "Completed"
          if (matchingAppointments.length > 0) {
            console.log(`[create-clinical-doc] Found ${matchingAppointments.length} matching appointment(s) to complete:`, matchingAppointments.map(a => ({ status: a.status, date: a.date })));
            
            const updatedAppointments = await Promise.all(
              matchingAppointments.map(async (appt) => {
                const updated = await tx.appointment.update({
                  where: { appointmentId: appt.appointmentId },
                  data: {
                    status: 'Completed',
                    cancelReason: null,
                  },
                  select: {
                    appointmentId: true,
                    status: true,
                    date: true,
                    patientId: true,
                    doctorId: true,
                  },
                });
                return updated;
              })
            );
            
            // Verify the updates were successful
            const verifyUpdates = await Promise.all(
              updatedAppointments.map(async (appt) => {
                const verified = await tx.appointment.findUnique({
                  where: { appointmentId: appt.appointmentId },
                  select: { appointmentId: true, status: true },
                });
                return verified;
              })
            );
            
            results.appointmentsCompleted = updatedAppointments.length;
            results.appointmentIds = updatedAppointments.map((a) => a.appointmentId);
            console.log(`[create-clinical-doc] Successfully updated ${updatedAppointments.length} appointment(s) to Completed status. Verification:`, verifyUpdates.map(v => ({ status: v?.status })));
          } else {
            results.appointmentsCompleted = 0;
            console.log(`[create-clinical-doc] No matching appointments found to complete. Search params:`, {
              patientId: visit!.patientId,
              doctorId: doctorId,
              dateRange: {
                from: startOfDay.toISOString(),
                to: endOfDay.toISOString(),
              },
              appointmentDateOnly: appointmentDateOnly.toISOString(),
            });
          }
        } else {
          results.appointmentsCompleted = 0;
        }

        return { results, isNewVisit };
      });

      // Notify Atenxion agent after transaction commits (external API calls outside transaction)
      try {
        const { recordAtenxionTransactionForDoctor } = await import("../services/atenxion.js");
        await recordAtenxionTransactionForDoctor(doctorId);
        if (transactionResult.isNewVisit) {
          console.log("Atenxion transaction recorded for visit creation:", transactionResult.results.visitId);
        }
        if (transactionResult.results.observationCreated) {
          console.log("Atenxion transaction recorded for observation creation:", transactionResult.results.observation?.obsId);
        }
        if (transactionResult.results.prescriptionsCount > 0) {
          console.log("Atenxion transaction recorded for prescription creation:", transactionResult.results.prescription?.prescriptionId);
        }
      } catch (error) {
        console.warn("Failed to record Atenxion transaction:", error);
        // Don't fail the request if Atenxion notification fails
      }

      res.status(201).json(transactionResult.results);
    } catch (error) {
      console.error("Doctor Agent Create Clinical Doc Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create clinical documentation",
        msg: "Failed",
      });
    }
  }
);

// Patient Overview API - Returns past visit dates and upcoming appointment dates
router.post(
  "/patient-overview",
  requireAuth,
  requireRole("Doctor"),
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
      const validationResult = PatientOverviewSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const { doctorId } = validationResult.data;

      // Verify the doctorId exists
      const doctor = await prisma.doctor.findUnique({
        where: { doctorId },
        select: { doctorId: true, name: true },
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found",
          msg: "Failed",
        });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get all visits for this doctor
      const allVisits = await prisma.visit.findMany({
        where: {
          doctorId,
        },
        select: {
          visitId: true,
          visitDate: true,
          patientId: true,
          patient: {
            select: {
              patientId: true,
              name: true,
            },
          },
        },
        orderBy: {
          visitDate: 'desc',
        },
      });

      // Get all appointments for this doctor (not cancelled)
      const allAppointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          status: { not: 'Cancelled' },
        },
        select: {
          appointmentId: true,
          date: true,
          startTimeMin: true,
          endTimeMin: true,
          status: true,
          reason: true,
          patientId: true,
          patient: {
            select: {
              patientId: true,
              name: true,
            },
          },
        },
        orderBy: [
          { date: 'asc' },
          { startTimeMin: 'asc' },
        ],
      });

      // Group visits and appointments by patient
      const patientMap = new Map<string, {
        patientId: string;
        patientName: string;
        visitDates: string[];
        appointmentDates: string[];
      }>();

      // Process visits
      allVisits.forEach((visit) => {
        const patientId = visit.patientId;
        if (!patientMap.has(patientId)) {
          patientMap.set(patientId, {
            patientId,
            patientName: visit.patient.name,
            visitDates: [],
            appointmentDates: [],
          });
        }
        const visitDate = visit.visitDate.toISOString().split('T')[0];
        const patientData = patientMap.get(patientId)!;
        if (!patientData.visitDates.includes(visitDate)) {
          patientData.visitDates.push(visitDate);
        }
      });

      // Process appointments
      allAppointments.forEach((appointment) => {
        const patientId = appointment.patientId;
        if (!patientMap.has(patientId)) {
          patientMap.set(patientId, {
            patientId,
            patientName: appointment.patient.name,
            visitDates: [],
            appointmentDates: [],
          });
        }
        const appointmentDate = appointment.date.toISOString().split('T')[0];
        const patientData = patientMap.get(patientId)!;
        if (!patientData.appointmentDates.includes(appointmentDate)) {
          patientData.appointmentDates.push(appointmentDate);
        }
      });

      // Convert map to array and sort by patient name
      const patients = Array.from(patientMap.values()).sort((a, b) => 
        a.patientName.localeCompare(b.patientName)
      );

      res.json({
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        patients: patients.map((patient) => ({
          patientId: patient.patientId,
          patientName: patient.patientName,
          visitDates: patient.visitDates.sort().reverse(), // Most recent first
          appointmentDates: patient.appointmentDates.sort(), // Upcoming first
        })),
        msg: "Success",
      });
    } catch (error) {
      console.error("Doctor Agent Patient Overview Error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch patient overview",
        msg: "Failed",
      });
    }
  }
);

export default router;

