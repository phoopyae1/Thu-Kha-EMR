import { fetchJSON } from './http';

export type AppointmentStatus = 'Scheduled' | 'CheckedIn' | 'InProgress' | 'Completed' | 'Cancelled';
export type AppointmentStatusPatch = 'CheckedIn' | 'InProgress' | 'Completed' | 'Cancelled';

export interface AppointmentPatientSummary {
  patientId: string;
  name: string;
}

export interface AppointmentDoctorSummary {
  doctorId: string;
  name: string;
  department: string;
}

export interface Appointment {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  department: string;
  date: string;
  startTimeMin: number;
  endTimeMin: number;
  reason: string | null;
  location: string | null;
  status: AppointmentStatus;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  patient: AppointmentPatientSummary;
  doctor: AppointmentDoctorSummary;
}

export interface AppointmentCreateRequest {
  patientId: string;
  doctorId: string;
  department: string;
  date: string;
  startTimeMin: number;
  endTimeMin: number;
  reason?: string;
  location?: string;
}

export interface AppointmentUpdateRequest {
  patientId?: string;
  doctorId?: string;
  department?: string;
  date?: string;
  startTimeMin?: number;
  endTimeMin?: number;
  reason?: string;
  location?: string;
}

export interface AppointmentStatusUpdateRequest {
  status: AppointmentStatusPatch;
  cancelReason?: string;
}

export interface AppointmentListParams {
  date?: string;
  from?: string;
  to?: string;
  doctorId?: string;
  status?: AppointmentStatus;
  limit?: number;
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface AppointmentListResponse {
  data: Appointment[];
  nextCursor?: string | null;
}

export interface AppointmentQueueResponse {
  data: Appointment[];
}

export interface AvailabilitySlot {
  startMin: number;
  endMin: number;
}

export interface AvailabilityResponse {
  availability: AvailabilitySlot[];
  blocked: AvailabilitySlot[];
  freeSlots: AvailabilitySlot[];
}

export interface VisitCreatedResponse {
  visitId: string;
}

type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

function buildQuery(params?: QueryParams) {
  if (!params) return '';

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function listAppointments(params?: AppointmentListParams): Promise<AppointmentListResponse> {
  const query = buildQuery(params as QueryParams | undefined);
  return fetchJSON(`/appointments${query}`);
}

export interface AppointmentQueueParams {
  doctorId?: string;
  days?: number;
}

export function getAppointment(id: string): Promise<Appointment> {
  return fetchJSON(`/appointments/${id}`);
}

export function createAppointment(dto: AppointmentCreateRequest): Promise<Appointment> {
  return fetchJSON('/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
}

export function updateAppointment(id: string, dto: AppointmentUpdateRequest): Promise<Appointment> {
  return fetchJSON(`/appointments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
}

export function patchStatus(
  id: string,
  statusDto: AppointmentStatusUpdateRequest,
): Promise<Appointment | VisitCreatedResponse> {
  return fetchJSON(`/appointments/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(statusDto),
  });
}

export function getAvailability(doctorId: string, date: string): Promise<AvailabilityResponse> {
  const query = buildQuery({ doctorId, date });
  return fetchJSON(`/appointments/availability${query}`);
}

export function getAppointmentQueue(params?: AppointmentQueueParams): Promise<AppointmentQueueResponse> {
  const query = buildQuery(params as QueryParams | undefined);
  return fetchJSON(`/appointments/queue${query}`);
}

export function deleteAppointment(id: string): Promise<void> {
  return fetchJSON(`/appointments/${id}`, {
    method: 'DELETE',
  });
}
