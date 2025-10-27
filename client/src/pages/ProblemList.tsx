import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from '../hooks/useTranslation';
import { useAuth } from '../context/AuthProvider';
import {
  createProblem,
  listProblems,
  updateProblemStatus,
  type ProblemEntry,
  type ProblemStatus,
} from '../api/clinical';

type ProblemFormState = {
  display: string;
  codeSystem: string;
  code: string;
  onsetDate: string;
};

export default function ProblemList() {
  const { t } = useTranslation();
  const { patientId, adminId } = useParams<{ patientId: string; adminId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = useMemo(() => user && ['Doctor', 'ITAdmin'].includes(user.role), [user]);
  const canResolve = canEdit;
  const [problems, setProblems] = useState<ProblemEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'RESOLVED' | 'ALL'>('ACTIVE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProblemFormState>({
    display: '',
    codeSystem: '',
    code: '',
    onsetDate: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!patientId) {
      navigate(`/admin/${adminId}/patients`);
      return;
    }
  }, [patientId, navigate]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    async function load(id: string) {
      setLoading(true);
      setError(null);
      try {
        const data = await listProblems(id, statusFilter === 'ALL' ? undefined : statusFilter);
        if (!cancelled) {
          setProblems(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(t('Unable to load problem list.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load(patientId);
    return () => {
      cancelled = true;
    };
  }, [patientId, statusFilter, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !patientId) return;
    if (!form.display.trim()) {
      setError(t('Problem name is required.'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createProblem({
        patientId,
        display: form.display.trim(),
        codeSystem: form.codeSystem ? form.codeSystem.trim() : undefined,
        code: form.code ? form.code.trim() : undefined,
        onsetDate: form.onsetDate ? new Date(form.onsetDate).toISOString() : undefined,
      });
      setProblems((prev) => [created, ...prev]);
      setForm({ display: '', codeSystem: '', code: '', onsetDate: '' });
    } catch (err) {
      console.error(err);
      setError(t('Failed to create problem.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleResolve(problemId: string, status: ProblemStatus) {
    if (!canResolve) return;
    try {
      const resolved = await updateProblemStatus(
        problemId,
        status,
        status === 'RESOLVED' ? new Date().toISOString() : undefined,
      );
      setProblems((prev) => prev.map((p) => (p.problemId === problemId ? resolved : p)));
    } catch (err) {
      console.error(err);
      setError(t('Unable to update problem status.'));
    }
  }

  const subtitle = patientId ? t('Problems for patient {id}', { id: patientId }) : t('Select a patient');

  return (
    <DashboardLayout title={t('Problem List')} subtitle={subtitle} activeItem="patients">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <Link
            to={patientId ? `/patients/${patientId}` : '/patients'}
            className="rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            {t('Back to patient')}
          </Link>
          <div className="flex items-center gap-2">
            {['ACTIVE', 'RESOLVED', 'ALL'].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value as typeof statusFilter)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  statusFilter === value
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t(value === 'ALL' ? 'All' : value === 'ACTIVE' ? 'Active' : 'Resolved')}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {canEdit && (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">{t('Add problem')}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col text-sm font-medium text-gray-700 sm:col-span-2">
                {t('Problem name')}
                <input
                  type="text"
                  value={form.display}
                  onChange={(event) => setForm((prev) => ({ ...prev, display: event.target.value }))}
                  className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  required
                />
              </label>
              <label className="flex flex-col text-sm font-medium text-gray-700">
                {t('Code system')}
                <input
                  type="text"
                  value={form.codeSystem}
                  onChange={(event) => setForm((prev) => ({ ...prev, codeSystem: event.target.value }))}
                  className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder={t('ICD-10, SNOMED...')}
                />
              </label>
              <label className="flex flex-col text-sm font-medium text-gray-700">
                {t('Code')}
                <input
                  type="text"
                  value={form.code}
                  onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                  className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </label>
              <label className="flex flex-col text-sm font-medium text-gray-700">
                {t('Onset date')}
                <input
                  type="date"
                  value={form.onsetDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, onsetDate: event.target.value }))}
                  className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
              >
                {saving ? t('Saving...') : t('Add problem')}
              </button>
            </div>
          </form>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('Problem')}</th>
                  <th className="px-4 py-3">{t('Code')}</th>
                  <th className="px-4 py-3">{t('Onset')}</th>
                  <th className="px-4 py-3">{t('Status')}</th>
                  <th className="px-4 py-3">{t('Updated')}</th>
                  {canResolve && <th className="px-4 py-3 text-right">{t('Actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={canResolve ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-500">
                      {t('Loading problem list...')}
                    </td>
                  </tr>
                ) : problems.length === 0 ? (
                  <tr>
                    <td colSpan={canResolve ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-500">
                      {t('No problems recorded for this patient.')}
                    </td>
                  </tr>
                ) : (
                  problems.map((problem) => (
                    <tr key={problem.problemId}>
                      <td className="px-4 py-3 text-gray-900">
                        <div className="font-medium">{problem.display}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {problem.code ? `${problem.codeSystem ?? ''} ${problem.code}`.trim() : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {problem.onsetDate ? new Date(problem.onsetDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                            problem.status === 'ACTIVE'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-green-50 text-green-700'
                          }`}
                        >
                          {t(problem.status === 'ACTIVE' ? 'Active' : 'Resolved')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {new Date(problem.updatedAt).toLocaleDateString()}
                      </td>
                      {canResolve && (
                        <td className="px-4 py-3 text-right">
                          {problem.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              className="rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-green-700"
                              onClick={() => handleResolve(problem.problemId, 'RESOLVED')}
                            >
                              {t('Mark resolved')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700"
                              onClick={() => handleResolve(problem.problemId, 'ACTIVE')}
                            >
                              {t('Reopen')}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
