import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Types for agent responses
export interface MedicalHistoryAgentResponse {
  data: {
    patient: {
      patientId: string;
      name: string;
      dob: string;
      gender: string;
      contact: string | null;
      insurance: string | null;
    };
    diagnoses: any[];
    medications: any[];
    visits: any[];
    labResults: any[];
    immunizations: any[];
    radiologyReports: any[];
  };
  msg: string;
}

export interface AppointmentAgentResponse {
  data: {
    upcoming: any[];
    past: any[];
  };
  msg: string;
}

export interface MedicationOrderAgentResponse {
  data: any[];
  msg: string;
}

export interface BillingAgentResponse {
  data: {
    invoices: any[];
    totalOutstanding: number;
    totalPaid: number;
    paymentHistory: any[];
  };
  msg: string;
}

export interface AppointmentLetterAgentResponse {
  data: {
    appointmentLetters: any[];
    summary: {
      totalLetters: number;
      pendingLetters: number;
      sentLetters: number;
      deliveredLetters: number;
      readLetters: number;
      failedLetters: number;
    };
  };
  msg: string;
}

// Medical History Agent - Comprehensive medical history
export async function getMedicalHistoryAgent(token: string, patientId: string): Promise<MedicalHistoryAgentResponse> {
  try {
    // Fetch patient data
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
      throw new Error('Patient not found');
    }

    // Fetch related data
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

    return {
      data: {
        patient: {
          ...patient,
          dob: patient.dob.toISOString(),
          gender: patient.gender.toString()
        },
        diagnoses: medications, // Using medications as diagnoses for now
        medications,
        visits,
        labResults,
        immunizations,
        radiologyReports: [] // Add radiology reports if available
      },
      msg: "Success"
    };
  } catch (error) {
    console.error('Error fetching medical history:', error);
    throw new Error('Failed to fetch medical history');
  }
}

// Appointment Agent - Appointment management and scheduling
export async function getAppointmentAgent(token: string, patientId: string): Promise<AppointmentAgentResponse> {
  try {
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

    return {
      data: {
        upcoming,
        past
      },
      msg: "Success"
    };
  } catch (error) {
    console.error('Error fetching appointments:', error);
    throw new Error('Failed to fetch appointments');
  }
}

// Medication Order Agent - Prescription and medication order management
export async function getMedicationOrderAgent(token: string, patientId: string): Promise<MedicationOrderAgentResponse> {
  try {
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

    return {
      data: orders,
      msg: "Success"
    };
  } catch (error) {
    console.error('Error fetching medication orders:', error);
    throw new Error('Failed to fetch medication orders');
  }
}

// Billing Agent - Financial and payment management
export async function getBillingAgent(token: string, patientId: string): Promise<BillingAgentResponse> {
  try {
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

    return {
      data: {
        invoices,
        totalOutstanding,
        totalPaid,
        paymentHistory: payments
      },
      msg: "Success"
    };
  } catch (error) {
    console.error('Error fetching billing information:', error);
    throw new Error('Failed to fetch billing information');
  }
}

// Appointment Letter Agent - Appointment status management and notifications
export async function getAppointmentLetterAgent(token: string, patientId: string): Promise<AppointmentLetterAgentResponse> {
  try {
    const patient = await prisma.patient.findUnique({
      where: { patientId },
      select: {
        patientId: true,
        name: true,
        contact: true
      }
    });

    if (!patient) {
      throw new Error('Patient not found');
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

    return {
      data: {
        appointmentLetters,
        summary
      },
      msg: "Success"
    };
  } catch (error) {
    console.error('Error fetching appointment letters:', error);
    throw new Error('Failed to fetch appointment letters');
  }
}

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
