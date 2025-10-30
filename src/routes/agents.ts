import { Router, type Response, type NextFunction } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Helper function to extract token from Authorization header (deprecated - no longer needed)
function getTokenFromRequest(req: any): string {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new Error('Authorization header is required');
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Invalid authorization format. Use Bearer token');
  }
  return token;
}

// Agent service functions will be defined inline

// 1. Medical History Agent API
router.post(
  '/medical-history',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
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
        }
      });

      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
          msg: 'Failed'
        });
      }

      // Get comprehensive medical data
      const [medications, visits, labResults, immunizations, vitals, allergies, diagnoses, problems] = await Promise.all([
        prisma.medicationOrder.findMany({
          where: { patientId },
          include: {
            prescription: {
              include: {
                visit: {
                  include: {
                    doctor: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 20
        }),
        prisma.visit.findMany({
          where: { patientId },
          include: {
            doctor: true
          },
          orderBy: { visitDate: 'desc' },
          take: 15
        }),
        prisma.labResult.findMany({
          where: { patientId },
          orderBy: { resultedAt: 'desc' },
          take: 15
        }),
        prisma.immunizationRecord.findMany({
          where: { patientId },
          orderBy: { immunizationId: 'desc' },
          take: 10
        }),
        prisma.vitals.findMany({
          where: { patientId },
          orderBy: { recordedAt: 'desc' },
          take: 10
        }),
        // Get patient's drug allergies from their profile
        Promise.resolve([]), // We'll use patient.drugAllergies instead
        prisma.diagnosis.findMany({
          where: { 
            visit: {
              patientId
            }
          },
          include: {
            visit: {
              include: { doctor: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        }),
        prisma.problem.findMany({
          where: { patientId },
          orderBy: { createdAt: 'desc' },
          take: 10
        })
      ]);

      // Calculate BMI from latest vitals
      const latestVitals = vitals[0];
      const bmi = latestVitals && latestVitals.weightKg && latestVitals.heightCm ? 
        (Number(latestVitals.weightKg) / Math.pow(Number(latestVitals.heightCm) / 100, 2)).toFixed(1) : 'Not available';

      const result = {
        // 🧠 1. Basic Patient Information
        patientName: patient.name,
        patientId: patient.patientId,
        dateOfBirth: patient.dob.toISOString().split('T')[0],
        age: new Date().getFullYear() - new Date(patient.dob).getFullYear(),
        gender: patient.gender,
        contact: patient.contact,
        address: 'Not provided',
        emergencyContact: 'Not provided',
        bloodType: 'Not recorded',
        occupation: 'Not provided',
        insurance: patient.insurance || 'Not provided',

        // 🩺 2. Vital Signs and Measurements
        bmi: bmi,
        latestWeight: latestVitals?.weightKg ? `${latestVitals.weightKg} kg` : 'Not recorded',
        latestHeight: latestVitals?.heightCm ? `${latestVitals.heightCm} cm` : 'Not recorded',
        latestBloodPressure: latestVitals?.systolic && latestVitals?.diastolic ? 
          `${latestVitals.systolic}/${latestVitals.diastolic}` : 'Not recorded',
        latestHeartRate: latestVitals?.heartRate ? `${latestVitals.heartRate} bpm` : 'Not recorded',
        latestTemperature: latestVitals?.temperature ? `${latestVitals.temperature}°C` : 'Not recorded',
        latestSpO2: latestVitals?.spo2 ? `${latestVitals.spo2}%` : 'Not recorded',
        latestRespiratoryRate: 'Not recorded',

        // 💊 3. Medication History (detailed, human-readable, no counts)
        medications: medications.map((m: any) => {
          const medName = m.drugName || 'Medication';
          const dose = m.dosage ? ` ${m.dosage}` : '';
          const doctor = m.prescription?.visit?.doctor?.name ? ` (prescribed by Dr. ${m.prescription.visit.doctor.name})` : '';
          return `${medName}${dose}${doctor}`;
        }),

        // 💉 4. Allergies & Adverse Reactions
        drugAllergies: patient.drugAllergies ? [patient.drugAllergies] : [],
        totalAllergies: patient.drugAllergies ? 1 : 0,
        hasAllergies: !!patient.drugAllergies,
        patientAllergies: patient.drugAllergies || 'No known allergies',

        // 🧬 5. Past Medical History (PMH)
        chronicConditions: problems.filter((p: any) => p.status === 'ACTIVE').map((p: any) => p.description),
        totalChronicConditions: problems.filter((p: any) => p.status === 'ACTIVE').length,
        pastSurgeries: visits.filter((v: any) => v.department?.toLowerCase().includes('surgery')).length,
        totalVisits: visits.length,
        recentVisits: visits.slice(0, 3).map((v: any) => 
          `${v.visitDate.toISOString().split('T')[0]} - ${v.doctor.name} (${v.department})`
        ),

        // 🧪 6. Lab Results & Diagnostics
        totalLabResults: labResults.length,
        recentLabResults: labResults.slice(0, 5).map((lab: any) => 
          `Lab test - ${lab.resultValue || 'No result'} (${lab.resultedAt.toISOString().split('T')[0]})`
        ),
        abnormalResults: labResults.filter((lab: any) => lab.resultValue?.toLowerCase().includes('high') || 
          lab.resultValue?.toLowerCase().includes('low') || 
          lab.resultValue?.toLowerCase().includes('abnormal')).length,

        // 🗓 7. Immunization Record
        totalImmunizations: immunizations.length,
        recentImmunizations: immunizations.slice(0, 3).map((imm: any) => 
          `${imm.vaccineName} - ${imm.dateAdministered.toISOString().split('T')[0]}`
        ),

        // 🧾 8. Current Medical Conditions & Treatment Plan (diagnoses detail, no counts)
        diagnoses: diagnoses.map((d: any) => {
          const desc = d.description || d.diagnosis || 'Diagnosis';
          const date = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : undefined;
          const doctor = d.visit?.doctor?.name ? ` (by Dr. ${d.visit.doctor.name}` + (date ? ` on ${date}` : '') + ')' : (date ? ` (${date})` : '');
          return `${desc}${doctor || ''}`;
        }),
        activeProblems: problems.filter((p: any) => p.status === 'ACTIVE').length,
        resolvedProblems: problems.filter((p: any) => p.status === 'RESOLVED').length,

        // 📊 Summary Statistics
        lastVisitDate: visits.length > 0 ? visits[0].visitDate.toISOString().split('T')[0] : 'No visits',
        lastLabDate: labResults.length > 0 ? labResults[0].resultedAt.toISOString().split('T')[0] : 'No lab results',
        lastVitalDate: vitals.length > 0 ? vitals[0].recordedAt.toISOString().split('T')[0] : 'No vitals recorded',

        status: "Success"
      };
      
      res.json(result);
    } catch (error) {
      console.error('Medical History Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch medical history',
        msg: 'Failed'
      });
    }
  }
);

// 2. Appointment Agent API - Get appointments
router.post(
  '/appointments',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const [upcoming, past] = await Promise.all([
        prisma.appointment.findMany({
          where: {
            patientId,
            date: { gte: today }
          },
          include: {
            doctor: true
          },
          orderBy: { date: 'asc' }
        }),
        prisma.appointment.findMany({
          where: {
            patientId,
            date: { lt: today }
          },
          include: {
            doctor: true
          },
          orderBy: { date: 'desc' }
        })
      ]);

      // Flatten all appointments to top level
      const result: any = {
        // Summary Counts
        upcomingAppointmentCount: upcoming.length,
        pastAppointmentCount: past.length,
        status: "Success"
      };

      // Add upcoming appointments as flat fields
      upcoming.forEach((apt, index) => {
        const prefix = `upcomingAppointment${index + 1}`;
        result[`${prefix}Id`] = apt.appointmentId;
        result[`${prefix}Date`] = apt.date.toISOString().split('T')[0];
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
        result[`${prefix}Date`] = apt.date.toISOString().split('T')[0];
        result[`${prefix}Time`] = formatTime(apt.startTimeMin);
        result[`${prefix}Doctor`] = apt.doctor.name;
        result[`${prefix}Department`] = apt.department;
        result[`${prefix}Reason`] = apt.reason;
        result[`${prefix}Location`] = apt.location;
        result[`${prefix}Status`] = apt.status;
      });
      
      res.json(result);
    } catch (error) {
      console.error('Appointment Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch appointments',
        msg: 'Failed'
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
    throw new Error(`Invalid time format: ${timeStr}. Use format like "2:30pm" or "14:30"`);
  }
  
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3];
  
  // Validate minutes
  if (minutes >= 60) {
    throw new Error(`Invalid minutes: ${minutes}. Minutes must be less than 60`);
  }
  
  // Handle AM/PM
  if (period === 'pm' && hours !== 12) {
    hours += 12;
  } else if (period === 'am' && hours === 12) {
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
  '/appointments/create',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const body = req.body;
      
      const { patientId, doctorName, department, date, startTime, reason } = body;
      
      if (!patientId || !doctorName || !department || !date || !startTime) {
        return res.status(400).json({
          error: 'Missing required fields: patientId, doctorName, department, date, startTime',
          msg: 'Failed'
        });
      }

      // Validate patient exists
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: { patientId: true, name: true }
      });
      
      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
          msg: 'Failed'
        });
      }

      // Find doctor by name
      const doctor = await prisma.doctor.findFirst({
        where: { 
          name: { 
            contains: doctorName, 
            mode: 'insensitive' 
          } 
        },
        select: { doctorId: true, name: true, department: true }
      });
      
      if (!doctor) {
        return res.status(404).json({
          error: `Doctor not found with name: ${doctorName}`,
          msg: 'Failed'
        });
      }

      // Parse start time to minutes
      let startTimeMin: number;
      
      try {
        startTimeMin = parseTimeToMinutes(startTime);
      } catch (timeError) {
        return res.status(400).json({
          error: timeError instanceof Error ? timeError.message : 'Invalid time format',
          msg: 'Failed'
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
        const { recordAtenxionTransaction } = await import('../services/atenxion.js');
        await recordAtenxionTransaction(patientId);
        console.log('Atenxion transaction recorded for appointment creation:', appointment.appointmentId);
      } catch (error) {
        console.warn('Failed to record Atenxion transaction for appointment creation:', error);
      }

      // Return flat response for agents
      res.status(201).json({
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        patientName: appointment.patient.name,
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
        department: appointment.department,
        appointmentDate: appointment.date.toISOString().split('T')[0],
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        duration: "30 minutes",
        reason: appointment.reason,
        location: appointment.location,
        appointmentStatus: "Scheduled",
        createdAt: appointment.createdAt.toISOString(),
        message: "Appointment created successfully",
        status: "Success"
      });
    } catch (error) {
      console.error('Create Appointment Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create appointment',
        msg: 'Failed'
      });
    }
  }
);

