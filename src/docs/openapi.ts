import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';

const appointmentExample = {
  appointmentId: 'a3f2bfae-1234-4e5f-9f4e-9d1d0c6bb001',
  patientId: '11111111-2222-3333-4444-555555555555',
  doctorId: '99999999-8888-7777-6666-555555555555',
  department: 'Cardiology',
  date: '2024-06-15T00:00:00.000Z',
  startTimeMin: 540,
  endTimeMin: 600,
  reason: 'Routine follow-up',
  location: 'Room 12B',
  status: 'Scheduled',
  cancelReason: null,
  createdAt: '2024-05-01T10:00:00.000Z',
  updatedAt: '2024-05-01T10:00:00.000Z',
  patient: {
    patientId: '11111111-2222-3333-4444-555555555555',
    name: 'Jane Doe',
  },
  doctor: {
    doctorId: '99999999-8888-7777-6666-555555555555',
    name: 'Dr. Smith',
    department: 'Cardiology',
  },
};

const appointmentCreateExample = {
  patientId: '11111111-2222-3333-4444-555555555555',
  doctorId: '99999999-8888-7777-6666-555555555555',
  department: 'Cardiology',
  date: '2024-06-15',
  startTimeMin: 540,
  endTimeMin: 600,
  reason: 'Routine follow-up',
  location: 'Room 12B',
};

const appointmentUpdateExample = {
  department: 'Cardiology',
  startTimeMin: 555,
  endTimeMin: 615,
  location: 'Telehealth',
};

const appointmentListExample = {
  data: [appointmentExample],
  nextCursor: 'b5aa0d46-8e08-4b9d-8b1e-2f0f14a6d7c3',
};

const availabilityExample = {
  availability: [
    { startMin: 480, endMin: 720 },
    { startMin: 780, endMin: 1020 },
  ],
  blocked: [{ startMin: 540, endMin: 600 }],
  freeSlots: [
    { startMin: 480, endMin: 540 },
    { startMin: 600, endMin: 720 },
    { startMin: 780, endMin: 900 },
    { startMin: 960, endMin: 1020 },
  ],
};

const statusPatchExample = {
  status: 'Cancelled',
  cancelReason: 'Patient requested cancellation',
};

const appointmentStatusUpdatedExample = {
  ...appointmentExample,
  status: 'Cancelled',
  cancelReason: 'Patient requested cancellation',
  updatedAt: '2024-06-15T13:55:00.000Z',
};

const visitCreatedExample = {
  visitId: '6f0c93de-5c34-4af9-9a3b-4bfbc147abcd',
};

