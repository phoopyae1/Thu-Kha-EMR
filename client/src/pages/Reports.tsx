import { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { getReportSummary, listDoctors, type ReportSummary, type Doctor } from '../api/client';
import { useTranslation } from '../hooks/useTranslation';
import { useAuth } from '../context/AuthProvider';

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString();
}

function formatMonth(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

interface MetricCardProps {
  label: string;
  value: number;
  highlight?: boolean;
}

function MetricCard({ label, value, highlight = false }: MetricCardProps) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        highlight ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-200'
      }`}
    >
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{formatNumber(value)}</p>
    </div>
  );
}

export default function Reports() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ITAdmin' || user?.role === 'AdminAssistant';
  const isDoctor = user?.role === 'Doctor';
  
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);

  // For doctors, automatically use their doctorId
  const effectiveDoctorId = isDoctor ? (user?.doctorId || null) : (selectedDoctorId || null);

  // Load doctors list (only for admins)
  useEffect(() => {
    if (!isAdmin) {
      setDoctorsLoading(false);
      return;
    }

    let cancelled = false;
    listDoctors()
      .then((doctorsList) => {
        if (!cancelled) {
          setDoctors(doctorsList);
        }
      })
      .catch((err: any) => {
        console.error('Failed to load doctors:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setDoctorsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Load report data when doctor selection changes or user changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    
    getReportSummary(effectiveDoctorId)
      .then((summary) => {
        if (!cancelled) {
          setData(summary);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || t('Unable to load reporting data.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveDoctorId, t]);

  const metrics = useMemo(() => {
    if (!data) return [];
    const baseMetrics = [
      { label: t('Total patients'), value: data.totals.patients, highlight: true },
      { label: t('Active patients (90d)'), value: data.totals.activePatients },
      { label: t('Visits in last 30 days'), value: data.totals.visitsLast30Days },
      { label: t('Upcoming appointments (7d)'), value: data.totals.upcomingAppointments },
    ];
    // Only show doctors count when not filtering by a specific doctor and user is admin
    if (!effectiveDoctorId && isAdmin) {
      baseMetrics.push({ label: t('Doctors'), value: data.totals.doctors });
    }
    return baseMetrics;
  }, [data, effectiveDoctorId, isAdmin, t]);

  // Get doctor name for display
  const selectedDoctor = useMemo(() => {
    if (!effectiveDoctorId) return null;
    const found = doctors.find(d => d.doctorId === effectiveDoctorId);
    if (found) return found;
    // If doctor is viewing their own reports but not in the list, show a placeholder
    if (isDoctor && user?.doctorId === effectiveDoctorId) {
      return { name: user.email.split('@')[0], department: 'N/A' };
    }
    return null;
  }, [effectiveDoctorId, doctors, isDoctor, user]);

  return (
    <DashboardLayout title={t('Reports overview')} subtitle={t('Monitor clinical and operational trends')} activeItem="reports">
      {isAdmin && (
        <div className="mb-6 flex items-center gap-4">
          <label htmlFor="doctor-select" className="text-sm font-medium text-gray-700">
            {t('Filter by doctor')}:
          </label>
          <select
            id="doctor-select"
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            disabled={doctorsLoading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:bg-gray-100 disabled:text-gray-500"
          >
            <option value="">{t('All doctors')}</option>
            {doctors.map((doctor) => (
              <option key={doctor.doctorId} value={doctor.doctorId}>
                {doctor.name} ({doctor.department})
              </option>
            ))}
          </select>
          {selectedDoctor && (
            <span className="text-sm text-gray-600">
              {t('Showing reports for {name}', { name: selectedDoctor.name })}
            </span>
          )}
        </div>
      )}
      {isDoctor && effectiveDoctorId && (
        <div className="mb-6 text-sm text-gray-600">
          {t('Showing your reports')}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">{t('Loading report...')}</p>}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {!loading && !error && !data && (
        <p className="text-sm text-gray-500">{t('No reporting data is available yet.')}</p>
      )}

      {data && (
        <div className="space-y-10">
          <section>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {metrics.map((metric) => (
                <MetricCard key={metric.label} {...metric} />
              ))}
            </div>
          </section>

          <section className={`grid gap-8 ${effectiveDoctorId ? 'lg:grid-cols-1' : 'lg:grid-cols-2'}`}>
            {!effectiveDoctorId && (
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">{t('Visits by department (90 days)')}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {t('Highlights departments with the highest encounter volume and unique patient counts.')}
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide">
                          {t('Department')}
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                          {t('Visits')}
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                          {t('Patients')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.visitsByDepartment.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                            {t('No visit data available.')}
                          </td>
                        </tr>
                      )}
                      {data.visitsByDepartment.map((row) => (
                        <tr key={row.department}>
                          <td className="px-4 py-2 font-medium text-gray-900">{row.department || t('Unassigned')}</td>
                          <td className="px-4 py-2 text-right text-gray-700">{formatNumber(row.visitCount)}</td>
                          <td className="px-4 py-2 text-right text-gray-700">{formatNumber(row.patientCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">{t('Top diagnoses')}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {t('Shows the most common diagnoses captured across visits.')}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide">
                        {t('Diagnosis')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                        {t('Occurrences')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.topDiagnoses.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                          {t('No diagnosis data available.')}
                        </td>
                      </tr>
                    )}
                    {data.topDiagnoses.map((row) => (
                      <tr key={row.diagnosis}>
                        <td className="px-4 py-2 font-medium text-gray-900">{row.diagnosis}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatNumber(row.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">{t('Lab result summary')}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {t('Tracks testing volume, average values and the date of the most recent result for each assay.')}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide">
                        {t('Test')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                        {t('Results recorded')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                        {t('Average value')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                        {t('Last result date')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.labSummaries.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                          {t('No lab data available.')}
                        </td>
                      </tr>
                    )}
                    {data.labSummaries.map((row) => (
                      <tr key={row.testName}>
                        <td className="px-4 py-2 font-medium text-gray-900">{row.testName}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatNumber(row.tests)}</td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          {row.averageValue === null ? '—' : row.averageValue.toFixed(1)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatDate(row.lastTestDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">{t('Monthly visit trend')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('Rolling six month overview of completed visits.')}</p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide">
                        {t('Month')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wide">
                        {t('Visits')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.monthlyVisitTrends.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                          {t('No recent visit data available.')}
                        </td>
                      </tr>
                    )}
                    {data.monthlyVisitTrends.map((row) => (
                      <tr key={row.month}>
                        <td className="px-4 py-2 font-medium text-gray-900">{formatMonth(row.month)}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatNumber(row.visitCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </DashboardLayout>
  );
}

