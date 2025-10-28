/**
 * EMR Agent System API
 * 
 * This module provides 5 specialized AI agents for patient data analysis:
 * 1. Medical History Agent - Comprehensive medical history
 * 2. Appointment Agent - Appointment management and scheduling  
 * 3. Medication Order Agent - Prescription and medication order management
 * 4. Billing Agent - Financial and payment management
 * 5. Appointment Letter Agent - Appointment status management and notifications
 * 
 * All agents use existing patient portal APIs to aggregate and structure data.
 */

import { 
  fetchPatientProfile, 
  fetchPatientAppointments, 
  fetchMedications, 
  fetchLabResults, 
  fetchImmunizations, 
  fetchRadiologyReports, 
  fetchPayments, 
  fetchMedicationOrders
} from './patientPortal';

// Medical History Agent Types
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
    diagnoses: Array<{
      medId: string;
      drugName: string;
      dosage: string | null;
      instructions: string | null;
      visitDate: string;
      doctor: {
        name: string;
        department: string;
      };
      createdAt: string;
    }>;
    medications: Array<{
      medId: string;
      drugName: string;
      dosage: string | null;
      instructions: string | null;
      visitDate: string;
      doctor: {
        name: string;
        department: string;
      };
      createdAt: string;
    }>;
    visits: Array<{
      visitId: string;
      visitDate: string;
      department: string;
      doctor: { name: string };
    }>;
    labResults: any[];
    immunizations: any[];
    radiologyReports: any[];
  };
  msg: string;
}

// Appointment Agent Types
export interface AppointmentAgentResponse {
  data: {
    upcoming: Array<{
      appointmentId: string;
      date: string;
      startTimeMin: number;
      endTimeMin: number;
      status: string;
      department: string;
      location: string | null;
      reason: string | null;
      doctor: {
        doctorId: string;
        name: string;
        department: string;
      };
    }>;
    past: Array<{
      appointmentId: string;
      date: string;
      startTimeMin: number;
      endTimeMin: number;
      status: string;
      department: string;
      location: string | null;
      reason: string | null;
      doctor: {
        doctorId: string;
        name: string;
        department: string;
      };
    }>;
  };
  msg: string;
}

// Medication Order Agent Types
export interface MedicationOrderAgentResponse {
  data: Array<{
    orderId: string;
    patientId: string;
    prescriptionId?: string | null;
    drugName?: string | null;
    dosage?: string | null;
    instructions?: string | null;
    quantity?: number | null;
    status: string;
    notes?: string | null;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    prescription?: any;
    approvedBy?: { userId: string; email: string; role: string } | null;
    updatedBy?: { userId: string; email: string; role: string } | null;
  }>;
  msg: string;
}

// Billing Agent Types
export interface BillingAgentResponse {
  data: {
    invoices: Array<{
      invoiceId: string;
      invoiceNo: string;
      patientId: string;
      visitId: string;
      total: number;
      amountPaid: number;
      balanceDue: number;
      status: string;
      createdAt: string;
      dueDate: string;
      lineItems: Array<{
        itemId: string;
        description: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        discountAmt: number;
        taxAmt: number;
      }>;
    }>;
    totalOutstanding: number;
    totalPaid: number;
    paymentHistory: Array<{
      paymentId: string;
      invoiceId: string;
      amount: number;
      method: string;
      referenceNo: string;
      note: string;
      createdAt: string;
    }>;
  };
  msg: string;
}