const openapi: any = {
  openapi: '3.0.0',
  info: {
    title: 'Thu-Kha EMR API',
    version: '1.0.0',
    description: 'Complete API documentation for Thu-Kha EMR system including Patient Portal APIs for Atenxion agent integration',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Patient: {
        type: 'object',
        properties: {
          patientId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          dob: { type: 'string', format: 'date' },
          gender: { type: 'string', enum: ['M', 'F'] },
          contact: { type: 'string', nullable: true },
          insurance: { type: 'string', nullable: true },
          drugAllergies: { type: 'string', nullable: true }
        }
      },
      Doctor: {
        type: 'object',
        properties: {
          doctorId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          department: { type: 'string' }
        }
      },
      DoctorAvailabilitySlot: {
        type: 'object',
        properties: {
          availabilityId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
          startMin: { type: 'integer', minimum: 0, maximum: 1439 },
          endMin: { type: 'integer', minimum: 1, maximum: 1440 },
        },
      },
      DoctorAvailabilityResponse: {
        type: 'object',
        properties: {
          doctorId: { type: 'string', format: 'uuid' },
          availability: {
            type: 'array',
            items: { $ref: '#/components/schemas/DoctorAvailabilitySlot' },
          },
          defaultAvailability: {
            type: 'array',
            items: {
              type: 'object',
              required: ['startMin', 'endMin'],
              properties: {
                startMin: { type: 'integer', minimum: 0, maximum: 1439 },
                endMin: { type: 'integer', minimum: 1, maximum: 1440 },
              },
            },
          },
        },
      },
      DoctorAvailabilityCreateRequest: {
        type: 'object',
        required: ['dayOfWeek', 'startMin', 'endMin'],
        properties: {
          dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
          startMin: { type: 'integer', minimum: 0, maximum: 1439 },
          endMin: { type: 'integer', minimum: 1, maximum: 1440 },
        },
      },
      Visit: {
        type: 'object',
        properties: {
          visitId: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          visitDate: { type: 'string', format: 'date' },
          department: { type: 'string' },
          reason: { type: 'string', nullable: true },
          doctor: { $ref: '#/components/schemas/Doctor' }
        }
      },
      VisitDetail: {
        type: 'object',
        properties: {
          visitId: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          visitDate: { type: 'string', format: 'date' },
          department: { type: 'string' },
          reason: { type: 'string', nullable: true },
          doctor: { $ref: '#/components/schemas/Doctor' },
          diagnoses: { type: 'array', items: { $ref: '#/components/schemas/Diagnosis' } },
          medications: { type: 'array', items: { $ref: '#/components/schemas/Medication' } },
          labResults: { type: 'array', items: { $ref: '#/components/schemas/LabResult' } },
          observations: { type: 'array', items: { $ref: '#/components/schemas/Observation' } },
        }
      },
      Diagnosis: {
        type: 'object',
        properties: {
          diagId: { type: 'string', format: 'uuid' },
          visitId: { type: 'string', format: 'uuid' },
          diagnosis: { type: 'string' }
        }
      },
      Medication: {
        type: 'object',
        properties: {
          medId: { type: 'string', format: 'uuid' },
          visitId: { type: 'string', format: 'uuid' },
          drugName: { type: 'string' },
          dosage: { type: 'string', nullable: true },
          instructions: { type: 'string', nullable: true }
        }
      },
      LabResult: {
        type: 'object',
        properties: {
          labId: { type: 'string', format: 'uuid' },
          visitId: { type: 'string', format: 'uuid' },
          testName: { type: 'string' },
          resultValue: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          referenceRange: { type: 'string', nullable: true },
          testDate: { type: 'string', format: 'date', nullable: true }
        }
      },
      Observation: {
        type: 'object',
        properties: {
          obsId: { type: 'string', format: 'uuid' },
          visitId: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          noteText: { type: 'string' },
          bpSystolic: { type: 'integer', nullable: true },
          bpDiastolic: { type: 'integer', nullable: true },
          heartRate: { type: 'integer', nullable: true },
          temperatureC: { type: 'number', nullable: true },
          spo2: { type: 'integer', nullable: true },
          bmi: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      DiagnosisCreate: {
        type: 'object',
        required: ['diagnosis'],
        properties: {
          diagnosis: { type: 'string' },
        },
      },
      MedicationCreate: {
        type: 'object',
        required: ['drugName'],
        properties: {
          drugName: { type: 'string' },
          dosage: { type: 'string', nullable: true },
          instructions: { type: 'string', nullable: true },
        },
      },
      LabResultCreate: {
        type: 'object',
        required: ['testName'],
        properties: {
          testName: { type: 'string' },
          resultValue: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          referenceRange: { type: 'string', nullable: true },
          testDate: { type: 'string', format: 'date', nullable: true },
        },
      },
      ObservationCreate: {
        type: 'object',
        required: ['noteText'],
        properties: {
          noteText: { type: 'string' },
          bpSystolic: { type: 'integer', nullable: true },
          bpDiastolic: { type: 'integer', nullable: true },
          heartRate: { type: 'integer', nullable: true },
          temperatureC: { type: 'number', nullable: true },
          spo2: { type: 'integer', nullable: true },
          bmi: { type: 'number', nullable: true },
        },
      },
      ObservationListResponse: {
        type: 'array',
        items: { $ref: '#/components/schemas/Observation' }
      },
      ReportTotals: {
        type: 'object',
        properties: {
          patients: { type: 'integer', minimum: 0 },
          doctors: { type: 'integer', minimum: 0 },
          activePatients: { type: 'integer', minimum: 0 },
          visitsLast30Days: { type: 'integer', minimum: 0 },
          upcomingAppointments: { type: 'integer', minimum: 0 }
        }
      },
      ReportDepartmentBreakdown: {
        type: 'object',
        properties: {
          department: { type: 'string' },
          visitCount: { type: 'integer', minimum: 0 },
          patientCount: { type: 'integer', minimum: 0 }
        }
      },
      ReportDiagnosisEntry: {
        type: 'object',
        properties: {
          diagnosis: { type: 'string' },
          count: { type: 'integer', minimum: 0 }
        }
      },
      ReportLabSummary: {
        type: 'object',
        properties: {
          testName: { type: 'string' },
          tests: { type: 'integer', minimum: 0 },
          averageValue: { type: 'number', nullable: true },
          lastTestDate: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      MonthlyVisitTrend: {
        type: 'object',
        properties: {
          month: { type: 'string', format: 'date-time' },
          visitCount: { type: 'integer', minimum: 0 }
        }
      },
      ReportSummary: {
        type: 'object',
        properties: {
          totals: { $ref: '#/components/schemas/ReportTotals' },
          visitsByDepartment: {
            type: 'array',
            items: { $ref: '#/components/schemas/ReportDepartmentBreakdown' }
          },
          topDiagnoses: {
            type: 'array',
            items: { $ref: '#/components/schemas/ReportDiagnosisEntry' }
          },
          labSummaries: {
            type: 'array',
            items: { $ref: '#/components/schemas/ReportLabSummary' }
          },
          monthlyVisitTrends: {
            type: 'array',
            items: { $ref: '#/components/schemas/MonthlyVisitTrend' }
          }
        }
      },
      Error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'integer', format: 'int32' },
          message: { type: 'string' },
          details: {
            type: 'object',
            nullable: true,
            additionalProperties: true,
          },
        },
      },
      Tokens: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' }
        }
      },
      AppointmentStatus: {
        type: 'string',
        description: 'Lifecycle status for an appointment.',
        enum: ['Scheduled', 'CheckedIn', 'InProgress', 'Completed', 'Cancelled']
      },
      AppointmentStatusPatch: {
        type: 'string',
        description: 'Allowed target statuses when updating an appointment status.',
        enum: ['CheckedIn', 'InProgress', 'Completed', 'Cancelled']
      },
      AppointmentPatientSummary: {
        type: 'object',
        required: ['patientId', 'name'],
        properties: {
          patientId: { type: 'string', format: 'uuid' },
          name: { type: 'string' }
        }
      },
      AppointmentDoctorSummary: {
        type: 'object',
        required: ['doctorId', 'name', 'department'],
        properties: {
          doctorId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          department: { type: 'string' }
        }
      },
      Appointment: {
        type: 'object',
        required: [
          'appointmentId',
          'patientId',
          'doctorId',
          'department',
          'date',
          'startTimeMin',
          'endTimeMin',
          'status',
          'createdAt',
          'updatedAt',
          'patient',
          'doctor'
        ],
        properties: {
          appointmentId: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          department: { type: 'string' },
          date: { type: 'string', format: 'date-time' },
          startTimeMin: { type: 'integer', minimum: 0, maximum: 1440 },
          endTimeMin: { type: 'integer', minimum: 0, maximum: 1440 },
          reason: { type: 'string', nullable: true },
          location: { type: 'string', nullable: true },
          status: { $ref: '#/components/schemas/AppointmentStatus' },
          cancelReason: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          patient: { $ref: '#/components/schemas/AppointmentPatientSummary' },
          doctor: { $ref: '#/components/schemas/AppointmentDoctorSummary' }
        }
      },
      AppointmentCreateRequest: {
        type: 'object',
        required: [
          'patientId',
          'doctorId',
          'department',
          'date',
          'startTimeMin',
          'endTimeMin'
        ],
        properties: {
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          department: { type: 'string' },
          date: { type: 'string', format: 'date' },
          startTimeMin: { type: 'integer', minimum: 0, maximum: 1440 },
          endTimeMin: { type: 'integer', minimum: 0, maximum: 1440 },
          reason: { type: 'string' },
          location: { type: 'string' }
        }
      },
      AppointmentUpdateRequest: {
        type: 'object',
        properties: {
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid' },
          department: { type: 'string' },
          date: { type: 'string', format: 'date' },
          startTimeMin: { type: 'integer', minimum: 0, maximum: 1440 },
          endTimeMin: { type: 'integer', minimum: 0, maximum: 1440 },
          reason: { type: 'string' },
          location: { type: 'string' }
        }
      },
      AppointmentStatusUpdateRequest: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { $ref: '#/components/schemas/AppointmentStatusPatch' },
          cancelReason: {
            type: 'string',
            description: 'Reason is only applicable when cancelling an appointment.'
          }
        }
      },
      AppointmentListResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Appointment' }
          },
          nextCursor: {
            type: 'string',
            format: 'uuid',
            description: 'Cursor to request the next page of appointments.',
            nullable: true
          }
        }
      },
      AvailabilitySlot: {
        type: 'object',
        required: ['startMin', 'endMin'],
        properties: {
          startMin: {
            type: 'integer',
            minimum: 0,
            maximum: 1440,
            description: 'Inclusive minute offset from the start of the day.'
          },
          endMin: {
            type: 'integer',
            minimum: 0,
            maximum: 1440,
            description: 'Exclusive minute offset from the start of the day.'
          }
        }
      },
      AvailabilityResponse: {
        type: 'object',
        required: ['availability', 'blocked', 'freeSlots'],
        properties: {
          availability: {
            type: 'array',
            description: 'Configured availability windows for the doctor on the requested date.',
            items: { $ref: '#/components/schemas/AvailabilitySlot' }
          },
          blocked: {
            type: 'array',
            description: 'Merged blackout periods and booked appointments.',
            items: { $ref: '#/components/schemas/AvailabilitySlot' }
          },
          freeSlots: {
            type: 'array',
            description: 'Available time ranges after removing blocked periods.',
            items: { $ref: '#/components/schemas/AvailabilitySlot' }
          }
        }
      },
      VisitCreatedResponse: {
        type: 'object',
        required: ['visitId'],
        properties: {
          visitId: { type: 'string', format: 'uuid' }
        }
      }
    }
  },
  security: [],
  paths: {}
};

