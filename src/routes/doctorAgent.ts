import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../modules/auth/index.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

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

      // Get doctorId from authenticated user
      const doctorId = user.doctorId;
      if (!doctorId) {
        return res.status(403).json({
          error: "User is not linked to a doctor profile",
          msg: "Failed",
        });
      }

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

      // Get doctorId from authenticated user
      const doctorId = user.doctorId;
      if (!doctorId) {
        return res.status(403).json({
          error: "User is not linked to a doctor profile",
          msg: "Failed",
        });
      }

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

export default router;

