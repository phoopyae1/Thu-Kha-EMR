import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cohort, type CohortResult } from '../api/client';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from '../hooks/useTranslation';

const testSuggestions = ['HbA1c', 'LDL'];
const operatorOptions = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'eq', label: '=' },
];
const suggestionListId = 'cohort-test-suggestions';

export default function Cohort() {
  const { t } = useTranslation();
  const { adminId } = useParams<{ adminId: string }>();
  const [testName, setTestName] = useState('');
  const [op, setOp] = useState('gt');
  const [value, setValue] = useState('');
  const [months, setMonths] = useState('6');
  const [results, setResults] = useState<CohortResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await cohort({
        test_name: testName,
        op: op as any,
        value: Number.parseFloat(value),
        months: Number.parseInt(months, 10),
      });
      setResults(data);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message ?? t('Unable to load cohort results. Please try again.'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const resultCount = results.length;
  const matchesLabel =
    resultCount === 1
      ? t('{count} match', { count: resultCount })
      : t('{count} matches', { count: resultCount });

  return (
    <DashboardLayout
      title={t('Cohort Insights')}
      subtitle={t('Identify patients who match specific lab result thresholds.')}
      activeItem="reports"
      headerChildren={false}
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cohort-test-name" className="text-sm font-medium text-gray-700">
                  {t('Test name')}
                </label>
                <input
                  id="cohort-test-name"
                  list={suggestionListId}
                  value={testName}
                  onChange={(event) => setTestName(event.target.value)}
                  required
                  placeholder={t('e.g. HbA1c')}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <datalist id={suggestionListId}>
                  {testSuggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-gray-500">
                  {t('Choose from recent lab tests or enter a custom name.')}
                </p>
              </div>
              <div>
                <label htmlFor="cohort-operator" className="text-sm font-medium text-gray-700">
                  {t('Operator')}
                </label>
                <select
                  id="cohort-operator"
                  value={op}
                  onChange={(event) => setOp(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {operatorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {t('Choose how the lab value should compare to the threshold.')}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cohort-value" className="text-sm font-medium text-gray-700">
                  {t('Threshold value')}
                </label>
                <input
                  id="cohort-value"
                  type="number"
                  step="any"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required
                  placeholder={t('Enter a number')}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('Patients with values meeting this threshold will be included.')}
                </p>
              </div>
              <div>
                <label htmlFor="cohort-months" className="text-sm font-medium text-gray-700">
                  {t('Look-back period (months)')}
                </label>
                <input
                  id="cohort-months"
                  type="number"
                  min="1"
                  value={months}
                  onChange={(event) => setMonths(event.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('Check for qualifying labs within this timeframe.')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {loading ? t('Searching...') : t('Run cohort')}
              </button>
              <span className="text-xs text-gray-500">
                {t('Results update as you adjust the cohort criteria.')}
              </span>
            </div>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('Matching patients')}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {loading
                  ? t('Searching for matching patients...')
                  : resultCount > 0
                    ? t('The latest qualifying lab result is shown for each patient.')
                    : t('Run a cohort query to see which patients match your criteria.')}
              </p>
            </div>
            {resultCount > 0 && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600">
                {matchesLabel}
              </span>
            )}
          </div>
          <div className="mt-6 space-y-4">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : loading ? (
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                {t('Gathering cohort data...')}
              </div>
            ) : resultCount > 0 ? (
              results.map((result) => (
                <div
                  key={result.patientId}
                  className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm transition hover:border-blue-200 hover:shadow-md"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{result.name}</div>
                      <div className="text-xs text-gray-500">
                        {t('Patient ID: {id}', { id: result.patientId })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('Latest value')}
                      </div>
                      <div className="text-lg font-semibold text-blue-600">
                        {result.lastMatchingLab.value}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(result.lastMatchingLab.date).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                    <span>{t('Visit ID: {id}', { id: result.lastMatchingLab.visitId })}</span>
                    <Link
                      to={`/admin/${adminId}/visits/${result.lastMatchingLab.visitId}`}
                      className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-600 transition hover:bg-blue-100"
                    >
                      {t('View visit')}
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                {t('No patients match the current criteria yet. Try adjusting the threshold or timeframe.')}
              </div>
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