const paths: Record<string, any> = {};
function addPath(path: string, method: string, spec: any) {
  if (!paths[path]) paths[path] = {};
  paths[path][method] = spec;
}

addPath('/health', 'get', {
  summary: 'Health check',
  security: [],
  responses: { '200': { description: 'OK' } }
});

// Patient Portal APIs
addPath('/patient-portal/register', 'post', {
  summary: '[Patient Portal] Register new account',
  description: 'Create a new patient portal account. Account is activated immediately.',
  tags: ['Patient Portal'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name', 'email', 'password', 'dob', 'contact'],
          properties: {
            name: { type: 'string', example: 'John Doe' },
            email: { type: 'string', format: 'email', example: 'john@example.com' },
            password: { type: 'string', minLength: 8, example: 'SecurePass123!' },
            dob: { type: 'string', format: 'date', example: '1990-01-15' },
            contact: { type: 'string', example: '09123456789' },
            insurance: { type: 'string', nullable: true, example: 'ACME Insurance' },
            drugAllergies: { type: 'string', nullable: true, example: 'Penicillin' },
          },
        },
      },
    },
  },
  responses: {
    '201': {
      description: 'Account created successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              account: {
                type: 'object',
                properties: {
                  accountId: { type: 'string', format: 'uuid' },
                  patientId: { type: 'string', format: 'uuid' },
                  email: { type: 'string', format: 'email' },
                  status: { type: 'string', enum: ['active', 'inactive'] },
                  lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
              patient: {
                type: 'object',
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  dob: { type: 'string', format: 'date' },
                  contact: { type: 'string', nullable: true },
                  insurance: { type: 'string', nullable: true },
                  drugAllergies: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },
    },
    '409': { description: 'Email already in use' },
  },
});