// 3. Medication Order Agent API
router.post(
  '/medication-orders',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }
      
      const orders = await prisma.medicationOrder.findMany({
        where: { patientId },
        include: {
          prescription: {
            include: {
              visit: {
                include: {
                  doctor: true
                }
              }
            }
          },
          approvedBy: true,
          updatedBy: true
        },
        orderBy: { createdAt: 'desc' }
      });

      // Get all ordered medicines summary
      const orderedMedicines = orders
        .filter((o: any) => o.prescription?.medication)
        .map((o: any) => ({
          name: o.prescription.medication.name,
          dosage: o.prescription.dosage,
          frequency: o.prescription.frequency,
          status: o.status
        }));

      // Flatten all medication orders to top level
      const result: any = {
        // Summary Counts
        totalOrders: orders.length,
        pendingOrders: orders.filter((o: any) => o.status === 'PENDING').length,
        approvedOrders: orders.filter((o: any) => o.status === 'APPROVED').length,
        rejectedOrders: orders.filter((o: any) => o.status === 'REJECTED').length,
        
        // Ordered Medicines Summary
        totalOrderedMedicines: orderedMedicines.length,
        orderedMedicinesList: orderedMedicines.map(med => 
          `${med.name} ${med.dosage} - ${med.frequency} (${med.status})`
        ),
        uniqueMedicines: [...new Set(orderedMedicines.map(med => med.name))],
        
        status: "Success"
      };

      // Add medication orders as flat fields
      orders.forEach((order: any, index) => {
        const prefix = `medicationOrder${index + 1}`;
        result[`${prefix}Id`] = order.orderId;
        result[`${prefix}Status`] = order.status;
        result[`${prefix}CreatedDate`] = order.createdAt.toISOString().split('T')[0];
        result[`${prefix}CreatedTime`] = order.createdAt.toISOString().split('T')[1].split('.')[0];
        result[`${prefix}Notes`] = order.notes || 'No notes';
        result[`${prefix}ApprovedBy`] = order.approvedBy?.name || 'Not approved';
        result[`${prefix}ApprovedDate`] = order.approvedAt ? order.approvedAt.toISOString().split('T')[0] : 'Not approved';
        result[`${prefix}UpdatedBy`] = order.updatedBy?.name || 'Not updated';
        result[`${prefix}UpdatedDate`] = order.updatedAt ? order.updatedAt.toISOString().split('T')[0] : 'Not updated';
        
        // Prescription details
        if (order.prescription) {
          result[`${prefix}PrescriptionId`] = order.prescription.prescriptionId;
          result[`${prefix}MedicationName`] = order.prescription.medication?.name || 'Unknown medication';
          result[`${prefix}MedicationGenericName`] = order.prescription.medication?.genericName || 'Not specified';
          result[`${prefix}MedicationForm`] = order.prescription.medication?.form || 'Not specified';
          result[`${prefix}MedicationStrength`] = order.prescription.medication?.strength || 'Not specified';
          result[`${prefix}Dosage`] = order.prescription.dosage || 'Not specified';
          result[`${prefix}Instructions`] = order.prescription.instructions || 'No instructions';
          result[`${prefix}Frequency`] = order.prescription.frequency || 'Not specified';
          result[`${prefix}Duration`] = order.prescription.duration || 'Not specified';
          result[`${prefix}Quantity`] = order.prescription.quantity || 'Not specified';
          result[`${prefix}Refills`] = order.prescription.refills || '0';
        }
        
        // Visit details
        if (order.prescription?.visit) {
          result[`${prefix}VisitId`] = order.prescription.visit.visitId;
          result[`${prefix}VisitDate`] = order.prescription.visit.visitDate.toISOString().split('T')[0];
          result[`${prefix}DoctorName`] = order.prescription.visit.doctor?.name || 'Unknown doctor';
          result[`${prefix}Department`] = order.prescription.visit.department || 'Not specified';
        }
      });
      
      res.json(result);
    } catch (error) {
      console.error('Medication Order Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch medication orders',
        msg: 'Failed'
      });
    }
  }
);

