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
      
      // Get patient data
      const patient = await prisma.patient.findUnique({
        where: { patientId },
        select: {
          patientId: true,
          name: true,
          dob: true,
          gender: true,
          contact: true,
          insurance: true,
        }
      });

      if (!patient) {
        return res.status(404).json({
          error: 'Patient not found',
          msg: 'Failed'
        });
      }

      // Get related data
      const [medications, visits, labResults, immunizations] = await Promise.all([
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
          take: 10
        }),
        prisma.visit.findMany({
          where: { patientId },
          include: {
            doctor: true
          },
          orderBy: { visitDate: 'desc' },
          take: 10
        }),
        prisma.labResult.findMany({
          where: { patientId },
          orderBy: { labResultId: 'desc' },
          take: 10
        }),
        prisma.immunizationRecord.findMany({
          where: { patientId },
          orderBy: { immunizationId: 'desc' },
          take: 10
        })
      ]);

      const result = {
        data: {
          patient,
          diagnoses: medications, // Using medications as diagnoses for now
          medications,
          visits,
          labResults,
          immunizations,
          radiologyReports: [] // Add radiology reports if available
        },
        msg: "Success"
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

// 2. Appointment Agent API
router.get(
  '/appointments',
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
        data: {
          upcoming,
          past
        },
        msg: "Success"
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
        data: orders,
        msg: "Success"
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
        data: {
          invoices,
          totalOutstanding,
          totalPaid,
          paymentHistory: payments
        },
        msg: "Success"
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
        data: {
          appointmentLetters,
          summary
        },
        msg: "Success"
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
