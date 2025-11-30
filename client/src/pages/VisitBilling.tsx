import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { fetchJSON } from '../api/http';
import { getPatient, getVisit, type Patient, type VisitDetail as VisitDetailType } from '../api/client';

type InvoiceItem = {
  itemId: string;
  description: string;
  quantity: number;
  unitPrice: string;
  discountAmt: string;
  taxAmt: string;
  lineTotal: string;
  sourceType: string;
};

type Invoice = {
  invoiceId: string;
  invoiceNo: string;
  visitId: string;
  patientId: string;
  status: string;
  currency: string;
  note?: string | null;
  subTotal: string;
  discountAmt: string;
  taxAmt: string;
  grandTotal: string;
  amountPaid: string;
  amountDue: string;
  items: InvoiceItem[];
};

type PaymentDraft = {
  amount: string;
  method: string;
  referenceNo: string;
  note: string;
};

type ItemSourceType = 'SERVICE' | 'PHARMACY' | 'LAB';

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'MOBILE_WALLET', label: 'Mobile Wallet' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'OTHER', label: 'Other' },
];

function formatMoney(value: string) {
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return value;
  }
  // Display exact value without any rounding or truncation
  // Format as USD to show $ sign, but currency is SGD
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 20, // Allow more decimal places to preserve exact values
  }).format(numeric);
}

function parseErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('response' in error && error.response && typeof error.response === 'object') {
      const response = error.response as any;
      if (response.data && typeof response.data === 'object') {
        if (response.data.error) {
          return String(response.data.error);
        }
        if (response.data.details && Array.isArray(response.data.details)) {
          return response.data.details.map((d: any) => d.message || JSON.stringify(d)).join(', ');
        }
      }
    }
    if ('message' in error) {
      return String(error.message);
    }
  }
  return 'An error occurred';
}

