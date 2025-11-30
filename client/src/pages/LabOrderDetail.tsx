import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from '../hooks/useTranslation';
import { useAuth } from '../context/AuthProvider';
import {
  enterLabResult,
  getLabOrderDetail,
  type EnterLabResultPayload,
  type LabOrderEntry,
  type LabOrderItemEntry,
  type LabResultEntry,
} from '../api/clinical';

type ResultFormState = {
  resultValue: string;
  resultValueNum: string;
  unit: string;
  referenceLow: string;
  referenceHigh: string;
  notes: string;
};

type ResultForms = Record<string, ResultFormState>;

export default function LabOrderDetailPage() {
  const { t } = useTranslation();
  const { labOrderId } = useParams<'labOrderId'>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEnterResults = useMemo(() => user && ['LabTech', 'ITAdmin'].includes(user.role), [user]);
  const [order, setOrder] = useState<LabOrderEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<ResultForms>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!labOrderId) {
      navigate('/lab-orders');
      return;
    }
  }, [labOrderId, navigate]);

  useEffect(() => {
    if (!labOrderId) return;
    let cancelled = false;
    async function load(id: string) {
      setLoading(true);
      setError(null);
      try {
        const data = await getLabOrderDetail(id);
        if (!cancelled) {
          setOrder(data);
          if (data) {
            setForms(
              Object.fromEntries(
                data.items.map((item) => [
                  item.labOrderItemId,
                  {
                    resultValue: '',
                    resultValueNum: '',
                    unit: item.results?.[0]?.unit ?? '',
                    referenceLow: item.results?.[0]?.referenceLow?.toString() ?? '',
                    referenceHigh: item.results?.[0]?.referenceHigh?.toString() ?? '',
                    notes: '',
                  },
                ]),
              ),
            );
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(t('Unable to load lab order.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load(labOrderId);
    return () => {
      cancelled = true;
    };
  }, [labOrderId, t]);

  function updateForm(itemId: string, key: keyof ResultFormState, value: string) {
    setForms((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? {
          resultValue: '',
          resultValueNum: '',
          unit: '',
          referenceLow: '',
          referenceHigh: '',
          notes: '',
        }),
        [key]: value,
      },
    }));
  }

  async function handleSubmit(item: LabOrderItemEntry, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || !canEnterResults) return;
    const state = forms[item.labOrderItemId];
    if (!state) return;

    const payload: EnterLabResultPayload = {
      labOrderItemId: item.labOrderItemId,
      patientId: order.patientId,
      resultValue: state.resultValue || undefined,
      resultValueNum: state.resultValueNum ? Number(state.resultValueNum) : undefined,
      unit: state.unit || undefined,
      referenceLow: state.referenceLow ? Number(state.referenceLow) : undefined,
      referenceHigh: state.referenceHigh ? Number(state.referenceHigh) : undefined,
      notes: state.notes || undefined,
    };

    setSavingItemId(item.labOrderItemId);
    setError(null);
    try {
      await enterLabResult(payload);
      const refreshed = await getLabOrderDetail(order.labOrderId);
      setOrder(refreshed);
      if (refreshed) {
        setForms((prev) => ({
          ...prev,
          [item.labOrderItemId]: {
            resultValue: '',
            resultValueNum: '',
            unit: state.unit,
            referenceLow: state.referenceLow,
            referenceHigh: state.referenceHigh,
            notes: '',
          },
        }));
      }
    } catch (err) {
      console.error(err);
      setError(t('Unable to save lab result.'));
    } finally {
      setSavingItemId(null);
    }
  }

  const subtitle = order
    ? t('Visit {visitId} • Patient {patientId}', {
        visitId: order.visitId,
        patientId: order.patientId,
      })
    : undefined;

  return (
    <DashboardLayout title={t('Lab order detail')} subtitle={subtitle} activeItem="lab">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <Link
            to="/lab-orders"
            className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            {t('Back to orders')}
          </Link>
          {order && (
            <span className="rounded-full bg-blue-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
              {order.status.replace('_', ' ')}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
            {t('Loading order information...')}
          </div>
        ) : order ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">{t('Order summary')}</h2>
              <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase text-gray-500">{t('Order ID')}</dt>
                  <dd className="text-sm text-gray-900">{order.orderId || order.labOrderId}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">{t('Created')}</dt>
                  <dd className="text-sm text-gray-900">{new Date(order.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">{t('Priority')}</dt>
                  <dd className="text-sm text-gray-900">{order.priority ?? t('Routine')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">{t('Notes')}</dt>
                  <dd className="text-sm text-gray-900">{order.notes ?? '—'}</dd>
                </div>
              </dl>
            </div>

            <div className="space-y-4">
              {order.items.map((item) => (
                <div key={item.labOrderItemId} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{item.testName}</h3>
                      <p className="text-sm text-gray-500">{item.testCode}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        item.status === 'RESULTED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {t(item.status.replace('_', ' '))}
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {(item.results ?? []).map((result: LabResultEntry) => (
                      <div
                        key={result.labResultId}
                        className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold">
                              {result.resultValue ?? result.resultValueNum ?? t('No value provided')}
                              {result.unit && ` ${result.unit}`}
                            </div>
                            <div className="text-xs text-blue-700">
                              {new Date(result.resultedAt).toLocaleString()}
                            </div>
                          </div>
                          {result.abnormalFlag && (
                            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                              {result.abnormalFlag}
                            </span>
                          )}
                        </div>
                        {(result.referenceLow != null || result.referenceHigh != null) && (
                          <div className="mt-2 text-xs text-blue-700">
                            {t('Reference range')}: {result.referenceLow ?? '—'} – {result.referenceHigh ?? '—'}
                          </div>
                        )}
                        {result.notes && <div className="mt-2 text-xs text-blue-800">{result.notes}</div>}
                      </div>
                    ))}
                  </div>

                  {canEnterResults && item.status !== 'RESULTED' && (
                    <form
                      onSubmit={(event) => handleSubmit(item, event)}
                      className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
                    >
                      <label className="flex flex-col text-sm font-medium text-gray-700">
                        {t('Result value (text)')}
                        <input
                          type="text"
                          value={forms[item.labOrderItemId]?.resultValue ?? ''}
                          onChange={(event) => updateForm(item.labOrderItemId, 'resultValue', event.target.value)}
                          className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </label>
                      <label className="flex flex-col text-sm font-medium text-gray-700">
                        {t('Result value (numeric)')}
                        <input
                          type="number"
                          step="0.001"
                          value={forms[item.labOrderItemId]?.resultValueNum ?? ''}
                          onChange={(event) => updateForm(item.labOrderItemId, 'resultValueNum', event.target.value)}
                          className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </label>
                      <label className="flex flex-col text-sm font-medium text-gray-700">
                        {t('Unit')}
                        <input
                          type="text"
                          value={forms[item.labOrderItemId]?.unit ?? ''}
                          onChange={(event) => updateForm(item.labOrderItemId, 'unit', event.target.value)}
                          className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </label>
                      <label className="flex flex-col text-sm font-medium text-gray-700">
                        {t('Reference low')}
                        <input
                          type="number"
                          step="0.001"
                          value={forms[item.labOrderItemId]?.referenceLow ?? ''}
                          onChange={(event) => updateForm(item.labOrderItemId, 'referenceLow', event.target.value)}
                          className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </label>
                      <label className="flex flex-col text-sm font-medium text-gray-700">
                        {t('Reference high')}
                        <input
                          type="number"
                          step="0.001"
                          value={forms[item.labOrderItemId]?.referenceHigh ?? ''}
                          onChange={(event) => updateForm(item.labOrderItemId, 'referenceHigh', event.target.value)}
                          className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </label>
                      <label className="flex flex-col text-sm font-medium text-gray-700 sm:col-span-2">
                        {t('Result notes')}
                        <textarea
                          value={forms[item.labOrderItemId]?.notes ?? ''}
                          onChange={(event) => updateForm(item.labOrderItemId, 'notes', event.target.value)}
                          className="mt-1 h-20 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </label>
                      <div className="sm:col-span-2 flex justify-end">
                        <button
                          type="submit"
                          disabled={savingItemId === item.labOrderItemId}
                          className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                        >
                          {savingItemId === item.labOrderItemId ? t('Saving...') : t('Submit result')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
            {t('Lab order not found.')}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