addPath('/patient-portal/login', 'post', {
  summary: '[Patient Portal] Login',
  description: 'Authenticate and get access token for patient portal',
  tags: ['Patient Portal'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'patient@example.com' },
            password: { type: 'string', example: 'PatientPass123!' },
          },
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              patient: {
                type: 'object',
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    '401': { description: 'Invalid credentials or account inactive' },
  },
});

addPath('/patient-portal/profile/{patientId}', 'get', {
  summary: '[Patient Portal] Get patient profile',
  description: 'Get comprehensive patient profile with visits, appointments, and billing summary',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    '200': { description: 'Patient profile data' },
    '401': { description: 'Unauthorized' },
    '404': { description: 'Patient not found' },
  },
});

addPath('/patient-portal/appointments/{patientId}', 'get', {
  summary: '[Patient Portal] Get patient appointments',
  description: 'Get all appointments for a patient (upcoming and past)',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    '200': {
      description: 'Appointments split into upcoming and past',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              upcoming: { type: 'array', items: { $ref: '#/components/schemas/Appointment' } },
              past: { type: 'array', items: { $ref: '#/components/schemas/Appointment' } },
            },
          },
        },
      },
    },
  },
});

addPath('/patient-portal/appointments', 'post', {
  summary: '[Patient Portal] Schedule appointment',
  description: 'Create a new appointment for a patient. For Atenxion agent scheduling.',
  tags: ['Patient Portal', 'Atenxion'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['patientId', 'doctorId', 'date', 'startTimeMin'],
          properties: {
            patientId: { type: 'string', format: 'uuid' },
            doctorId: { type: 'string', format: 'uuid' },
            department: { type: 'string', example: 'Cardiology' },
            date: { type: 'string', format: 'date', example: '2025-10-25' },
            startTimeMin: { type: 'integer', minimum: 0, maximum: 1440, example: 540, description: 'Minutes from midnight (540 = 9:00 AM)' },
            endTimeMin: { type: 'integer', minimum: 0, maximum: 1440, example: 570 },
            reason: { type: 'string', example: 'Annual physical checkup' },
            location: { type: 'string', example: 'Main Clinic' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Appointment created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Appointment' } } } },
    '409': { description: 'Time slot already booked' },
  },
});

addPath('/patient-portal/labs/{patientId}', 'get', {
  summary: '[Patient Portal] Get lab results',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '200': { description: 'Lab results' } },
});

addPath('/patient-portal/medications/{patientId}', 'get', {
  summary: '[Patient Portal] Get medications',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '200': { description: 'Medications' } },
});

