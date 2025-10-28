import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { fetchJSON } from '../api/http';

type InvoiceSummary = {
  invoiceId: string;
  visitId: string;
  patientId: string;
  status: string;
  amountDue: string;
  grandTotal: string;
  invoiceNo: string;
  Patient?: {
    name: string;
  } | null;
};

function formatMoney(value: string) {
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return value;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MMK' }).format(numeric);
}

export default function PosList() {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { adminId } = useParams<{ adminId: string }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchJSON('/billing/invoices?status=PENDING,PARTIALLY_PAID')
      .then((response) => {
        if (!active) return;
        setInvoices(response.data ?? []);
      })
      .catch((err) => {
        console.error(err);
        if (active) setError('Unable to load invoices.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <DashboardLayout
      title="Point of Sale"
      subtitle="Collect payments for pending invoices"
      activeItem="billing"
    >
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Outstanding invoices</h2>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-500">Loading invoices...</div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-red-600">{error}</div>
        ) : invoices.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">All caught up! No invoices awaiting payment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Invoice #</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Patient</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Grand Total</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Amount Due</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.invoiceId}>
                    <td className="px-4 py-2 font-medium text-gray-900">{invoice.invoiceNo}</td>
                    <td className="px-4 py-2 text-gray-700">{invoice.Patient?.name ?? 'Unknown patient'}</td>
                    <td className="px-4 py-2 text-gray-700">{invoice.status}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{formatMoney(invoice.grandTotal)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">
                      {formatMoney(invoice.amountDue)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            adminId
                              ? `/admin/${adminId}/billing/visit/${invoice.visitId}`
                              : `/billing/visit/${invoice.visitId}`,
                          )
                        }
                        className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        Take Payment
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
