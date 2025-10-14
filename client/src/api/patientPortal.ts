export type FacilityType = 'GPClinic' | 'Hospital';

export interface PatientLoginResponse {
  accessToken: string;
  patient: {
    patientId: string;
    name: string;
  } | null;
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

export async function loginPatient(email: string, password: string): Promise<PatientLoginResponse> {
  const result = (await request('/api/patient-portal/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as PatientLoginResponse;

  return result;
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

export async function fetchPatientProfile(token: string, patientId: string) {
  return authFetch(`/api/patient-portal/profile/${patientId}`, token);
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