addPath('/patient-portal/immunizations/{patientId}', 'get', {
  summary: '[Patient Portal] Get immunizations',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '200': { description: 'Immunization records' } },
});

addPath('/patient-portal/radiology/{patientId}', 'get', {
  summary: '[Patient Portal] Get radiology reports',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '200': { description: 'Radiology reports' } },
});

addPath('/patient-portal/payments/{patientId}', 'get', {
  summary: '[Patient Portal] Get invoices and payments',
  tags: ['Patient Portal'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '200': { description: 'Invoices with payment history' } },
});

addPath('/patient-portal/specialists', 'get', {
  summary: '[Patient Portal] Get specialists',
  description: 'Public endpoint to list available doctors/specialists. No authentication required.',
  tags: ['Patient Portal', 'Public'],
  security: [],
  parameters: [
    { name: 'department', in: 'query', schema: { type: 'string' }, example: 'Cardiology' },
    { name: 'search', in: 'query', schema: { type: 'string' }, example: 'smith' },
  ],
  responses: { '200': { description: 'List of specialists' } },
});

addPath('/patient-portal/facilities', 'get', {
  summary: '[Patient Portal] Get facilities',
  description: 'Public endpoint to list clinic facilities. No authentication required.',
  tags: ['Patient Portal', 'Public'],
  security: [],
  parameters: [
    { name: 'type', in: 'query', schema: { type: 'string', enum: ['HOSPITAL', 'GP_CLINIC', 'DIAGNOSTIC_CENTER'] } },
    { name: 'search', in: 'query', schema: { type: 'string' } },
  ],
  responses: { '200': { description: 'List of facilities' } },
});

addPath('/auth/login', 'post', {
  summary: '[Staff] Login',
  description: 'Staff authentication endpoint. Returns JWT access token.',
  tags: ['Authentication'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'admin@example.com' },
            password: { type: 'string', example: 'AdminPass123!' },
          },
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Login successful',
      content: { 
        'application/json': { 
          schema: { 
            type: 'object',
            properties: {
              accessToken: { type: 'string', description: 'JWT Bearer token' },
            },
          },
        },
      },
    },
    '401': { description: 'Invalid credentials' },
  }
});

addPath('/auth/password/change', 'post', {
  summary: 'Change password',
  security: [],
  responses: { '200': { description: 'OK' } }
});

addPath('/auth/token/refresh', 'post', {
  summary: 'Refresh access token',
  security: [],
  responses: {
    '200': {
      description: 'Tokens',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Tokens' } } }
    }
  }
});

addPath('/auth/logout', 'post', {
  summary: 'Logout',
  security: [],
  responses: { '204': { description: 'Logged out' } }
});

addPath('/auth/password/forgot', 'post', {
  summary: 'Forgot password',
  security: [],
  responses: { '200': { description: 'OK' } }
});

addPath('/auth/password/reset', 'post', {
  summary: 'Reset password',
  security: [],
  responses: { '200': { description: 'OK' } }
});

addPath('/visits', 'post', {
  summary: 'Create visit',
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['patientId', 'visitDate', 'doctorId', 'department'],
          properties: {
            patientId: { type: 'string', format: 'uuid' },
            visitDate: { type: 'string', format: 'date' },
            doctorId: { type: 'string', format: 'uuid' },
            department: { type: 'string' },
            reason: { type: 'string', nullable: true },
            diagnoses: { type: 'array', items: { $ref: '#/components/schemas/DiagnosisCreate' } },
            medications: { type: 'array', items: { $ref: '#/components/schemas/MedicationCreate' } },
            labResults: { type: 'array', items: { $ref: '#/components/schemas/LabResultCreate' } },
            observations: { type: 'array', items: { $ref: '#/components/schemas/ObservationCreate' } },
          },
        },
      },
    },
  },
  responses: {
    '201': {
      description: 'Created',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/VisitDetail' } },
      },
    },
  },
});