// 4. Billing Agent API - Optimized for Widgets
router.post(
  '/billing',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId, startDate, endDate, doctorId } = req.body;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }
      
      // Build where clause for date filtering
      const whereClause: any = { patientId };
      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) whereClause.createdAt.gte = new Date(startDate as string);
        if (endDate) whereClause.createdAt.lte = new Date(endDate as string);
      }

      // Get spending analytics by doctor using raw SQL for better performance
      const spendingByDoctor = await prisma.$queryRaw<Array<{
        doctorId: string;
        doctorName: string;
        totalSpent: number;
        totalPaid: number;
        visitCount: number;
        lastVisit: Date;
      }>>`
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
          ${doctorId ? Prisma.sql`AND v."doctorId" = ${doctorId}::uuid` : Prisma.empty}
          ${startDate ? Prisma.sql`AND i."createdAt" >= ${new Date(startDate as string)}` : Prisma.empty}
          ${endDate ? Prisma.sql`AND i."createdAt" <= ${new Date(endDate as string)}` : Prisma.empty}
        GROUP BY v."doctorId", d.name
        ORDER BY "totalSpent" DESC
      `;

      // Get overall spending summary
      const overallSummary = await prisma.invoice.aggregate({
        where: whereClause,
        _sum: {
          grandTotal: true,
          amountPaid: true,
          amountDue: true
        },
        _count: {
          invoiceId: true
        }
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
                  name: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      // Get recent payments
      const recentPayments = await prisma.payment.findMany({
        where: { 
          Invoice: {
            patientId: patientId
          }
        },
        select: {
          amount: true,
          paidAt: true,
          method: true
        },
        orderBy: { paidAt: 'desc' },
        take: 5
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
        topDoctorName: spendingByDoctor.length > 0 ? spendingByDoctor[0].doctorName : null,
        topDoctorSpent: spendingByDoctor.length > 0 ? spendingByDoctor[0].totalSpent.toFixed(2) : "0.00",
        topDoctorPaid: spendingByDoctor.length > 0 ? spendingByDoctor[0].totalPaid.toFixed(2) : "0.00",
        topDoctorVisits: spendingByDoctor.length > 0 ? Number(spendingByDoctor[0].visitCount) : 0,
        
        // Recent Payment (flat fields)
        lastPaymentAmount: recentPayments.length > 0 ? Number(recentPayments[0].amount).toFixed(2) : "0.00",
        lastPaymentDate: recentPayments.length > 0 ? recentPayments[0].paidAt.toISOString().split('T')[0] : null,
        lastPaymentMethod: recentPayments.length > 0 ? recentPayments[0].method : null,
        
        // Doctor Count
        doctorCount: spendingByDoctor.length
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
        result[`${prefix}Date`] = invoice.createdAt.toISOString().split('T')[0];
      });
      
      res.json(result);
    } catch (error) {
      console.error('Billing Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch billing information',
        msg: 'Failed'
      });
    }
  }
);

