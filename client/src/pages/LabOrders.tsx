import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { useAuth } from '../context/AuthProvider';
import { useTranslation } from '../hooks/useTranslation';
import {
  createLabOrder,
  listLabOrders,
  deleteLabOrder,
  type CreateLabOrderPayload,
  type LabOrderEntry,
  type LabOrderStatus,
} from '../api/clinical';
import { searchPatients, listPatientVisits, getPatient, type Patient, type Visit } from '../api/client';

const STATUSES: LabOrderStatus[] = ['ORDERED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

type LabOrderFormState = {
  visitId: string;
  patientId: string;
  priority: string;
  notes: string;
  items: Array<{ testCode: string; testName: string; specimen: string; notes: string }>;
};

export default function LabOrdersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canOrder = useMemo(() => user && ['Doctor', 'ITAdmin'].includes(user.role), [user]);
  const canView = useMemo(
    () => user && ['Doctor', 'LabTech', 'ITAdmin'].includes(user.role),
    [user],
  );
  const [orders, setOrders] = useState<LabOrderEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<LabOrderStatus>('ORDERED');
  const [patientFilter, setPatientFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [form, setForm] = useState<LabOrderFormState>({
    visitId: '',
    patientId: '',
    priority: '',
    notes: '',
    items: [{ testCode: '', testName: '', specimen: '', notes: '' }],
  });
  
  // Patient search state
  const [patientQuery, setPatientQuery] = useState('');
  const [debouncedPatientQuery, setDebouncedPatientQuery] = useState('');
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState<string | null>(null);
  const [patientMatches, setPatientMatches] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientVisitsLoading, setPatientVisitsLoading] = useState(false);
  const [patientVisitsError, setPatientVisitsError] = useState<string | null>(null);
  const [patientVisits, setPatientVisits] = useState<Visit[]>([]);
  
  function isUuid(value: string) {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value.trim());
  }
  
  // Debounce patient query
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedPatientQuery(patientQuery.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [patientQuery]);
  
  // Search patients
  useEffect(() => {
    let active = true;
    async function searchByPatient() {
      const query = debouncedPatientQuery;
      if (!query) {
        setPatientMatches([]);
        setPatientSearchError(null);
        setPatientSearchLoading(false);
        return;
      }
      setPatientSearchLoading(true);
      setPatientSearchError(null);
      if (isUuid(query)) {
        try {
          const patientRecord = await getPatient(query);
          if (!active) return;
          await selectPatient(patientRecord as Patient, { preserveQuery: true, isActive: () => active });
          if (!active) return;
          setPatientMatches([]);
          setPatientSearchError(null);
        } catch (error) {
          console.error(error);
          if (!active) return;
          setPatientMatches([]);
          setSelectedPatient(null);
          setPatientVisits([]);
          setPatientVisitsError('No patient found with that ID.');
          setPatientVisitsLoading(false);
          setPatientSearchError('No patient found with that ID.');
        } finally {
          if (active) {
            setPatientSearchLoading(false);
          }
        }
        return;
      }
      try {
        const results = await searchPatients(query);
        if (!active) return;
        setPatientMatches(results);
      } catch (error) {
        console.error(error);
        if (active) {
          setPatientMatches([]);
          setPatientSearchError('Unable to search patients right now.');
        }
      } finally {
        if (active) {
          setPatientSearchLoading(false);
        }
      }
    }
    searchByPatient();
    return () => {
      active = false;
    };
  }, [debouncedPatientQuery]);
  
  async function selectPatient(
    patient: Patient,
    options: { preserveQuery?: boolean; isActive?: () => boolean } = {},
  ) {
    const { preserveQuery = false, isActive } = options;
    const checkActive = () => (isActive ? isActive() : true);
    if (!checkActive()) return;
    setSelectedPatient(patient);
    if (!checkActive()) return;
    if (!preserveQuery) {
      setPatientQuery(patient.name);
    }
    setPatientMatches([]);
    setPatientSearchError(null);
    setPatientVisitsLoading(true);
    setPatientVisitsError(null);
    try {
      const visits = await listPatientVisits(patient.patientId);
      if (!checkActive()) return;
      setPatientVisits(visits);
    } catch (error) {
      console.error(error);
      if (!checkActive()) return;
      setPatientVisitsError('Unable to load visits for that patient.');
    } finally {
      if (!checkActive()) return;
      setPatientVisitsLoading(false);
    }
  }
  
  async function handleSelectPatient(patient: Patient) {
    await selectPatient(patient);
  }
  
  function handleSelectVisit(visit: Visit) {
    setForm((prev) => ({
      ...prev,
      visitId: visit.visitId,
      patientId: visit.patientId,
    }));
  }

  async function handleDeleteOrder(labOrderId: string, event: React.MouseEvent) {
    event.stopPropagation(); // Prevent row click navigation
    if (!window.confirm(t('Are you sure you want to delete this lab order?'))) {
      return;
    }
    setDeletingOrderId(labOrderId);
    setError(null);
    try {
      await deleteLabOrder(labOrderId);
      // Remove the deleted order from the list
      setOrders((prev) => prev.filter((order) => order.labOrderId !== labOrderId));
    } catch (err) {
      console.error(err);
      setError(t('Failed to delete lab order.'));
    } finally {
      setDeletingOrderId(null);
    }
  }

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listLabOrders({
          status: statusFilter,
          patientId: patientFilter.trim() || undefined,
        });
        if (!cancelled) {
          setOrders(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(t('Unable to fetch lab orders.'));
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
  }, [canView, patientFilter, statusFilter, t]);

  function updateItem(index: number, key: keyof LabOrderFormState['items'][number], value: string) {
    setForm((prev) => {
      const items = prev.items.map((item, idx) => (idx === index ? { ...item, [key]: value } : item));
      return { ...prev, items };
    });
  }

  function addItemRow() {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { testCode: '', testName: '', specimen: '', notes: '' }],
    }));
  }

  function removeItemRow(index: number) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canOrder) return;
    if (!form.visitId || !form.patientId) {
      setError(t('Visit ID and patient ID are required.'));
      return;
    }
    const validItems = form.items.filter((item) => item.testCode && item.testName);
    if (validItems.length === 0) {
      setError(t('Add at least one lab test.'));
      return;
    }

    const payload: CreateLabOrderPayload = {
      visitId: form.visitId,
      patientId: form.patientId,
      priority: form.priority || undefined,
      notes: form.notes || undefined,
      items: validItems.map((item) => ({
        testCode: item.testCode,
        testName: item.testName,
        specimen: item.specimen || undefined,
        notes: item.notes || undefined,
      })),
    };

    setSaving(true);
    setError(null);
    try {
      const created = await createLabOrder(payload);
      setOrders((prev) => (statusFilter === created.status ? [created, ...prev] : prev));
      setForm({
        visitId: form.visitId,
        patientId: form.patientId,
        priority: '',
        notes: '',
        items: [{ testCode: '', testName: '', specimen: '', notes: '' }],
      });
    } catch (err) {
      console.error(err);
      setError(t('Unable to create lab order.'));
    } finally {
      setSaving(false);
    }
  }

  const subtitle = patientFilter
    ? t('Filtering by patient {id}', { id: patientFilter })
    : t('Manage laboratory workflow');

  return (
    <DashboardLayout title={t('Laboratory Orders')} subtitle={subtitle} activeItem="lab">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">{t('Order entry')}</h2>
            {!canOrder ? (
              <p className="mt-2 text-sm text-gray-500">{t('Only doctors or administrators can create lab orders.')}</p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div className="space-y-4">
                  <div className="rounded-lg border border-dashed border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">{t('Search by patient name')}</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      {t('Start typing a patient name to see recent visits.')}
                    </p>
                    <div className="mt-3 space-y-3">
                      <input
                        value={patientQuery}
                        onChange={(event) => {
                          setPatientQuery(event.target.value);
                          if (event.target.value !== selectedPatient?.name) {
                            setSelectedPatient(null);
                            setPatientVisits([]);
                            setPatientVisitsError(null);
                            setForm((prev) => ({ ...prev, visitId: '', patientId: '' }));
                          }
                        }}
                        placeholder={t('e.g. Jane Doe')}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      {patientSearchError && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          {patientSearchError}
                        </div>
                      )}
                      {patientSearchLoading ? <div className="text-xs text-gray-500">{t('Searching patients…')}</div> : null}
                      {!patientSearchLoading && patientMatches.length > 0 && (
                        <ul className="space-y-2">
                          {patientMatches.slice(0, 5).map((patient) => (
                            <li key={patient.patientId}>
                              <button
                                type="button"
                                onClick={() => handleSelectPatient(patient)}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 transition hover:border-blue-400 hover:bg-blue-50"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-medium text-gray-900">{patient.name}</span>
                                  <span className="text-xs text-gray-500">{new Date(patient.dob).toLocaleDateString()}</span>
                                </div>
                                <div className="mt-1 text-xs text-gray-500">{t('Patient ID: {id}', { id: patient.patientId })}</div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {selectedPatient && (
                        <div className="rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-gray-900">{t('Recent visits for {name}', { name: selectedPatient.name })}</h4>
                              <p className="text-xs text-gray-500">{t('Select a visit to load details.')}</p>
                            </div>
                            <button
                              type="button"
                              className="text-xs font-medium text-blue-600 hover:underline"
                              onClick={() => {
                                setSelectedPatient(null);
                                setPatientVisits([]);
                                setPatientVisitsError(null);
                                setPatientQuery('');
                                setForm((prev) => ({ ...prev, visitId: '', patientId: '' }));
                              }}
                            >
                              {t('Clear')}
                            </button>
                          </div>
                          <div className="mt-3 space-y-2">
                            {patientVisitsLoading ? (
                              <div className="text-xs text-gray-500">{t('Loading visits…')}</div>
                            ) : patientVisitsError ? (
                              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                {patientVisitsError}
                              </div>
                            ) : (() => {
                              // Filter visits to only show those for the current doctor (if user is a doctor)
                              const filteredVisits = user?.role === 'Doctor' && user?.doctorId
                                ? patientVisits.filter(visit => visit.doctorId === user.doctorId)
                                : patientVisits;
                              
                              return filteredVisits.length === 0 ? (
                                <div className="text-xs text-gray-500">
                                  {user?.role === 'Doctor' 
                                    ? t('No visits found for this patient with your doctor profile.')
                                    : t('No visits found for this patient.')}
                                </div>
                              ) : (
                                <select
                                  value={form.visitId}
                                  onChange={(event) => {
                                    const visit = filteredVisits.find(v => v.visitId === event.target.value);
                                    if (visit) {
                                      handleSelectVisit(visit);
                                    }
                                  }}
                                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                  required
                                >
                                  <option value="">{t('Select a visit...')}</option>
                                  {filteredVisits.map((visit) => (
                                    <option key={visit.visitId} value={visit.visitId}>
                                      {new Date(visit.visitDate).toLocaleDateString()} - {visit.doctor.name} ({visit.department})
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex flex-col text-sm font-medium text-gray-700">
                    {t('Visit ID')}
                    <input
                      type="text"
                      value={form.visitId}
                      onChange={(event) => setForm((prev) => ({ ...prev, visitId: event.target.value }))}
                      className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      required
                        readOnly={!!selectedPatient}
                    />
                  </label>
                  <label className="flex flex-col text-sm font-medium text-gray-700">
                    {t('Patient ID')}
                    <input
                      type="text"
                      value={form.patientId}
                      onChange={(event) => setForm((prev) => ({ ...prev, patientId: event.target.value }))}
                        className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 bg-gray-50"
                      required
                        readOnly={!!selectedPatient}
                    />
                  </label>
                  <label className="flex flex-col text-sm font-medium text-gray-700">
                    {t('Priority')}
                    <input
                      type="text"
                      value={form.priority}
                      onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                      className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      placeholder={t('Routine, Stat, ...')}
                    />
                  </label>
                  <label className="flex flex-col text-sm font-medium text-gray-700 sm:col-span-2">
                    {t('Clinical notes')}
                    <textarea
                      value={form.notes}
                      onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                      className="mt-1 h-20 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                  </label>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{t('Tests')}</h3>
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                    >
                      {t('Add test')}
                    </button>
                  </div>
                  {form.items.map((item, index) => (
                    <Fragment key={index}>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col text-sm font-medium text-gray-700">
                          {t('Test code')}
                          <input
                            type="text"
                            value={item.testCode}
                            onChange={(event) => updateItem(index, 'testCode', event.target.value)}
                            className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            required
                          />
                        </label>
                        <label className="flex flex-col text-sm font-medium text-gray-700">
                          {t('Test name')}
                          <input
                            type="text"
                            value={item.testName}
                            onChange={(event) => updateItem(index, 'testName', event.target.value)}
                            className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            required
                          />
                        </label>
                        <label className="flex flex-col text-sm font-medium text-gray-700">
                          {t('Specimen')}
                          <input
                            type="text"
                            value={item.specimen}
                            onChange={(event) => updateItem(index, 'specimen', event.target.value)}
                            className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </label>
                        <label className="flex flex-col text-sm font-medium text-gray-700">
                          {t('Notes')}
                          <input
                            type="text"
                            value={item.notes}
                            onChange={(event) => updateItem(index, 'notes', event.target.value)}
                            className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </label>
                      </div>
                      {form.items.length > 1 && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeItemRow(index)}
                            className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-200"
                          >
                            {t('Remove test')}
                          </button>
                        </div>
                      )}
                    </Fragment>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                  >
                    {saving ? t('Submitting...') : t('Create lab order')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">{t('Orders')}</h2>
              <div className="flex items-center gap-2">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      statusFilter === status
                        ? 'bg-blue-600 text-white shadow'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {t(status.replace('_', ' '))}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <input
                type="text"
                value={patientFilter}
                onChange={(event) => setPatientFilter(event.target.value)}
                className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder={t('Filter by patient ID')}
              />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">{t('Order ID')}</th>
                    <th className="px-4 py-3">{t('Patient')}</th>
                    <th className="px-4 py-3">{t('Created')}</th>
                    <th className="px-4 py-3">{t('Priority')}</th>
                    <th className="px-4 py-3">{t('Tests')}</th>
                    {canOrder && <th className="px-4 py-3">{t('Actions')}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={canOrder ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-500">
                        {t('Loading orders...')}
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={canOrder ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-500">
                        {t('No lab orders in this bucket.')}
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                      <tr
                        key={order.labOrderId}
                        className="cursor-pointer transition hover:bg-blue-50"
                        onClick={() => navigate(`/lab-orders/${order.labOrderId}`)}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">{order.orderId || order.labOrderId}</td>
                        <td className="px-4 py-3 text-gray-700">{order.patientName || order.patientId}</td>
                        <td className="px-4 py-3 text-gray-700">{new Date(order.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-700">{order.priority ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{order.items.length}</td>
                        {canOrder && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteOrder(order.labOrderId, e)}
                              disabled={deletingOrderId === order.labOrderId}
                              className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {deletingOrderId === order.labOrderId ? t('Deleting...') : t('Delete')}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