export default function VisitBilling() {
  const { visitId } = useParams<{ visitId: string }>();
  const [visit, setVisit] = useState<VisitDetailType | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustmentDraft, setAdjustmentDraft] = useState({ discount: '', tax: '' });
  const [itemDraft, setItemDraft] = useState({
    sourceType: 'SERVICE' as ItemSourceType,
    description: '',
    quantity: '1',
    unitPrice: '',
    discount: '0',
    tax: '0',
  });
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [isPaymentOpen, setPaymentOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    amount: '',
    method: 'CASH',
    referenceNo: '',
    note: '',
  });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'discount' | 'tax' | 'grandTotal' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [itemEditDraft, setItemEditDraft] = useState({
    description: '',
    quantity: '1',
    unitPrice: '',
    discount: '0',
    tax: '0',
  });
  const [isUpdatingItem, setIsUpdatingItem] = useState(false);
  const [itemUpdateError, setItemUpdateError] = useState<string | null>(null);
  const hasDue = useMemo(() => {
    if (!invoice) return false;
    const due = Number.parseFloat(invoice.amountDue);
    return !Number.isNaN(due) && due > 0;
  }, [invoice]);

  useEffect(() => {
    if (!visitId) {
      setError('Visit identifier is missing.');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    async function load(targetVisitId: string) {
      try {
        const visitDetails = await getVisit(targetVisitId);
        if (!active) return;
        setVisit(visitDetails);
        const patientRecord = await getPatient(visitDetails.patientId);
        if (!active) return;
        setPatient(patientRecord as Patient);
        let invoiceRecord: Invoice | null = null;
        const existing = await fetchJSON(`/billing/invoices?visitId=${targetVisitId}`);
        if (existing.data?.length) {
          const detailed = await fetchJSON(`/billing/invoices/${existing.data[0].invoiceId}`);
          invoiceRecord = detailed as Invoice;
        } else {
          const created = await fetchJSON('/billing/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitId: targetVisitId, patientId: visitDetails.patientId }),
          });
          const detailed = await fetchJSON(`/billing/invoices/${created.invoiceId}`);
          invoiceRecord = detailed as Invoice;
        }
        if (!active) return;
        setInvoice(invoiceRecord);
        setAdjustmentDraft({
          discount: invoiceRecord?.discountAmt ?? '0',
          tax: invoiceRecord?.taxAmt ?? '0',
        });
      } catch (err) {
        console.error(err);
        if (active) {
          setError('Unable to load invoice for this visit.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load(visitId);

    return () => {
      active = false;
    };
  }, [visitId]);

  async function refreshInvoice() {
    if (!invoice) return;
    const detailed = await fetchJSON(`/billing/invoices/${invoice.invoiceId}`);
    const refreshed = detailed as Invoice;
    setInvoice(refreshed);
    setAdjustmentDraft({ discount: refreshed.discountAmt ?? '0', tax: refreshed.taxAmt ?? '0' });
  }

  async function handleAdjustmentsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    try {
      await fetchJSON(`/billing/invoices/${invoice.invoiceId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceDiscountAmt: adjustmentDraft.discount,
          invoiceTaxAmt: adjustmentDraft.tax,
        }),
      });
      await refreshInvoice();
    } catch (err) {
      console.error(err);
      window.alert('Unable to update invoice totals.');
    }
  }

  async function handleUpdateAmount(field: 'discount' | 'tax', value: string) {
    if (!invoice) return;
    setIsSaving(true);
    try {
      const updateData: { invoiceDiscountAmt?: string; invoiceTaxAmt?: string } = {};
      if (field === 'discount') {
        updateData.invoiceDiscountAmt = value;
      } else if (field === 'tax') {
        updateData.invoiceTaxAmt = value;
      }
      
      await fetchJSON(`/billing/invoices/${invoice.invoiceId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      await refreshInvoice();
      setEditingField(null);
      setEditValue('');
    } catch (err) {
      console.error(err);
      window.alert('Unable to update invoice amount.');
    } finally {
      setIsSaving(false);
    }
  }

  function startEditing(field: 'discount' | 'tax' | 'grandTotal', currentValue: string) {
    setEditingField(field);
    // Remove currency formatting and extract numeric value
    const numericValue = currentValue.replace(/[^0-9.-]/g, '');
    setEditValue(numericValue);
  }

  function cancelEditing() {
    setEditingField(null);
    setEditValue('');
  }

  function startEditingItem(item: InvoiceItem) {
    setEditingItem(item);
    setItemEditDraft({
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: item.unitPrice,
      discount: item.discountAmt,
      tax: item.taxAmt,
    });
    setItemUpdateError(null);
  }

  function cancelEditingItem() {
    setEditingItem(null);
    setItemEditDraft({
      description: '',
      quantity: '1',
      unitPrice: '',
      discount: '0',
      tax: '0',
    });
    setItemUpdateError(null);
  }

  async function handleUpdateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice || !editingItem) return;

    const description = itemEditDraft.description.trim();
    const quantity = Number.parseInt(itemEditDraft.quantity, 10);
    const unitPrice = itemEditDraft.unitPrice.trim();
    const discount = itemEditDraft.discount.trim();
    const tax = itemEditDraft.tax.trim();

    if (!description) {
      setItemUpdateError('Description is required.');
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setItemUpdateError('Quantity must be a positive whole number.');
      return;
    }

    if (!unitPrice) {
      setItemUpdateError('Unit price is required.');
      return;
    }

    setItemUpdateError(null);
    setIsUpdatingItem(true);

    try {
      await fetchJSON(`/billing/invoices/${invoice.invoiceId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          update: [
            {
              itemId: editingItem.itemId,
              patch: {
                description,
                quantity,
                unitPrice,
                discountAmt: discount,
                taxAmt: tax,
              },
            },
          ],
        }),
      });
      await refreshInvoice();
      cancelEditingItem();
    } catch (err) {
      console.error(err);
      setItemUpdateError('Unable to update invoice item.');
    } finally {
      setIsUpdatingItem(false);
    }
  }

  async function handleAddItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;

    const description = itemDraft.description.trim();
    const quantity = Number.parseInt(itemDraft.quantity, 10);
    const unitPrice = itemDraft.unitPrice.trim();
    const discount = itemDraft.discount.trim();
    const tax = itemDraft.tax.trim();

    if (!description) {
      setItemError('Description is required.');
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setItemError('Quantity must be a positive whole number.');
      return;
    }

    if (!unitPrice) {
      setItemError('Unit price is required.');
      return;
    }

    setItemError(null);
    setIsAddingItem(true);

    try {
      // Normalize monetary values to ensure they match the validation pattern
      // The regex requires: /^-?\d+(\.\d{1,})?$/ (at least one digit, optional decimal with at least one digit after)
      // This function handles currency-formatted input like "$62,698.00" or "62,698.00" or "62698.00"
      const normalizeMonetaryValue = (value: string): string => {
        if (!value || value.trim() === '') return '0';
        const trimmed = value.trim();
        // Remove currency symbols ($, €, £, etc.) and commas
        const cleaned = trimmed.replace(/[$€£¥,\s]/g, '');
        // Parse as float to handle various formats, then convert back to string
        const numValue = Number.parseFloat(cleaned);
        if (isNaN(numValue)) {
          return '0';
        }
        // Convert to string, ensuring it matches the regex pattern
        // If it's a whole number, return as-is (e.g., "100")
        // If it has decimals, ensure at least one digit after decimal point
        const strValue = numValue.toString();
        // If it's a whole number, return it
        if (Number.isInteger(numValue)) {
          return strValue;
        }
        // If it has decimals, ensure at least one digit after decimal point
        // The toString() should already handle this, but let's be explicit
        return strValue;
      };

      const normalizedUnitPrice = normalizeMonetaryValue(unitPrice);
      const normalizedDiscount = discount && discount !== '0' ? normalizeMonetaryValue(discount) : undefined;
      const normalizedTax = tax && tax !== '0' ? normalizeMonetaryValue(tax) : undefined;

      // Validate that values match the expected pattern: /^-?\d+(\.\d{1,})?$/
      const monetaryPattern = /^-?\d+(\.\d{1,})?$/;
      
      if (!monetaryPattern.test(normalizedUnitPrice)) {
        setItemError(`Invalid unit price format: "${unitPrice}". Please enter a valid number (e.g., 100 or 100.00).`);
        setIsAddingItem(false);
        return;
      }

      if (normalizedDiscount && !monetaryPattern.test(normalizedDiscount)) {
        setItemError(`Invalid discount format: "${discount}". Please enter a valid number (e.g., 10 or 10.00).`);
        setIsAddingItem(false);
        return;
      }

      if (normalizedTax && !monetaryPattern.test(normalizedTax)) {
        setItemError(`Invalid tax format: "${tax}". Please enter a valid number (e.g., 5 or 5.00).`);
        setIsAddingItem(false);
        return;
      }

      const payload: Record<string, unknown> = {
        sourceType: itemDraft.sourceType,
        description,
        quantity,
        unitPrice: normalizedUnitPrice,
      };

      if (normalizedDiscount && normalizedDiscount !== '0') {
        payload.discountAmt = normalizedDiscount;
      }

      if (normalizedTax && normalizedTax !== '0') {
        payload.taxAmt = normalizedTax;
      }

      await fetchJSON(`/billing/invoices/${invoice.invoiceId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add: [payload] }),
      });

      setItemDraft({
        sourceType: itemDraft.sourceType,
        description: '',
        quantity: '1',
        unitPrice: '',
        discount: '0',
        tax: '0',
      });
      await refreshInvoice();
    } catch (err) {
      console.error('Error adding invoice item:', err);
      const errorMessage = parseErrorMessage(err);
      setItemError(errorMessage || 'Unable to add invoice item right now.');
    } finally {
      setIsAddingItem(false);
    }
  }

  async function handlePostPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    setPaymentError(null);
    try {
      await fetchJSON(`/billing/invoices/${invoice.invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentDraft),
      });
      setPaymentOpen(false);
      setPaymentDraft({ amount: '', method: 'CASH', referenceNo: '', note: '' });
      await refreshInvoice();
    } catch (err) {
      console.error(err);
      setPaymentError('Unable to record payment right now.');
    }
  }

  if (loading) {
    return (
      <DashboardLayout title="Visit Billing" subtitle="Preparing invoice..." activeItem="billing">
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          Loading invoice details...
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout title="Visit Billing" subtitle="Invoice unavailable" activeItem="billing">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">{error}</div>
      </DashboardLayout>
    );
  }

  if (!invoice || !visit || !patient) {
    return (
      <DashboardLayout title="Visit Billing" subtitle="Invoice unavailable" activeItem="billing">
        <div className="rounded-lg border border-gray-200 p-6 text-gray-600">Invoice data not found.</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title={`Invoice ${invoice.invoiceNo}`}
      subtitle={`Visit on ${new Date(visit.visitDate).toLocaleDateString('en-GB')}`}
      activeItem="billing"
      headerChildren={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.open(`/api/billing/invoices/${invoice.invoiceId}/receipt`, '_blank')}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Print Receipt
          </button>
          {hasDue && (
            <button
              type="button"
              onClick={() => setPaymentOpen(true)}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              Add Payment
            </button>
          )}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Invoice Items</h2>
            </div>
            <form className="grid gap-4 border-b border-gray-200 px-4 py-4 md:grid-cols-6" onSubmit={handleAddItem}>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="font-medium text-gray-700">Item Source</span>
                <select
                  value={itemDraft.sourceType}
                  onChange={(event) =>
                    setItemDraft((state) => ({
                      ...state,
                      sourceType: event.target.value as ItemSourceType,
                    }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="SERVICE">Service</option>
                  <option value="PHARMACY">Pharmacy</option>
                  <option value="LAB">Lab</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="font-medium text-gray-700">Description</span>
                <input
                  type="text"
                  value={itemDraft.description}
                  onChange={(event) =>
                    setItemDraft((state) => ({ ...state, description: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="e.g. Consultation fee"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Quantity</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={itemDraft.quantity}
                  onChange={(event) =>
                    setItemDraft((state) => ({ ...state, quantity: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Unit Price (SGD)</span>
                <input
                  type="text"
                  value={itemDraft.unitPrice}
                  onChange={(event) =>
                    setItemDraft((state) => ({ ...state, unitPrice: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="0.00"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Discount</span>
                <input
                  type="text"
                  value={itemDraft.discount}
                  onChange={(event) =>
                    setItemDraft((state) => ({ ...state, discount: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="0.00"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Tax</span>
                <input
                  type="text"
                  value={itemDraft.tax}
                  onChange={(event) => setItemDraft((state) => ({ ...state, tax: event.target.value }))}
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="0.00"
                />
              </label>
              {itemError && (
                <div className="md:col-span-4 text-sm text-red-600">{itemError}</div>
              )}
              <div className="md:col-span-2 flex items-end justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setItemDraft((state) => ({
                      ...state,
                      description: '',
                      quantity: '1',
                      unitPrice: '',
                      discount: '0',
                      tax: '0',
                    }));
                    setItemError(null);
                  }}
                  className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={isAddingItem}
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isAddingItem ? 'Adding…' : 'Add item'}
                </button>
              </div>
            </form>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Description</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Qty</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Unit Price</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Discount</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Tax</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Line Total</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoice.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                        No items on this invoice yet.
                      </td>
                    </tr>
                  ) : (
                    invoice.items.map((item) => (
                      <tr key={item.itemId}>
                        <td className="px-4 py-2 text-gray-900">{item.description}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{item.quantity}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatMoney(item.unitPrice)}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatMoney(item.discountAmt)}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatMoney(item.taxAmt)}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatMoney(item.lineTotal)}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => startEditingItem(item)}
                            className="rounded-full border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100"
                          >
                            Update
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Invoice Adjustments</h2>
              <p className="mt-1 text-sm text-gray-500">
                Apply invoice-level discount or tax. Amounts are absolute values in SGD.
              </p>
            </div>
            <form className="grid gap-4 px-4 py-4 md:grid-cols-2" onSubmit={handleAdjustmentsSubmit}>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Invoice Discount</span>
                <input
                  type="text"
                  value={adjustmentDraft.discount}
                  onChange={(event) =>
                    setAdjustmentDraft((state) => ({ ...state, discount: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Invoice Tax</span>
                <input
                  type="text"
                  value={adjustmentDraft.tax}
                  onChange={(event) => setAdjustmentDraft((state) => ({ ...state, tax: event.target.value }))}
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <div className="md:col-span-2 flex justify-end gap-3">
                <button
                  type="submit"
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Save adjustments
                </button>
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  onClick={() =>
                    setAdjustmentDraft({ discount: invoice.discountAmt, tax: invoice.taxAmt })
                  }
                >
                  Reset
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900">Patient</h3>
            <dl className="mt-3 space-y-2 text-sm text-gray-700">
              <div className="flex justify-between">
                <dt className="text-gray-500">Name</dt>
                <dd className="font-medium text-gray-900">{patient.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Visit Reason</dt>
                <dd className="text-right text-gray-900">{visit.reason ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Status</dt>
                <dd className="text-right font-medium text-gray-900">{invoice.status}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900">Totals</h3>
            <dl className="mt-3 space-y-2 text-sm text-gray-700">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="font-medium text-gray-900">{formatMoney(invoice.subTotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Discount</dt>
                <dd className="flex items-center gap-2">
                  {editingField === 'discount' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                        disabled={isSaving}
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateAmount('discount', editValue)}
                        disabled={isSaving}
                        className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span>{formatMoney(invoice.discountAmt)}</span>
                      <button
                        type="button"
                        onClick={() => startEditing('discount', invoice.discountAmt)}
                        className="ml-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                        title="Edit discount"
                      >
                        ✏️
                      </button>
                    </>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Tax</dt>
                <dd className="flex items-center gap-2">
                  {editingField === 'tax' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                        disabled={isSaving}
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateAmount('tax', editValue)}
                        disabled={isSaving}
                        className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span>{formatMoney(invoice.taxAmt)}</span>
                      <button
                        type="button"
                        onClick={() => startEditing('tax', invoice.taxAmt)}
                        className="ml-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                        title="Edit tax"
                      >
                        ✏️
                      </button>
                    </>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Grand Total</dt>
                <dd className="font-semibold text-gray-900">{formatMoney(invoice.grandTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Amount Paid</dt>
                <dd>{formatMoney(invoice.amountPaid)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Amount Due</dt>
                <dd className="font-semibold text-red-600">{formatMoney(invoice.amountDue)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Update Invoice Item</h3>
            <p className="mt-1 text-sm text-gray-500">Edit item details</p>
            <form className="mt-4 space-y-4" onSubmit={handleUpdateItem}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-gray-700">Description</span>
                  <input
                    type="text"
                    value={itemEditDraft.description}
                    onChange={(event) =>
                      setItemEditDraft((state) => ({ ...state, description: event.target.value }))
                    }
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Quantity</span>
                  <input
                    type="number"
                    min="1"
                    value={itemEditDraft.quantity}
                    onChange={(event) =>
                      setItemEditDraft((state) => ({ ...state, quantity: event.target.value }))
                    }
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Unit Price (SGD)</span>
                  <input
                    type="text"
                    value={itemEditDraft.unitPrice}
                    onChange={(event) =>
                      setItemEditDraft((state) => ({ ...state, unitPrice: event.target.value }))
                    }
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="0.00"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Discount</span>
                  <input
                    type="text"
                    value={itemEditDraft.discount}
                    onChange={(event) =>
                      setItemEditDraft((state) => ({ ...state, discount: event.target.value }))
                    }
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="0.00"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Tax</span>
                  <input
                    type="text"
                    value={itemEditDraft.tax}
                    onChange={(event) =>
                      setItemEditDraft((state) => ({ ...state, tax: event.target.value }))
                    }
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="0.00"
                  />
                </label>
              </div>
              {itemUpdateError && (
                <div className="rounded bg-red-50 p-3 text-sm text-red-600">{itemUpdateError}</div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelEditingItem}
                  className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={isUpdatingItem}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={isUpdatingItem}
                >
                  {isUpdatingItem ? 'Updating...' : 'Update Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPaymentOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Record Payment</h3>
            <p className="mt-1 text-sm text-gray-500">Remaining due: {formatMoney(invoice.amountDue)}</p>
            <form className="mt-4 space-y-4" onSubmit={handlePostPayment}>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Amount</span>
                <input
                  type="text"
                  required
                  value={paymentDraft.amount}
                  onChange={(event) =>
                    setPaymentDraft((state) => ({ ...state, amount: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Method</span>
                <select
                  value={paymentDraft.method}
                  onChange={(event) =>
                    setPaymentDraft((state) => ({ ...state, method: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Reference Number</span>
                <input
                  type="text"
                  value={paymentDraft.referenceNo}
                  onChange={(event) =>
                    setPaymentDraft((state) => ({ ...state, referenceNo: event.target.value }))
                  }
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Note</span>
                <textarea
                  value={paymentDraft.note}
                  onChange={(event) =>
                    setPaymentDraft((state) => ({ ...state, note: event.target.value }))
                  }
                  rows={3}
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
              {paymentError && <p className="text-sm text-red-600">{paymentError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentOpen(false)}
                  className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

