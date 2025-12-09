import { fetchJSON } from './http';

export interface CashierProfileResponse {
  status: string;
  userId: string;
  userEmail: string;
  userRole: string;
  userStatus: string;
  userCreatedAt: string;
  userCreatedTime: string;
  userUpdatedAt: string;
  totalInvoices: number;
  totalPayments: number;
  totalRevenue: number;
  paidInvoices: number;
  pendingInvoices: number;
  recentInvoicesLast30Days: number;
  recentPaymentsLast30Days: number;
  recentRevenueLast30Days: number;
  recentPaidInvoicesLast30Days: number;
}

export interface CashierProfileRequest {
  cashierId: string;
}

export interface BillingAssistantItem {
  itemId: string;
  sourceType: string;
  sourceRefId: string | null;
  serviceId: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  serviceDefaultPrice: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmt: number;
  taxAmt: number;
  lineTotal: number;
}

export interface BillingAssistantPayment {
  paymentId: string;
  method: string;
  amount: number;
  paidAt: string;
  referenceNo: string | null;
  note: string | null;
}

export interface BillingAssistantInvoice {
  invoiceId: string;
  invoiceNo: string;
  status: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  note: string | null;
  patientId: string;
  patientName: string;
  patientDob: string;
  patientGender: string;
  patientContact: string | null;
  patientInsurance: string | null;
  doctorId: string | null;
  doctorName: string | null;
  doctorDepartment: string | null;
  visitId: string | null;
  visitDate: string | null;
  visitDepartment: string | null;
  visitReason: string | null;
  subTotal: number;
  discountAmt: number;
  taxAmt: number;
  grandTotal: number;
  amountPaid: number;
  amountDue: number;
  items: BillingAssistantItem[];
  payments: BillingAssistantPayment[];
}

export interface BillingAssistantRequest {
  invoiceId?: string;
  patientId?: string;
  doctorId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface BillingAssistantResponse {
  status: string;
  data: BillingAssistantInvoice[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Fetch cashier profile information and statistics
 * Uses POST method with cashierId in request body
 */
export async function getCashierProfile(
  cashierId: string
): Promise<CashierProfileResponse> {
  return fetchJSON('/api/cashier-agent/cashier-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cashierId }),
  }) as Promise<CashierProfileResponse>;
}

/**
 * Fetch detailed billing information with patient, doctor, and fee breakdowns
 * Uses POST method with optional filters (invoiceId, patientId, doctorId, status)
 */
export async function getBillingAssistant(
  filters?: BillingAssistantRequest
): Promise<BillingAssistantResponse> {
  return fetchJSON('/api/cashier-agent/billing-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters || {}),
  }) as Promise<BillingAssistantResponse>;
}