addPath('/patients/{id}/visits', 'get', {
  summary: 'List visits for patient',
  security: [],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '200': { description: 'Visits', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Visit' } } } } } }
});

addPath('/visits/{id}', 'get', {
  summary: 'Get visit detail',
  security: [],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: {
    '200': {
      description: 'Visit',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/VisitDetail' } } },
    },
    '404': { description: 'Not found' },
  },
});

addPath('/patients', 'post', {
  summary: 'Register patient',
  security: [],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name', 'dob', 'insurance'],
          properties: {
            name: { type: 'string' },
            dob: { type: 'string', format: 'date' },
            insurance: { type: 'string' },
            drugAllergies: { type: 'string' }
          },
        },
      },
    },
  },
  responses: {
    '201': {
      description: 'Created',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Patient' } } },
    },
  },
});

addPath('/patients', 'get', {
  summary: 'Search patients',
  security: [],
  parameters: [
    { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    '200': {
      description: 'Patients',
      content: {
        'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Patient' } } },
      },
    },
  },
});

addPath('/patients/{id}', 'get', {
  summary: 'Get patient',
  security: [],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    { name: 'include', in: 'query', schema: { type: 'string', enum: ['summary'] } }
  ],
  responses: { '200': { description: 'Patient', content: { 'application/json': { schema: { $ref: '#/components/schemas/Patient' } } } }, '404': { description: 'Not found' } }
});

addPath('/doctors', 'get', {
  summary: 'Search doctors',
  security: [],
  parameters: [
    { name: 'department', in: 'query', schema: { type: 'string' } },
    { name: 'q', in: 'query', schema: { type: 'string' } }
  ],
  responses: { '200': { description: 'Doctors', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Doctor' } } } } } }
});

addPath('/doctors', 'post', {
  summary: 'Create doctor',
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name', 'department'],
          properties: {
            name: { type: 'string' },
            department: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': {
      description: 'Doctor',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Doctor' } } },
    },
  },
});

addPath('/doctors/{doctorId}/availability', 'get', {
  summary: 'List doctor availability windows',
  security: [],
  parameters: [
    {
      name: 'doctorId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description: 'Doctor identifier to inspect.',
    },
  ],
  responses: {
    '200': {
      description: 'Availability windows configured for the doctor.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/DoctorAvailabilityResponse' },
          example: {
            doctorId: '99999999-8888-7777-6666-555555555555',
            availability: [
              {
                availabilityId: '00000000-0000-0000-0000-000000000001',
                doctorId: '99999999-8888-7777-6666-555555555555',
                dayOfWeek: 1,
                startMin: 540,
                endMin: 720,
              },
            ],
            defaultAvailability: [
              { startMin: 540, endMin: 1020 },
            ],
          },
        },
      },
    },
    '404': { description: 'Doctor not found' },
  },
});

addPath('/doctors/{doctorId}/availability', 'post', {
  summary: 'Add an availability window for a doctor',
  security: [],
  parameters: [
    {
      name: 'doctorId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/DoctorAvailabilityCreateRequest' },
      },
    },
  },
  responses: {
    '201': {
      description: 'Created availability window',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/DoctorAvailabilitySlot' },
        },
      },
    },
    '400': { description: 'Invalid request payload' },
    '404': { description: 'Doctor not found' },
    '409': { description: 'Conflicts with an existing window' },
  },
});

addPath('/appointments/availability', 'get', {
  summary: 'Get appointment availability for a doctor',
  description:
    'Returns configured availability, blocked segments, and computed free slots for the requested day.',
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'doctorId',
      in: 'query',
      required: true,
      description: 'Doctor identifier to evaluate availability for.',
      schema: { type: 'string', format: 'uuid' },
    },
    {
      name: 'date',
      in: 'query',
      required: true,
      description: 'Date to evaluate availability for (YYYY-MM-DD).',
      schema: { type: 'string', format: 'date' },
    },
  ],
  responses: {
    '200': {
      description: 'Availability for the requested doctor and day.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/AvailabilityResponse' },
          example: availabilityExample,
        },
      },
    },
    '400': {
      description: 'Invalid request.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '401': { description: 'Unauthorized' },
  },
});

addPath('/appointments', 'post', {
  summary: 'Create appointment',
  description: 'Creates a new appointment after validating doctor availability and conflicts.',
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentCreateRequest' },
        example: appointmentCreateExample,
      },
    },
  },
  responses: {
    '201': {
      description: 'Created appointment.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Appointment' },
          example: appointmentExample,
        },
      },
    },
    '400': {
      description: 'Invalid request or unavailable time slot.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '401': { description: 'Unauthorized' },
    '404': {
      description: 'Patient or doctor not found.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  },
});

