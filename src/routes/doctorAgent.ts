import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient } from "@prisma/client";
import { CreateLabOrderSchema } from "../validation/clinical.js";
import * as labService from "../services/labService.js";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

// Validation schema for medication agent
const MedicationAgentSchema = z.object({
  doctorId: z.string().uuid(),
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

      // Get doctorId from authenticated user
      const doctorId = user.doctorId;
      if (!doctorId) {
        return res.status(403).json({
          error: "User is not linked to a doctor profile",
          msg: "Failed",
        });
      }

      // Validate request body
      const validationResult = CreateLabOrderSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.errors,
          msg: "Failed",
        });
      }

      const payload = validationResult.data;

      // Verify visit exists and belongs to the doctor
      const visit = await prisma.visit.findUnique({
        where: { visitId: payload.visitId },
        select: { visitId: true, patientId: true, doctorId: true },
      });

      if (!visit) {
        return res.status(404).json({
          error: "Visit not found",
          msg: "Failed",
        });
      }

      if (visit.doctorId !== doctorId) {
        return res.status(403).json({
          error: "Visit does not belong to this doctor",
          msg: "Failed",
        });
      }

      // Verify patientId matches visit
      if (visit.patientId !== payload.patientId) {
        return res.status(400).json({
          error: "Patient ID does not match the visit",
          msg: "Failed",
        });
      }

      // Create lab order using the lab service
      const labOrder = await labService.createLabOrder(doctorId, payload);

      res.status(201).json({
        labOrderId: labOrder.labOrderId,
        visitId: labOrder.visitId,
        patientId: labOrder.patientId,
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

      // Flatten prescriptions and their items
      let medicationIndex = 0;
      prescriptions.forEach((prescription, rxIndex) => {
        const patient = prescription.patient;
        const age = patient ? calculateAge(patient.dob) : null;

        prescription.items.forEach((item) => {
          medicationIndex++;
          const prefix = `medication${medicationIndex}`;

          // Prescription info
          result[`${prefix}PrescriptionId`] = prescription.prescriptionId;
          result[`${prefix}PrescriptionStatus`] = prescription.status;
          result[`${prefix}PrescriptionNotes`] = prescription.notes || "No notes";
          result[`${prefix}PrescriptionCreatedAt`] = prescription.createdAt.toISOString().split("T")[0];
          result[`${prefix}PrescriptionCreatedTime`] = prescription.createdAt.toISOString().split("T")[1]?.split(".")[0] || "00:00:00";

          // Patient info
          result[`${prefix}PatientId`] = prescription.patientId;
          result[`${prefix}PatientName`] = patient?.name || "Unknown";
          result[`${prefix}PatientRecord`] = patient ? `${patient.name} (${prescription.patientId}) - Age: ${age}` : "Unknown";
          result[`${prefix}PatientAge`] = age;
          result[`${prefix}PatientGender`] = patient?.gender || "Unknown";

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

export default router;

