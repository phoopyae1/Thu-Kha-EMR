export type FacilityType = 'GPClinic' | 'Hospital';

export interface PatientLoginResponse {
  accessToken: string;
  patient: {
    patientId: string;
    name: string;
  } | null;
}

export interface PatientPortalRegisterInput {
  name: string;
  email: string;
  password: string;
  dob: string;
  contact: string;
  insurance?: string;
  drugAllergies?: string;
}

export interface PatientPortalRegisterResponse {
  message: string;
  account: {
    accountId: string;
    patientId: string;
    email: string;
    status: string;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  patient: {
    patientId: string;
    name: string;
    dob: string;
    contact: string | null;
    insurance: string | null;
    drugAllergies: string | null;
  };
}

export interface IntegrationEmbed {
  iframeCode: string;
  contextKey: string;
  createdAt: string;
  updatedAt: string;
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

export async function fetchIntegrationEmbed(): Promise<IntegrationEmbed | null> {
  const response = await fetch('/api/patient-portal/integration-embeds/latest');

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  const body = (await response.json()) as { embed?: IntegrationEmbed | null };
  return body.embed ?? null;
}

export async function fetchAdminIntegrationEmbed(role?: string): Promise<IntegrationEmbed | null> {
  const url = role 
    ? `/api/patient-portal/admin-integration-embeds/latest?role=${encodeURIComponent(role)}`
    : '/api/patient-portal/admin-integration-embeds/latest';
  
  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  const body = (await response.json()) as { embed?: IntegrationEmbed | null };
  return body.embed ?? null;
}

export async function loginPatient(email: string, password: string): Promise<PatientLoginResponse> {
  const result = (await request('/api/patient-portal/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as PatientLoginResponse;

  return result;
}

export async function registerPatientPortalAccount(
  input: PatientPortalRegisterInput,
): Promise<PatientPortalRegisterResponse> {
  return request('/api/patient-portal/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }) as Promise<PatientPortalRegisterResponse>;
}

function authFetch(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  return request(path, { ...init, headers });
}

export interface FacilityResponse {
  facilityId: string;
  name: string;
  type: FacilityType;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mapUrl: string;
}

export async function fetchFacilities(params: { type?: FacilityType; search?: string } = {}) {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.search) search.set('search', params.search);
  const query = search.toString();
  const path = query ? `/api/patient-portal/facilities?${query}` : '/api/patient-portal/facilities';
  return request(path) as Promise<FacilityResponse[]>;
}

export interface SpecialistResponse {
  doctorId: string;
  name: string;
  department: string;
  facility?: {
    facilityId: string;
    name: string;
    city: string;
    state: string;
    phone?: string | null;
  } | null;
  availabilities: Array<{ dayOfWeek: number; startMin: number; endMin: number }>;
}

export async function fetchSpecialists(params: {
  department?: string;
  facilityId?: string;
  search?: string;
} = {}) {
  const search = new URLSearchParams();
  if (params.department) search.set('department', params.department);
  if (params.facilityId) search.set('facilityId', params.facilityId);
  if (params.search) search.set('search', params.search);
  const query = search.toString();
  const path = query ? `/api/patient-portal/specialists?${query}` : '/api/patient-portal/specialists';
  return request(path) as Promise<SpecialistResponse[]>;
}

export interface PatientProfileResponse {
  patient: {
    patientId: string;
    name: string;
    dob: string;
    gender: string;
    contact: string | null;
    insurance: string | null;
    drugAllergies: string | null;
  };
  appointments: {
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
  recentVisits: Array<{
    visitId: string;
    visitDate: string;
    department: string;
    doctor: { name: string };
  }>;
  invoiceSummary: {
    outstanding: number;
    lifetimeValue: number;
    paidTotal: number;
  };
  latestImmunization: {
    vaccineName: string;
    administeredAt: string;
    provider: string;
  } | null;
  medicines: Array<{
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
  prescriptions: Array<{
    prescriptionId: string;
    status: string;
    notes: string | null;
    createdAt: string;
    doctor: {
      name: string;
      department: string;
    };
    items: Array<{
      itemId: string;
      drugName: string;
      genericName: string | null;
      dose: string;
      route: string;
      frequency: string;
      durationDays: number;
      quantityPrescribed: number;
      prn: boolean;
      notes: string | null;
    }>;
  }>;
  medicationOrders: Array<{
    orderId: string;
    drugName: string | null;
    dosage: string | null;
    instructions: string | null;
    quantity: number | null;
    status: string;
    notes: string | null;
    createdAt: string;
    approvedAt: string | null;
  }>;
}

export async function fetchPatientProfile(token: string, patientId: string): Promise<PatientProfileResponse> {
  return authFetch(`/api/patient-portal/profile/${patientId}`, token) as Promise<PatientProfileResponse>;
}

export async function fetchPatientAppointments(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/appointments/${patientId}`, token);
}

export interface CreatePatientAppointmentInput {
  patientId: string;
  doctorId: string;
  department?: string;
  date: string;
  startTimeMin: number;
  endTimeMin?: number;
  reason?: string;
  location?: string;
}

export async function createPatientAppointment(token: string, body: CreatePatientAppointmentInput) {
  return authFetch('/api/patient-portal/appointments', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchLabResults(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/labs/${patientId}`, token);
}

export async function fetchImmunizations(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/immunizations/${patientId}`, token);
}

export async function fetchRadiologyReports(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/radiology/${patientId}`, token);
}

export async function fetchPayments(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/payments/${patientId}`, token);
}

export async function fetchMedications(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/medications/${patientId}`, token);
}

export async function fetchPrescriptions(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/prescriptions/${patientId}`, token);
}

export type MedicationOrderStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'SHIPPING'
  | 'ON_THE_WAY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface MedicationOrderResponse {
  orderId: string;
  patientId: string;
  prescriptionId?: string | null;
  drugName?: string | null;
  dosage?: string | null;
  instructions?: string | null;
  quantity?: number | null;
  status: MedicationOrderStatus;
  notes?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  prescription?: any;
  approvedBy?: { userId: string; email: string; role: string } | null;
  updatedBy?: { userId: string; email: string; role: string } | null;
}

export interface CreateMedicationOrderInput {
  patientId: string;
  prescriptionId?: string;
  drugName?: string;
  dosage?: string;
  instructions?: string;
  quantity?: number;
  notes?: string;
}

export async function fetchMedicationOrders(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/orders/${patientId}`, token) as Promise<
    MedicationOrderResponse[]
  >;
}

export async function createMedicationOrder(
  token: string,
  body: CreateMedicationOrderInput,
) {
  return authFetch('/api/patient-portal/orders', token, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<MedicationOrderResponse>;
}

export async function deleteMedicationOrder(token: string, orderId: string) {
  const response = await fetch(`/api/patient-portal/orders/${orderId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  
  // 204 No Content - successful deletion, no body to parse
  if (response.status === 204) {
    return;
  }
  
  // If there's content, parse it
  return response.json();
}