addPath('/appointments', 'get', {
  summary: 'List appointments',
  description: 'Returns appointments with optional filtering and pagination.',
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'date',
      in: 'query',
      description: 'Filter to appointments scheduled on this date (YYYY-MM-DD).',
      schema: { type: 'string', format: 'date' },
    },
    {
      name: 'from',
      in: 'query',
      description: 'Return appointments occurring on or after this date (YYYY-MM-DD).',
      schema: { type: 'string', format: 'date' },
    },
    {
      name: 'to',
      in: 'query',
      description: 'Return appointments before the day after this date (YYYY-MM-DD).',
      schema: { type: 'string', format: 'date' },
    },
    {
      name: 'doctorId',
      in: 'query',
      description: 'Filter by doctor identifier.',
      schema: { type: 'string', format: 'uuid' },
    },
    {
      name: 'status',
      in: 'query',
      description: 'Filter by appointment status.',
      schema: {
        type: 'string',
        enum: ['Scheduled', 'CheckedIn', 'InProgress', 'Completed', 'Cancelled'],
      },
    },
    {
      name: 'limit',
      in: 'query',
      description: 'Maximum number of records to return (keyset pagination).',
      schema: { type: 'integer', minimum: 1, maximum: 100 },
    },
    {
      name: 'cursor',
      in: 'query',
      description: 'Cursor (appointmentId) for keyset pagination.',
      schema: { type: 'string', format: 'uuid' },
    },
    {
      name: 'page',
      in: 'query',
      description: 'Page number when using offset pagination.',
      schema: { type: 'integer', minimum: 1 },
    },
    {
      name: 'pageSize',
      in: 'query',
      description: 'Page size when using offset pagination.',
      schema: { type: 'integer', minimum: 1, maximum: 100 },
    },
  ],
  responses: {
    '200': {
      description: 'Appointments matching the supplied filters.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/AppointmentListResponse' },
          example: appointmentListExample,
        },
      },
    },
    '400': {
      description: 'Invalid request.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '401': { description: 'Unauthorized' },
  },
});

addPath('/appointments/{appointmentId}', 'get', {
  summary: 'Get appointment',
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'appointmentId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  responses: {
    '200': {
      description: 'Appointment detail.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Appointment' },
          example: appointmentExample,
        },
      },
    },
    '401': { description: 'Unauthorized' },
    '404': {
      description: 'Appointment not found.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  },
});

addPath('/appointments/{appointmentId}', 'put', {
  summary: 'Update appointment',
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'appointmentId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentUpdateRequest' },
        example: appointmentUpdateExample,
      },
    },
  },
  responses: {
    '200': {
      description: 'Updated appointment.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Appointment' },
          example: appointmentExample,
        },
      },
    },
    '400': {
      description: 'Invalid request or unavailable time slot.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '401': { description: 'Unauthorized' },
    '404': {
      description: 'Appointment not found.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  },
});

addPath('/appointments/{appointmentId}', 'delete', {
  summary: 'Delete appointment',
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'appointmentId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  responses: {
    '204': { description: 'Appointment deleted.' },
    '401': { description: 'Unauthorized' },
    '404': {
      description: 'Appointment not found.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  },
});

addPath('/appointments/{appointmentId}/status', 'patch', {
  summary: 'Update appointment status',
  description:
    'Transitions an appointment to a new status and optionally creates a visit when completing the appointment.',
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'appointmentId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/AppointmentStatusUpdateRequest' },
        example: statusPatchExample,
      },
    },
  },
  responses: {
    '200': {
      description: 'Updated appointment or visit identifier when the appointment is completed.',
      content: {
        'application/json': {
          schema: {
            oneOf: [
              { $ref: '#/components/schemas/Appointment' },
              { $ref: '#/components/schemas/VisitCreatedResponse' },
            ],
          },
          examples: {
            appointment: {
              summary: 'Status changed without creating a visit',
              value: appointmentStatusUpdatedExample,
            },
            visitCreated: {
              summary: 'Visit created when marking the appointment as completed',
              value: visitCreatedExample,
            },
          },
        },
      },
    },
    '400': {
      description: 'Invalid status transition or request.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '401': { description: 'Unauthorized' },
    '404': {
      description: 'Appointment not found.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  },
});

addPath('/visits/{id}/diagnoses', 'post', {
  summary: 'Add diagnosis',
  security: [],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Diagnosis' } } } } }
});

addPath('/diagnoses', 'get', {
  summary: 'List diagnoses',
  security: [],
  parameters: [
    { name: 'q', in: 'query', schema: { type: 'string' } },
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { '200': { description: 'Diagnoses', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Diagnosis' } } } } } }
});

addPath('/visits/{id}/medications', 'post', {
  summary: 'Add medication',
  security: [],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Medication' } } } } }
});

addPath('/medications', 'get', {
  summary: 'List medications',
  security: [],
  parameters: [
    { name: 'patient_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { '200': { description: 'Medications', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Medication' } } } } } }
});

