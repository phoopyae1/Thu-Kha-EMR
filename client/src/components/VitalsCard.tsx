import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthProvider';
import {
  createVitals,
  listVitals,
  type CreateVitalsPayload,
  type VitalsEntry,
} from '../api/clinical';
import { useTranslation } from '../hooks/useTranslation';

interface VitalsCardProps {
  patientId: string;
  defaultVisitId?: string;
  limit?: number;
}

type VitalsFormState = {
  visitId: string;
  systolic: string;
  diastolic: string;
  heartRate: string;
  temperature: string;
  spo2: string;
  heightCm: string;
  weightKg: string;
  notes: string;
};

export default function VitalsCard({ patientId, defaultVisitId = '', limit = 10 }: VitalsCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canRecord = useMemo(
    () => user && ['Nurse', 'Doctor', 'ITAdmin'].includes(user.role),
    [user],
  );
  const [vitalsList, setVitalsList] = useState<VitalsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<VitalsFormState>({
    visitId: defaultVisitId,
    systolic: '',
    diastolic: '',
    heartRate: '',
    temperature: '',
    spo2: '',
    heightCm: '',
    weightKg: '',
    notes: '',
  });

  useEffect(() => {
    setForm((prev) => ({ ...prev, visitId: defaultVisitId }));
  }, [defaultVisitId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listVitals(patientId, limit);
        if (!cancelled) {
          setVitalsList(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(t('Failed to load vitals.'));
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
  }, [patientId, limit, t]);

  function parseNumber(value: string): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecord) return;
    if (!form.visitId) {
      setError(t('Visit ID is required to record vitals.'));
      return;
    }

    const payload: CreateVitalsPayload = {
      visitId: form.visitId,
      patientId,
    };

    // Only include fields that have values
    const systolic = parseNumber(form.systolic);
    if (systolic !== null) payload.systolic = systolic;
    
    const diastolic = parseNumber(form.diastolic);
    if (diastolic !== null) payload.diastolic = diastolic;
    
    const heartRate = parseNumber(form.heartRate);
    if (heartRate !== null) payload.heartRate = heartRate;
    
    const temperature = parseNumber(form.temperature);
    if (temperature !== null) payload.temperature = temperature;
    
    const spo2 = parseNumber(form.spo2);
    if (spo2 !== null) payload.spo2 = spo2;
    
    const heightCm = parseNumber(form.heightCm);
    if (heightCm !== null) payload.heightCm = heightCm;
    
    const weightKg = parseNumber(form.weightKg);
    if (weightKg !== null) payload.weightKg = weightKg;
    
    if (form.notes?.trim()) {
      payload.notes = form.notes.trim();
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createVitals(payload);
      setVitalsList((prev) => [created, ...prev].slice(0, limit));
      setForm({
        visitId: form.visitId,
        systolic: '',
        diastolic: '',
        heartRate: '',
        temperature: '',
        spo2: '',
        heightCm: '',
        weightKg: '',
        notes: '',
      });
    } catch (err) {
      console.error('Error saving vitals:', err);
      let errorMessage = t('Unable to save vitals entry.');
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed?.error || parsed?.details) {
            errorMessage = parsed.error || JSON.stringify(parsed.details);
          } else {
            errorMessage = err.message;
          }
        } catch {
          errorMessage = err.message || errorMessage;
        }
      }
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t('Vitals')}</h2>
        {loading && <span className="text-sm text-gray-500">{t('Loading...')}</span>}
      </div>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {canRecord && (
        <form onSubmit={handleSubmit} className="mb-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Visit ID')}
              <input
                type="text"
                value={form.visitId}
                onChange={(event) => setForm((prev) => ({ ...prev, visitId: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder={t('Enter visit ID')}
                required
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Systolic (mmHg)')}
              <input
                type="number"
                value={form.systolic}
                onChange={(event) => setForm((prev) => ({ ...prev, systolic: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Diastolic (mmHg)')}
              <input
                type="number"
                value={form.diastolic}
                onChange={(event) => setForm((prev) => ({ ...prev, diastolic: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Heart Rate (bpm)')}
              <input
                type="number"
                value={form.heartRate}
                onChange={(event) => setForm((prev) => ({ ...prev, heartRate: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Temperature (°C)')}
              <input
                type="number"
                step="0.1"
                value={form.temperature}
                onChange={(event) => setForm((prev) => ({ ...prev, temperature: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('SpO₂ (%)')}
              <input
                type="number"
                value={form.spo2}
                onChange={(event) => setForm((prev) => ({ ...prev, spo2: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Height (cm)')}
              <input
                type="number"
                step="0.1"
                value={form.heightCm}
                onChange={(event) => setForm((prev) => ({ ...prev, heightCm: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700">
              {t('Weight (kg)')}
              <input
                type="number"
                step="0.1"
                value={form.weightKg}
                onChange={(event) => setForm((prev) => ({ ...prev, weightKg: event.target.value }))}
                className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-3">
              {t('Notes')}
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                className="mt-1 h-20 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                maxLength={500}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {saving ? t('Saving...') : t('Record vitals')}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">{t('Recorded At')}</th>
              <th className="px-3 py-2">{t('BP')}</th>
              <th className="px-3 py-2">{t('Heart Rate')}</th>
              <th className="px-3 py-2">{t('Temperature')}</th>
              <th className="px-3 py-2">{t('SpO₂')}</th>
              <th className="px-3 py-2">{t('BMI')}</th>
              <th className="px-3 py-2">{t('Notes')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vitalsList.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-gray-500">
                  {t('No vitals captured yet.')}
                </td>
              </tr>
            ) : (
              vitalsList.map((entry) => (
                <tr key={entry.vitalsId}>
                  <td className="px-3 py-2 text-gray-700">
                    {new Date(entry.recordedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {entry.systolic && entry.diastolic
                      ? `${entry.systolic}/${entry.diastolic} mmHg`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {entry.heartRate != null ? `${entry.heartRate} bpm` : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {entry.temperature != null ? `${entry.temperature.toFixed(1)} °C` : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {entry.spo2 != null ? `${entry.spo2}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {entry.bmi != null ? entry.bmi.toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {entry.notes ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