// 5. Appointment Letter Agent API
router.post(
  '/appointment-letters',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }
      
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: {
          patientId: true,
          name: true,
          contact: true
        }
      });

      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
          msg: 'Failed'
        });
      }

      const appointments = await prisma.appointment.findMany({
        where: { patientId },
        include: {
          doctor: true
        },
        orderBy: { date: 'desc' }
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
        pendingLetters: appointmentLetters.filter(l => (l.status as string) === 'PENDING').length,
        sentLetters: appointmentLetters.filter(l => (l.status as string) === 'SENT').length,
        deliveredLetters: appointmentLetters.filter(l => (l.status as string) === 'DELIVERED').length,
        readLetters: appointmentLetters.filter(l => (l.status as string) === 'READ').length,
        failedLetters: appointmentLetters.filter(l => (l.status as string) === 'FAILED').length,
      };

      const result = {
        totalLetters: appointmentLetters.length,
        pendingLetters: appointmentLetters.filter(l => l.status === 'PENDING').length,
        sentLetters: appointmentLetters.filter(l => l.status === 'SENT').length,
        deliveredLetters: appointmentLetters.filter(l => l.status === 'DELIVERED').length,
        readLetters: appointmentLetters.filter(l => l.status === 'READ').length,
        failedLetters: appointmentLetters.filter(l => l.status === 'FAILED').length,
        recentLetters: appointmentLetters.slice(0, 3).map(letter => 
          `${letter.title} - ${letter.doctorInfo.name} - ${letter.createdAt.split('T')[0]}`
        ),
        status: "Success"
      };
      
      res.json(result);
    } catch (error) {
      console.error('Appointment Letter Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch appointment letters',
        msg: 'Failed'
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
  if (appointment.status === 'CONFIRMED' && appointmentDate > now) {
    // Appointment accepted letter
    letters.push({
      letterId: `letter_${appointment.appointmentId}_accepted`,
      appointmentId: appointment.appointmentId,
      patientId: patient.patientId,
      doctorId: appointment.doctor.doctorId,
      letterType: 'APPOINTMENT_ACCEPTED',
      status: 'SENT',
      title: `Appointment Confirmed - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} has been confirmed for ${appointment.date} at ${formatTime(appointment.startTimeMin)}.\n\nPlease arrive 15 minutes early for check-in.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: null, // Email not available in patient schema
        phone: patient.contact || null
      },
      doctorInfo: {
        name: appointment.doctor.name,
        department: appointment.doctor.department,
        email: `${appointment.doctor.name.toLowerCase().replace(' ', '.')}@hospital.com`
      },
      appointmentInfo: {
        date: appointment.date,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        department: appointment.department,
        location: appointment.location,
        reason: appointment.reason
      },
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readAt: null
    });
  }
  
  if (appointment.status === 'COMPLETED') {
    // Appointment completed letter
    letters.push({
      letterId: `letter_${appointment.appointmentId}_completed`,
      appointmentId: appointment.appointmentId,
      patientId: patient.patientId,
      doctorId: appointment.doctor.doctorId,
      letterType: 'APPOINTMENT_COMPLETED',
      status: 'SENT',
      title: `Appointment Completed - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} on ${appointment.date} has been completed.\n\nThank you for choosing our healthcare services.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: null, // Email not available in patient schema
        phone: patient.contact || null
      },
      doctorInfo: {
        name: appointment.doctor.name,
        department: appointment.doctor.department,
        email: `${appointment.doctor.name.toLowerCase().replace(' ', '.')}@hospital.com`
      },
      appointmentInfo: {
        date: appointment.date,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        department: appointment.department,
        location: appointment.location,
        reason: appointment.reason
      },
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readAt: null
    });
  }
  
  if (appointment.status === 'CANCELLED') {
    // Appointment cancelled letter
    letters.push({
      letterId: `letter_${appointment.appointmentId}_cancelled`,
      appointmentId: appointment.appointmentId,
      patientId: patient.patientId,
      doctorId: appointment.doctor.doctorId,
      letterType: 'APPOINTMENT_CANCELLED',
      status: 'SENT',
      title: `Appointment Cancelled - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} scheduled for ${appointment.date} has been cancelled.\n\nPlease contact us to reschedule if needed.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: null, // Email not available in patient schema
        phone: patient.contact || null
      },
      doctorInfo: {
        name: appointment.doctor.name,
        department: appointment.doctor.department,
        email: `${appointment.doctor.name.toLowerCase().replace(' ', '.')}@hospital.com`
      },
      appointmentInfo: {
        date: appointment.date,
        startTime: formatTime(appointment.startTimeMin),
        endTime: formatTime(appointment.endTimeMin),
        department: appointment.department,
        location: appointment.location,
        reason: appointment.reason
      },
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readAt: null
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
  '/patient-profile',
  async (req: any, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.body;
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
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
          updatedAt: true
        }
      });

      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
          msg: 'Failed'
        });
      }

      // Calculate age
      const age = new Date().getFullYear() - new Date(patient.dob).getFullYear();

      // Simple response with basic patient data only
      const result = {
        // 🧑‍⚕️ Basic Patient Information
        patientId: patient.patientId,
        patientName: patient.name,
        dateOfBirth: patient.dob.toISOString().split('T')[0],
        age: age,
        gender: patient.gender,
        contact: patient.contact,
        insurance: patient.insurance || 'Not provided',
        drugAllergies: patient.drugAllergies || 'No known allergies',
        memberSince: patient.createdAt.toISOString().split('T')[0],
        lastUpdated: patient.updatedAt.toISOString().split('T')[0],
        status: "Success"
      };
      
      res.json(result);
    } catch (error) {
      console.error('Patient Profile Agent Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch patient profile',
        msg: 'Failed'
      });
    }
  }
);

// Helper function to format time from minutes to HH:MM
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export default router;