addPath('/visits/{id}/labs', 'post', {
  summary: 'Add lab result',
  security: [],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/LabResult' } } } } }
});

addPath('/labs', 'get', {
  summary: 'List lab results',
  security: [],
  parameters: [
    { name: 'patient_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
    { name: 'test_name', in: 'query', schema: { type: 'string' } },
    { name: 'min', in: 'query', schema: { type: 'number' } },
    { name: 'max', in: 'query', schema: { type: 'number' } },
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { '200': { description: 'Lab results', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/LabResult' } } } } } }
});

addPath('/visits/{id}/observations', 'post', {
  summary: 'Add observation',
  security: [],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Observation' } } } } }
});

addPath('/visits/{id}/observations', 'get', {
  summary: 'List visit observations',
  security: [],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    { name: 'scope', in: 'query', schema: { type: 'string', enum: ['visit', 'patient'] } },
    { name: 'author', in: 'query', schema: { type: 'string', enum: ['me', 'any'] } },
    { name: 'before', in: 'query', schema: { type: 'string', enum: ['visit', 'none'] } },
    { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } }
  ],
  responses: {
    '200': {
      description: 'Observations',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationListResponse' } } }
    }
  }
});

addPath('/patients/{patientId}/observations', 'get', {
  summary: 'List patient observations',
  security: [],
  parameters: [
    { name: 'patientId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    { name: 'author', in: 'query', schema: { type: 'string', enum: ['me', 'any'] } },
    { name: 'before_visit', in: 'query', schema: { type: 'string', format: 'uuid' } },
    { name: 'exclude_visit', in: 'query', schema: { type: 'string', format: 'uuid' } },
    { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } }
  ],
  responses: {
    '200': {
      description: 'Observations',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationListResponse' } } }
    }
  }
});

addPath('/insights/patient-summary', 'get', {
  summary: 'Patient summary',
  security: [],
  parameters: [
    { name: 'patient_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
    { name: 'last_n', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { '200': { description: 'Summary' } }
});

addPath('/insights/latest-visit', 'get', {
  summary: 'Latest visit for patient',
  security: [],
  parameters: [
    { name: 'patient_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
  ],
  responses: { '200': { description: 'Visit', content: { 'application/json': { schema: { $ref: '#/components/schemas/Visit' } } } }, '404': { description: 'Not found' } }
});

addPath('/insights/cohort', 'get', {
  summary: 'Cohort query',
  security: [],
  parameters: [
    { name: 'test_name', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'op', in: 'query', schema: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq'] } },
    { name: 'value', in: 'query', required: true, schema: { type: 'number' } },
    { name: 'months', in: 'query', required: true, schema: { type: 'integer' } }
  ],
  responses: { '200': { description: 'Cohort' } }
});

addPath('/reports/summary', 'get', {
  summary: 'Reporting summary',
  security: [{ bearerAuth: [] }],
  responses: {
    '200': {
      description: 'Aggregated reporting metrics',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSummary' } } },
    },
    '401': { description: 'Unauthorized' },
  },
});

addPath('/audit', 'get', {
  summary: 'Audit log',
  security: [],
  parameters: [
    { name: 'entity', in: 'query', schema: { type: 'string' } },
    { name: 'entity_id', in: 'query', schema: { type: 'string' } },
    { name: 'actor', in: 'query', schema: { type: 'string' } },
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'offset', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { '200': { description: 'Audit events' } }
});

openapi.paths = paths;

export const docsRouter = Router();

// Serve OpenAPI JSON
docsRouter.get('/docs/openapi.json', (_req: Request, res: Response) => {
  res.json(openapi);
});

// Swagger UI
const swaggerOptions = {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Thu-Kha EMR API Docs',
  customfavIcon: '/favicon.ico',
};

docsRouter.use('/docs', swaggerUi.serve);
docsRouter.get('/docs', swaggerUi.setup(openapi, swaggerOptions));

export default docsRouter;
