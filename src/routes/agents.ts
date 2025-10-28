import { Router, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole, type AuthRequest } from '../modules/auth/index.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Helper function to extract token from Authorization header
function getTokenFromRequest(req: AuthRequest): string {
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
router.get(
  '/medical-history',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.query;
      const user = req.user!;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }

      // If user is a patient, they can only view their own medical history
      if (user.role === 'Patient') {
        if (!user.patientId) {
          return res.status(403).json({
            error: 'Patient ID not found in session',
            msg: 'Failed'
          });
        }
        if (patientId !== user.patientId) {
          return res.status(403).json({
            error: 'Patients can only view their own medical history',
            msg: 'Failed'
          });
        }
      }

      const token = getTokenFromRequest(req);
      
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
          orderBy: { labResultId: 'desc' },
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
        prisma.drug.findMany({
          take: 10
        }),
        prisma.diagnosis.findMany({
          where: { 
            visit: {
              patientId
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

        // 💊 3. Medication History
        currentMedications: medications.filter((m: any) => m.status === 'ACTIVE').slice(0, 5).map((m: any) => 
          `Medication order - ${m.status}`
        ),
        totalMedications: medications.length,
        activeMedications: medications.filter((m: any) => m.status === 'ACTIVE').length,
        pastMedications: medications.filter((m: any) => m.status !== 'ACTIVE').length,

        // 💉 4. Allergies & Adverse Reactions
        drugAllergies: allergies.map((allergy: any) => 
          `${allergy.name || 'Unknown drug'} - Allergic reaction`
        ),
        totalAllergies: allergies.length,
        hasAllergies: allergies.length > 0,
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
          `Lab test - ${lab.resultValue || 'No result'} (${lab.createdAt.toISOString().split('T')[0]})`
        ),
        abnormalResults: labResults.filter((lab: any) => lab.resultValue?.toLowerCase().includes('high') || 
          lab.resultValue?.toLowerCase().includes('low') || 
          lab.resultValue?.toLowerCase().includes('abnormal')).length,

        // 🗓 7. Immunization Record
        totalImmunizations: immunizations.length,
        recentImmunizations: immunizations.slice(0, 3).map((imm: any) => 
          `${imm.vaccineName} - ${imm.dateAdministered.toISOString().split('T')[0]}`
        ),

        // 🧾 8. Current Medical Conditions & Treatment Plan
        currentDiagnoses: diagnoses.filter((d: any) => d.status === 'ACTIVE').map((d: any) => d.description),
        totalDiagnoses: diagnoses.length,
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
router.get(
  '/appointments',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.query;
      const user = req.user!;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }

      // If user is a patient, they can only view their own appointments
      if (user.role === 'Patient') {
        if (!user.patientId) {
          return res.status(403).json({
            error: 'Patient ID not found in session',
            msg: 'Failed'
          });
        }
        if (patientId !== user.patientId) {
          return res.status(403).json({
            error: 'Patients can only view their own appointments',
            msg: 'Failed'
          });
        }
      }

      const token = getTokenFromRequest(req);
      
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
          orderBy: { date: 'desc' },
          take: 10
        })
      ]);

      const result = {
        // Upcoming Appointments
        upcomingAppointmentCount: upcoming.length,
        nextAppointmentDate: upcoming.length > 0 ? upcoming[0].date.toISOString().split('T')[0] : null,
        nextAppointmentTime: upcoming.length > 0 ? formatTime(upcoming[0].startTimeMin) : null,
        nextAppointmentDoctor: upcoming.length > 0 ? upcoming[0].doctor.name : null,
        nextAppointmentDepartment: upcoming.length > 0 ? upcoming[0].department : null,
        nextAppointmentReason: upcoming.length > 0 ? upcoming[0].reason : null,
        
        // Upcoming Appointments List
        upcomingAppointment1Date: upcoming.length > 0 ? upcoming[0].date.toISOString().split('T')[0] : null,
        upcomingAppointment1Time: upcoming.length > 0 ? formatTime(upcoming[0].startTimeMin) : null,
        upcomingAppointment1Doctor: upcoming.length > 0 ? upcoming[0].doctor.name : null,
        upcomingAppointment1Department: upcoming.length > 0 ? upcoming[0].department : null,
        
        upcomingAppointment2Date: upcoming.length > 1 ? upcoming[1].date.toISOString().split('T')[0] : null,
        upcomingAppointment2Time: upcoming.length > 1 ? formatTime(upcoming[1].startTimeMin) : null,
        upcomingAppointment2Doctor: upcoming.length > 1 ? upcoming[1].doctor.name : null,
        upcomingAppointment2Department: upcoming.length > 1 ? upcoming[1].department : null,
        
        upcomingAppointment3Date: upcoming.length > 2 ? upcoming[2].date.toISOString().split('T')[0] : null,
        upcomingAppointment3Time: upcoming.length > 2 ? formatTime(upcoming[2].startTimeMin) : null,
        upcomingAppointment3Doctor: upcoming.length > 2 ? upcoming[2].doctor.name : null,
        upcomingAppointment3Department: upcoming.length > 2 ? upcoming[2].department : null,
        
        // Past Appointments
        pastAppointmentCount: past.length,
        lastAppointmentDate: past.length > 0 ? past[0].date.toISOString().split('T')[0] : null,
        lastAppointmentTime: past.length > 0 ? formatTime(past[0].startTimeMin) : null,
        lastAppointmentDoctor: past.length > 0 ? past[0].doctor.name : null,
        lastAppointmentStatus: past.length > 0 ? past[0].status : null,
        
        // Past Appointments List
        pastAppointment1Date: past.length > 0 ? past[0].date.toISOString().split('T')[0] : null,
        pastAppointment1Time: past.length > 0 ? formatTime(past[0].startTimeMin) : null,
        pastAppointment1Doctor: past.length > 0 ? past[0].doctor.name : null,
        pastAppointment1Status: past.length > 0 ? past[0].status : null,
        
        pastAppointment2Date: past.length > 1 ? past[1].date.toISOString().split('T')[0] : null,
        pastAppointment2Time: past.length > 1 ? formatTime(past[1].startTimeMin) : null,
        pastAppointment2Doctor: past.length > 1 ? past[1].doctor.name : null,
        pastAppointment2Status: past.length > 1 ? past[1].status : null,
        
        pastAppointment3Date: past.length > 2 ? past[2].date.toISOString().split('T')[0] : null,
        pastAppointment3Time: past.length > 2 ? formatTime(past[2].startTimeMin) : null,
        pastAppointment3Doctor: past.length > 2 ? past[2].doctor.name : null,
        pastAppointment3Status: past.length > 2 ? past[2].status : null,
        
        status: "Success"
      };
      
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
  '/appointments',
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body;
      const user = req.user!;
      
      const { patientId, doctorName, department, date, startTime, reason } = body;
      
      if (!patientId || !doctorName || !department || !date || !startTime) {
        return res.status(400).json({
          error: 'Missing required fields: patientId, doctorName, department, date, startTime',
          msg: 'Failed'
        });
      }

      // If user is a patient, they can only create appointments for themselves
      if (user.role === 'Patient') {
        if (!user.patientId) {
          return res.status(403).json({
            error: 'Patient ID not found in session',
            msg: 'Failed'
          });
        }
        if (patientId !== user.patientId) {
          return res.status(403).json({
            error: 'Patients can only create appointments for themselves',
            msg: 'Failed'
          });
        }
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

      res.status(201).json({
        data: appointment,
        msg: "Appointment created successfully"
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
router.get(
  '/medication-orders',
  requireAuth,
  requireRole('Doctor', 'Nurse', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.query;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }

      const token = getTokenFromRequest(req);
      
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

      const result = {
        totalOrders: orders.length,
        activeOrders: orders.filter(o => o.status === 'PENDING').length,
        pendingOrders: orders.filter(o => o.status === 'PENDING').length,
        approvedOrders: orders.filter(o => o.status === 'APPROVED').length,
        medications: orders.slice(0, 5).map(order => {
          return `Medication order - ${order.status}`;
        }),
        recentOrders: orders.slice(0, 3).map(order => 
          `${order.status} - ${order.createdAt.toISOString().split('T')[0]}`
        ),
        status: "Success"
      };
      
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

// 4. Billing Agent API
router.get(
  '/billing',
  requireAuth,
  requireRole('Doctor', 'Nurse', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.query;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }

      const token = getTokenFromRequest(req);
      
      const [invoices, payments] = await Promise.all([
        prisma.invoice.findMany({
          where: { patientId },
          include: {
            items: true,
            payments: true
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.payment.findMany({
          where: { 
            Invoice: {
              patientId: patientId
            }
          },
          orderBy: { paidAt: 'desc' }
        })
      ]);

      const totalOutstanding = invoices.reduce((sum, invoice) => sum + (Number(invoice.grandTotal) - Number(invoice.amountPaid)), 0);
      const totalPaid = invoices.reduce((sum, invoice) => sum + Number(invoice.amountPaid), 0);

      const result = {
        totalInvoices: invoices.length,
        outstandingAmount: totalOutstanding,
        paidAmount: totalPaid,
        lastPayment: payments.length > 0 ? 
          `${payments[0].paidAt.toISOString().split('T')[0]} - $${payments[0].amount}` : 
          "No payments found",
        nextDueDate: invoices.find(inv => Number(inv.amountDue) > 0)?.createdAt?.toISOString().split('T')[0] || "No pending dues",
        recentInvoices: invoices.slice(0, 3).map(inv => 
          `${inv.invoiceNo} - $${inv.grandTotal} - ${inv.status}`
        ),
        recentPayments: payments.slice(0, 3).map(payment => 
          `${payment.paidAt.toISOString().split('T')[0]} - $${payment.amount} - ${payment.method}`
        ),
        status: "Success"
      };
      
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
router.get(
  '/appointment-letters',
  requireAuth,
  requireRole('Doctor', 'Nurse', 'ITAdmin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.query;
      
      if (!patientId) {
        return res.status(400).json({
          error: 'Patient ID is required',
          msg: 'Failed'
        });
      }

      const token = getTokenFromRequest(req);
      
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

// Helper function to format time from minutes to HH:MM
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export default router;
