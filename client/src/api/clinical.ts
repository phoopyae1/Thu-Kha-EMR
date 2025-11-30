import { fetchJSON } from './http';

export interface VitalsEntry {
  vitalsId: string;
  visitId: string;
  patientId: string;
  recordedBy: string;
  recordedAt: string;
  systolic: number | null;
  diastolic: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  notes: string | null;
}

export interface CreateVitalsPayload {
  visitId: string;
  patientId: string;
  systolic?: number | null;
  diastolic?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  notes?: string;
}

export async function createVitals(payload: CreateVitalsPayload): Promise<VitalsEntry> {
  return fetchJSON('/vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function listVitals(
  patientId: string,
  limit = 25,
): Promise<VitalsEntry[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const response = await fetchJSON(`/patients/${patientId}/vitals?${query.toString()}`);
  return response.data as VitalsEntry[];
}

export type ProblemStatus = 'ACTIVE' | 'RESOLVED';

export interface ProblemEntry {
  problemId: string;
  patientId: string;
  codeSystem: string | null;
  code: string | null;
  display: string;
  onsetDate: string | null;
  status: ProblemStatus;
  resolvedDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProblemPayload {
  patientId: string;
  codeSystem?: string;
  code?: string;
  display: string;
  onsetDate?: string;
  status?: ProblemStatus;
  resolvedDate?: string;
}

export async function createProblem(payload: CreateProblemPayload): Promise<ProblemEntry> {
  return fetchJSON('/problems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function listProblems(
  patientId: string,
  status?: ProblemStatus | 'ALL',
): Promise<ProblemEntry[]> {
  const params = new URLSearchParams();
  if (status && status !== 'ALL') {
    params.set('status', status);
  }
  const query = params.toString();
  const response = await fetchJSON(`/patients/${patientId}/problems${query ? `?${query}` : ''}`);
  return response.data as ProblemEntry[];
}

export async function updateProblemStatus(
  problemId: string,
  status: ProblemStatus,
  resolvedDate?: string,
): Promise<ProblemEntry> {
  return fetchJSON(`/problems/${problemId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, resolvedDate }),
  });
}

export type LabOrderStatus = 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type LabItemStatus = 'ORDERED' | 'RESULTED' | 'CANCELLED';

export interface LabOrderItemEntry {
  labOrderItemId: string;
  labOrderId: string;
  testCode: string;
  testName: string;
  status: LabItemStatus;
  specimen: string | null;
  notes: string | null;
  results?: LabResultEntry[];
}

export interface LabOrderEntry {
  labOrderId: string;
  orderId: string | null; // Numbered order ID per doctor (1, 2, 3, etc.)
  visitId: string;
  patientId: string;
  patientName: string | null; // Patient name
  doctorId: string;
  status: LabOrderStatus;
  priority: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: LabOrderItemEntry[];
  results: LabResultEntry[];
}

export interface LabResultEntry {
  labResultId: string;
  labOrderId: string;
  labOrderItemId: string;
  patientId: string;
  resultValue: string | null;
  resultValueNum: number | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  abnormalFlag: string | null;
  resultedBy: string;
  resultedAt: string;
  notes: string | null;
}

export interface CreateLabOrderPayload {
  visitId: string;
  patientId: string;
  priority?: string;
  notes?: string;
  items: Array<{
    testCode: string;
    testName: string;
    specimen?: string;
    notes?: string;
  }>;
}

export async function createLabOrder(payload: CreateLabOrderPayload): Promise<LabOrderEntry> {
  return fetchJSON('/lab-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function listLabOrders(params: {
  patientId?: string;
  visitId?: string;
  status?: LabOrderStatus | '';
}): Promise<LabOrderEntry[]> {
  const search = new URLSearchParams();
  if (params.patientId) search.set('patientId', params.patientId);
  if (params.visitId) search.set('visitId', params.visitId);
  if (params.status) search.set('status', params.status);
  const query = search.toString();
  const response = await fetchJSON(`/lab-orders${query ? `?${query}` : ''}`);
  return response.data as LabOrderEntry[];
}

export async function deleteLabOrder(labOrderId: string): Promise<void> {
  await fetchJSON(`/lab-orders/${labOrderId}`, {
    method: 'DELETE',
  });
}

export async function getLabOrderDetail(labOrderId: string): Promise<LabOrderEntry | null> {
  return fetchJSON(`/lab-orders/${labOrderId}`);
}

export interface EnterLabResultPayload {
  labOrderItemId: string;
  patientId?: string;
  resultValue?: string;
  resultValueNum?: number;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  notes?: string;
}

export async function enterLabResult(payload: EnterLabResultPayload): Promise<LabResultEntry> {
  return fetchJSON('/lab-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface CreateClinicalDocPayload {
  visitId?: string;
  patientId?: string;
  visitDate?: string | Date;
  doctorId?: string;
  diagnoses?: Array<{ diagnosis: string }>;
  prescriptions?: Array<{
    drugName: string;
    dose: string;
    route: string;
    frequency: string;
    durationDays: number;
    quantityPrescribed?: number;
    prn?: boolean;
    allowGeneric?: boolean;
    notes?: string;
  }>;
  labResults?: Array<{
    testName: string;
    value?: number;
    unit?: string;
  }>;
  observationNote?: {
    noteText?: string;
    bpSystolic?: number;
    bpDiastolic?: number;
    heartRate?: number;
    temperatureC?: number;
    spo2?: number;
    bmi?: number;
  };
}

export async function createClinicalDoc(payload: CreateClinicalDocPayload): Promise<any> {
  return fetchJSON('/doctor-agent/create-clinical-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
