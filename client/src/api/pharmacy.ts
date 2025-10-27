import { fetchJSON } from './http';
import type { MedicationOrderStatus as PortalMedicationOrderStatus } from './patientPortal';

export type PharmacyQueueStatus = 'PENDING' | 'PARTIAL' | 'DISPENSED';

export interface PharmacyQueueItem {
  prescriptionId: string;
  status: PharmacyQueueStatus;
  notes?: string | null;
  createdAt: string;
  patient?: { patientId: string; name: string };
  doctor?: { doctorId: string; name: string };
  items: Array<{
    itemId: string;
    drugId: string;
    dose: string;
    route: string;
    frequency: string;
    durationDays: number;
    quantityPrescribed: number;
  }>;
}

export async function listPharmacyQueue(
  status?: PharmacyQueueStatus | PharmacyQueueStatus[],
): Promise<PharmacyQueueItem[]> {
  const params = new URLSearchParams();
  if (status) {
    const values = Array.isArray(status) ? status : [status];
    if (values.length) {
      params.set('status', values.join(','));
    }
  }

  const query = params.toString();
  const response = await fetchJSON(`/pharmacy/prescriptions${query ? `?${query}` : ''}`);
  return ((response as { data?: PharmacyQueueItem[] }).data) ?? [];
}

export type MedicationOrderStatus = PortalMedicationOrderStatus;

export interface MedicationOrderUserSummary {
  userId: string;
  email: string;
  role: string;
}

export interface MedicationOrderPatientSummary {
  patientId: string;
  name: string;
  contact?: string | null;
}

export interface MedicationOrderItemSummary {
  itemId: string;
  dose: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantityPrescribed: number;
  prn: boolean;
  notes: string | null;
  drug?: {
    drugId: string;
    name: string;
    strength: string | null;
    form: string | null;
  } | null;
}

export interface MedicationOrderSummary {
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
  patient?: MedicationOrderPatientSummary | null;
  prescription?: {
    prescriptionId: string;
    status: string;
    createdAt: string;
    doctor?: {
      doctorId: string;
      name: string;
      department: string | null;
    } | null;
    items: MedicationOrderItemSummary[];
  } | null;
  approvedBy?: MedicationOrderUserSummary | null;
  updatedBy?: MedicationOrderUserSummary | null;
}

export async function listMedicationOrders(params?: {
  status?: MedicationOrderStatus | MedicationOrderStatus[];
  patientId?: string;
}): Promise<MedicationOrderSummary[]> {
  const searchParams = new URLSearchParams();

  if (params?.patientId) {
    searchParams.set('patientId', params.patientId);
  }

  const statuses = params?.status
    ? Array.isArray(params.status)
      ? params.status
      : [params.status]
    : [];

  for (const status of statuses) {
    searchParams.append('status', status);
  }

  const query = searchParams.toString();
  const response = await fetchJSON(
    `/pharmacy/medication-orders${query ? `?${query}` : ''}`,
  );
  if (response && typeof response === 'object' && 'data' in response) {
    const { data } = response as { data?: MedicationOrderSummary[] };
    return data ?? [];
  }
  return (response as MedicationOrderSummary[]) ?? [];
}

export async function updateMedicationOrder(
  orderId: string,
  payload: { status?: MedicationOrderStatus; notes?: string | null },
): Promise<MedicationOrderSummary> {
  const response = await fetchJSON(`/pharmacy/medication-orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response as MedicationOrderSummary;
}

export interface InventoryLocationSummary {
  location: string;
  qtyOnHand: number;
}

export interface LowStockInventoryItem {
  drugId: string;
  name: string;
  genericName: string | null;
  strength: string;
  form: string;
  totalOnHand: number;
  locations: InventoryLocationSummary[];
}

export async function listLowStockInventory(params?: {
  limit?: number;
  threshold?: number;
}): Promise<LowStockInventoryItem[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) {
    searchParams.set('limit', String(params.limit));
  }
  if (params?.threshold !== undefined) {
    searchParams.set('threshold', String(params.threshold));
  }

  const query = searchParams.toString();
  const response = await fetchJSON(
    `/pharmacy/inventory/low-stock${query ? `?${query}` : ''}`,
  );
  return ((response as { data?: LowStockInventoryItem[] }).data) ?? [];
}
