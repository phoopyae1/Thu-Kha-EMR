import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { fetchJSON } from '../api/http';
import useAdminBasePath from '../hooks/useAdminBasePath';

interface PrescriptionItem {
  itemId: string;
  drugId: string;
  dose: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantityPrescribed: number;
}

interface PrescriptionDetail {
  prescriptionId: string;
  status: string;
  patient?: { name: string };
  doctor?: { name: string };
  items: PrescriptionItem[];
}

interface DispenseSession {
  dispenseId: string;
  status: string;
}

export default function DispenseDetail() {
  const { prescriptionId } = useParams<{ prescriptionId: string }>();
  const navigate = useNavigate();
  const adminBasePath = useAdminBasePath();
  const [prescription, setPrescription] = useState<PrescriptionDetail | null>(null);
  const [dispense, setDispense] = useState<DispenseSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!prescriptionId) {
        setError('Missing prescription reference.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const listResponse = await fetchJSON('/pharmacy/prescriptions?status=PENDING,PARTIAL');
        const items = (listResponse as { data?: PrescriptionDetail[] }).data ?? [];
        const found = items.find((item) => item.prescriptionId === prescriptionId);
        if (!found) {
          setError('Prescription not available for dispensing.');
          setLoading(false);
          return;
        }
        if (!cancelled) {
          setPrescription(found);
        }

        const dispenseResponse = await fetchJSON(`/pharmacy/prescriptions/${prescriptionId}/dispenses`, {
          method: 'POST',
        });
        if (!cancelled) {
          setDispense(dispenseResponse as DispenseSession);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load dispensing workspace');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [prescriptionId]);

  async function handleAllocate(item: PrescriptionItem) {
    if (!dispense) return;
    try {
      await fetchJSON(`/pharmacy/dispenses/${dispense.dispenseId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prescriptionItemId: item.itemId,
          drugId: item.drugId,
          quantity: item.quantityPrescribed,
          stockItemId: null,
        }),
      });
      window.alert('Allocated using default quantity. You can adjust FEFO selections in future iterations.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to allocate item');
    }
  }

  async function handleComplete(nextStatus: 'COMPLETED' | 'PARTIAL') {
    if (!dispense) return;
    try {
      const result = await fetchJSON(`/pharmacy/dispenses/${dispense.dispenseId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      
      // Log the result for debugging
      console.log('Dispense completion result:', result);
      
      window.alert(`Dispense saved. Prescription status updated to ${result.prescriptionStatus || 'PARTIAL'}.`);
      
      // Longer delay to ensure database transaction is fully committed and propagated
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Force a hard refresh by adding a timestamp to the URL
      navigate(`${adminBasePath}/pharmacy/queue?refresh=${Date.now()}`);
    } catch (err) {
      console.error('Error completing dispense:', err);
      window.alert(err instanceof Error ? err.message : 'Unable to complete dispense');
    }
  }

  const title = prescription ? `Dispense for ${prescription.patient?.name ?? 'Patient'}` : 'Dispense';
  const subtitle = error
    ? error
    : loading
      ? 'Loading dispensing workspace…'
      : `Prepare items ordered by ${prescription?.doctor?.name ?? 'physician'}.`;

  return (
    <DashboardLayout title={title} subtitle={subtitle} activeItem="pharmacy">
      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">Loading…</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">{error}</div>
      ) : prescription && dispense ? (
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Prescription Items</h1>
                <p className="text-sm text-gray-600">Allocate stock to each line before completing the dispense.</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                Session #{dispense.dispenseId.slice(0, 8)}
              </span>
            </header>
            <div className="mt-4 space-y-4">
              {prescription.items.map((item) => (
                <div key={item.itemId} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{item.dose}</div>
                    <div className="text-xs text-gray-600">
                      {item.route} • {item.frequency} • {item.durationDays} days
                    </div>
                    <div className="mt-1 text-xs font-semibold text-gray-500">Qty prescribed: {item.quantityPrescribed}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAllocate(item)}
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    Allocate (MVP)
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleComplete('COMPLETED')}
                className="inline-flex items-center justify-center rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-green-700"
              >
                Complete Dispense
              </button>
              <button
                type="button"
                onClick={() => handleComplete('PARTIAL')}
                className="inline-flex items-center justify-center rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
              >
                Mark Partial
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
          Unable to load prescription details.
        </div>
      )}
    </DashboardLayout>
  );
}