// Appointment Letter Agent Types
export interface AppointmentLetterAgentResponse {
  data: {
    appointmentLetters: Array<{
      letterId: string;
      appointmentId: string;
      patientId: string;
      doctorId: string;
      letterType: 'APPOINTMENT_ACCEPTED' | 'APPOINTMENT_CHECKED_IN' | 'APPOINTMENT_IN_PROGRESS' | 'APPOINTMENT_COMPLETED' | 'APPOINTMENT_CANCELLED' | 'APPOINTMENT_RESCHEDULED';
      status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
      title: string;
      content: string;
      patientInfo: {
        name: string;
        email: string | null;
        phone: string | null;
      };
      doctorInfo: {
        name: string;
        department: string;
        email: string;
      };
      appointmentInfo: {
        date: string;
        startTime: string;
        endTime: string;
        department: string;
        location: string | null;
        reason: string | null;
      };
      createdAt: string;
      sentAt: string | null;
      readAt: string | null;
    }>;
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
    const [profile, medications, labs, immunizations, radiology] = await Promise.all([
      fetchPatientProfile(token, patientId),
      fetchMedications(token, patientId),
      fetchLabResults(token, patientId),
      fetchImmunizations(token, patientId),
      fetchRadiologyReports(token, patientId)
    ]);

    return {
      data: {
        patient: {
          patientId: profile.patient.patientId,
          name: profile.patient.name,
          dob: profile.patient.dob,
          gender: profile.patient.gender,
          contact: profile.patient.contact,
          insurance: profile.patient.insurance
        },
        diagnoses: profile.medicines || [],
        medications: profile.medicines || [],
        visits: profile.recentVisits || [],
        labResults: labs || [],
        immunizations: immunizations || [],
        radiologyReports: radiology || []
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
    const profile = await fetchPatientProfile(token, patientId);
    
    return {
      data: {
        upcoming: profile.appointments.upcoming || [],
        past: profile.appointments.past || []
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
    const orders = await fetchMedicationOrders(token, patientId);
    
    return {
      data: orders || [],
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
    const [profile, payments] = await Promise.all([
      fetchPatientProfile(token, patientId),
      fetchPayments(token, patientId)
    ]);

    // Extract billing data from profile
    const invoiceSummary = profile.invoiceSummary || { outstanding: 0, lifetimeValue: 0, paidTotal: 0 };
    
    return {
      data: {
        invoices: [], // You might need to fetch this from a separate endpoint
        totalOutstanding: invoiceSummary.outstanding,
        totalPaid: invoiceSummary.paidTotal,
        paymentHistory: payments || []
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
    const profile = await fetchPatientProfile(token, patientId);
    
    // Generate appointment letters based on appointment status
    const appointmentLetters = [];
    const appointments = [...(profile.appointments?.upcoming || []), ...(profile.appointments?.past || [])];
    
    for (const appointment of appointments) {
      // Generate different letter types based on appointment status
      const letterTypes = generateAppointmentLetters(appointment, profile.patient);
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
      letterType: 'APPOINTMENT_ACCEPTED' as const,
      status: 'SENT' as const,
      title: `Appointment Confirmed - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} has been confirmed for ${appointment.date} at ${formatTime(appointment.startTimeMin)}.\n\nPlease arrive 15 minutes early for check-in.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: patient.email || null,
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
      letterType: 'APPOINTMENT_COMPLETED' as const,
      status: 'SENT' as const,
      title: `Appointment Completed - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} on ${appointment.date} has been completed.\n\nThank you for choosing our healthcare services.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: patient.email || null,
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
      letterType: 'APPOINTMENT_CANCELLED' as const,
      status: 'SENT' as const,
      title: `Appointment Cancelled - ${appointment.doctor.name}`,
      content: `Dear ${patient.name},\n\nYour appointment with Dr. ${appointment.doctor.name} scheduled for ${appointment.date} has been cancelled.\n\nPlease contact us to reschedule if needed.\n\nBest regards,\nDr. ${appointment.doctor.name}`,
      patientInfo: {
        name: patient.name,
        email: patient.email || null,
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

// Generic Agent Function
export async function callAgent(agentType: 'medical-history' | 'appointments' | 'medication-orders' | 'billing' | 'appointment-letters', token: string, patientId: string) {
  switch (agentType) {
    case 'medical-history':
      return getMedicalHistoryAgent(token, patientId);
    case 'appointments':
      return getAppointmentAgent(token, patientId);
    case 'medication-orders':
      return getMedicationOrderAgent(token, patientId);
    case 'billing':
      return getBillingAgent(token, patientId);
    case 'appointment-letters':
      return getAppointmentLetterAgent(token, patientId);
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}
