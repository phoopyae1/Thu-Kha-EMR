
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { PatientsIcon, SearchIcon } from '../components/icons';
import VitalsCard from '../components/VitalsCard';
import { useAuth } from '../context/AuthProvider';
import {
  createPatientPortalAccount,
  getPatient,
  getPatientPortalAccount,
  listPatientVisits,
  updatePatientPortalAccount,
  type PatientPortalAccount,
  type PatientSummary,
  type Visit,
} from '../api/client';
import { useTranslation } from '../hooks/useTranslation';

function calculateAge(dob: string) {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function normalizePortalStatus(status?: string | null): 'active' | 'inactive' {
  return status === 'inactive' ? 'inactive' : 'active';
}

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManagePortalAccount = Boolean(user && ['AdminAssistant', 'ITAdmin'].includes(user.role));
  const initialTab =
    new URLSearchParams(location.search).get('tab') === 'visits'
      ? 'visits'
      : 'summary';

  const [activeTab, setActiveTab] = useState<'summary' | 'visits'>(initialTab);
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState<string | null>(null);
  const [portalAccount, setPortalAccount] = useState<PatientPortalAccount | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalLoadError, setPortalLoadError] = useState<string | null>(null);
  const [portalAlert, setPortalAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [portalSubmitting, setPortalSubmitting] = useState(false);
  const [portalForm, setPortalForm] = useState<{ email: string; password: string; status: 'active' | 'inactive' }>(
    {
      email: '',
      password: '',
      status: 'active',
    },
  );

  const formatDateValue = useCallback((value: string | Date | null | undefined) => {
    if (!value) return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  }, []);

  const formatDateTimeValue = useCallback((value: string | Date | null | undefined) => {
    if (!value) return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }, []);

  const formatGenderValue = useCallback(
    (gender?: string | null) => {
      if (!gender) return t('Not recorded');
      const normalized = gender.toLowerCase();
      if (normalized === 'm') return t('Male');
      if (normalized === 'f') return t('Female');
      return gender;
    },
    [t],
  );

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const patientId = id;
    if (!patientId) {
      setError('error.patient-missing-id');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPatient(null);

    async function load(targetId: string) {
      try {
        const data = await getPatient(targetId, { include: 'summary' });
        if (!cancelled) {
          setPatient(data as PatientSummary);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('error.patient-load');
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
  }, [id]);

  useEffect(() => {
    setVisits(null);
    setVisitsError(null);
  }, [id]);

  useEffect(() => {
    if (!canManagePortalAccount || !id) {
      setPortalAccount(null);
      setPortalLoadError(null);
      setPortalAlert(null);
      setPortalForm({ email: '', password: '', status: 'active' });
      return;
    }

    let cancelled = false;
    setPortalLoading(true);
    setPortalLoadError(null);
    setPortalAlert(null);

    getPatientPortalAccount(id)
      .then((account) => {
        if (cancelled) return;
        setPortalAccount(account);
        if (account) {
          setPortalForm({
            email: account.email,
            password: '',
            status: normalizePortalStatus(account.status),
          });
        } else {
          setPortalForm({ email: '', password: '', status: 'active' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPortalLoadError(
          err instanceof Error ? err.message : t('Unable to load patient portal account.'),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setPortalLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, canManagePortalAccount, t]);

  useEffect(() => {
    const patientId = id;
    if (activeTab !== 'visits' || !patientId || visits !== null) {
      return;
    }

    let cancelled = false;
    setVisitsLoading(true);
    setVisitsError(null);

    async function loadVisits(targetId: string) {
      try {
        const data = await listPatientVisits(targetId);
        if (!cancelled) {
          setVisits(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setVisitsError('error.patient-visits-load');
        }
      } finally {
        if (!cancelled) {
          setVisitsLoading(false);
        }
      }
    }

    loadVisits(patientId);

    return () => {
      cancelled = true;
    };
  }, [activeTab, id, visits]);

  function handlePortalFormChange(field: 'email' | 'password' | 'status', value: string) {
    setPortalAlert(null);
    setPortalForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreatePortalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;

    const email = portalForm.email.trim();
    const password = portalForm.password.trim();

    if (!email || password.length < 8) {
      setPortalAlert({
        type: 'error',
        message: t('Enter a valid email and a password with at least 8 characters.'),
      });
      return;
    }

    setPortalSubmitting(true);
    setPortalAlert(null);

    try {
      const account = await createPatientPortalAccount({ patientId: id, email, password });
      setPortalAccount(account);
      setPortalForm({
        email: account.email,
        password: '',
        status: normalizePortalStatus(account.status),
      });
      setPortalAlert({ type: 'success', message: t('Portal account created successfully.') });
    } catch (err) {
      setPortalAlert({
        type: 'error',
        message:
          err instanceof Error ? err.message : t('Unable to create patient portal account.'),
      });
    } finally {
      setPortalSubmitting(false);
    }
  }

  async function handleUpdatePortalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portalAccount) return;

    const email = portalForm.email.trim();
    const password = portalForm.password.trim();
    const status = portalForm.status;
    const currentStatus = normalizePortalStatus(portalAccount.status);

    const patch: { email?: string; password?: string; status?: 'active' | 'inactive' } = {};

    if (email && email !== portalAccount.email) {
      patch.email = email;
    }

    if (status !== currentStatus) {
      patch.status = status;
    }

    if (password) {
      if (password.length < 8) {
        setPortalAlert({
          type: 'error',
          message: t('Temporary passwords must be at least 8 characters long.'),
        });
        return;
      }
      patch.password = password;
    }

    if (Object.keys(patch).length === 0) {
      setPortalAlert({ type: 'error', message: t('No changes to update.') });
      return;
    }

    setPortalSubmitting(true);
    setPortalAlert(null);

    try {
      const account = await updatePatientPortalAccount(portalAccount.accountId, patch);
      setPortalAccount(account);
      setPortalForm({
        email: account.email,
        password: '',
        status: normalizePortalStatus(account.status),
      });
      setPortalAlert({ type: 'success', message: t('Portal account updated.') });
    } catch (err) {
      setPortalAlert({
        type: 'error',
        message:
          err instanceof Error ? err.message : t('Unable to update patient portal account.'),
      });
    } finally {
      setPortalSubmitting(false);
    }
  }

  function handleTabChange(tab: 'summary' | 'visits') {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    if (tab === 'summary') {
      params.delete('tab');
    } else {
      params.set('tab', 'visits');
    }
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true },
    );
  }

  const canViewProblems = user && ['Doctor', 'Nurse', 'ITAdmin'].includes(user.role);

  const headerActions = (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <Link
        to="/patients"
        className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
      >
        {t('Patient Directory')}
      </Link>
      {id && canViewProblems && (
        <Link
          to={`/patients/${id}/problems`}
          className="inline-flex items-center justify-center rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
        >
          {t('Problem list')}
        </Link>
      )}
      {id && (
        <Link
          to={`/patients/${id}/visits/new`}
          className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
        >
          {t('Add visit')}
        </Link>
      )}
    </div>
  );

  const subtitle = patient
    ? t('Patient ID: {id}', { id: patient.patientId })
    : loading
      ? t('Loading patient details...')
      : error
        ? t(error)
        : t('Patient details unavailable.');

  function renderPortalAccess() {
    if (!canManagePortalAccount) {
      return null;
    }

    const lastLoginLabel = portalAccount?.lastLoginAt
      ? formatDateTimeValue(portalAccount.lastLoginAt)
      : t('Never');

    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t('Patient Portal Access')}</h3>
            <p className="mt-1 text-sm text-gray-600">
              {portalAccount
                ? t('Manage how this patient signs in to their portal experience.')
                : t("Link this patient's record to their portal login.")}
            </p>
          </div>
        </div>

        {portalLoadError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {portalLoadError}
          </div>
        ) : portalLoading ? (
          <div className="mt-6 flex items-center gap-3 text-sm text-gray-600">
            <SearchIcon className="h-5 w-5 animate-spin text-blue-500" />
            {t('Checking for an existing portal account...')}
          </div>
        ) : (
          <>
            {portalAlert && (
              <div
                className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                  portalAlert.type === 'success'
                    ? 'border border-green-200 bg-green-50 text-green-700'
                    : 'border border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {portalAlert.message}
              </div>
            )}

            {portalAccount ? (
              <form onSubmit={handleUpdatePortalAccount} className="mt-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="portal-email">
                      {t('Portal email address')}
                    </label>
                    <input
                      id="portal-email"
                      type="email"
                      value={portalForm.email}
                      onChange={(event) => handlePortalFormChange('email', event.target.value)}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="portal-status">
                      {t('Status')}
                    </label>
                    <select
                      id="portal-status"
                      value={portalForm.status}
                      onChange={(event) =>
                        handlePortalFormChange('status', event.target.value as 'active' | 'inactive')
                      }
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="active">{t('Active')}</option>
                      <option value="inactive">{t('Inactive')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="portal-password">
                    {t('Temporary password (optional)')}
                  </label>
                  <input
                    id="portal-password"
                    type="password"
                    value={portalForm.password}
                    placeholder="********"
                    onChange={(event) => handlePortalFormChange('password', event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t('Leave blank to keep the current password.')}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-medium text-gray-500">
                    {t('Last sign-in: {value}', { value: lastLoginLabel })}
                  </span>
                  <button
                    type="submit"
                    disabled={portalSubmitting}
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {portalSubmitting ? t('Saving...') : t('Update portal account')}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreatePortalAccount} className="mt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="new-portal-email">
                    {t('Portal email address')}
                  </label>
                  <input
                    id="new-portal-email"
                    type="email"
                    value={portalForm.email}
                    onChange={(event) => handlePortalFormChange('email', event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="new-portal-password">
                    {t('Temporary password')}
                  </label>
                  <input
                    id="new-portal-password"
                    type="password"
                    value={portalForm.password}
                    onChange={(event) => handlePortalFormChange('password', event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {t('Share this password with the patient and ask them to update it after signing in.')}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={portalSubmitting}
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {portalSubmitting ? t('Saving...') : t('Create portal account')}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    );
  }

  function renderSummary(p: PatientSummary) {
    const latestVisitId = p.visits && p.visits.length > 0 ? p.visits[0].visitId : '';

    return (
      <div className="space-y-6">
        {renderPortalAccess()}
        <VitalsCard patientId={p.patientId} defaultVisitId={latestVisitId} />

        {!p.visits || p.visits.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
            <PatientsIcon className="h-12 w-12 text-gray-300" />
            <p className="text-sm font-medium text-gray-600">{t('No visits recorded yet.')}</p>
            {id && (
              <Link
                to={`/patients/${id}/visits/new`}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                {t('Add the first visit')}
              </Link>
            )}
          </div>
          ) : (
            <>
              {p.visits.map((visit) => {
                const diagnoses = visit.diagnoses ?? [];
                const medications = visit.medications ?? [];
                const labs = visit.labResults ?? [];
                const observations = visit.observations ?? [];

                return (
                  <article key={visit.visitId} className="rounded-2xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
                    <div className="flex flex-wrap justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-blue-600">{formatDateValue(visit.visitDate)}</div>
                        <h3 className="mt-1 text-lg font-semibold text-gray-900">
                          {t('Visit with {name}', { name: visit.doctor.name })}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">{visit.doctor.department}</p>
                      </div>
                      <Link
                        to={`/visits/${visit.visitId}`}
                        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                      >
                        {t('Open visit')}
                      </Link>
                    </div>

                    <div className="mt-5 grid gap-5 lg:grid-cols-2">
                      <div className="space-y-4">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{t('Diagnoses')}</div>
                          {diagnoses.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {diagnoses.map((diag) => (
                                <span
                                  key={diag.diagnosis}
                                  className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700"
                                >
                                  {diag.diagnosis}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-gray-500">{t('No diagnoses recorded.')}</p>
                          )}
                        </div>

                        <div>
                          <div className="text-sm font-semibold text-gray-900">{t('Medications')}</div>
                          {medications.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {medications.map((med, index) => {
                                const display = med.dosage ? `${med.drugName} (${med.dosage})` : med.drugName;
                                return (
                                  <span
                                    key={`${med.drugName}-${index}`}
                                    className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
                                  >
                                    {display}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-gray-500">{t('No medications documented.')}</p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{t('Key labs')}</div>
                          {labs.length > 0 ? (
                            <div className="mt-2 space-y-3">
                              {labs.map((lab, index) => {
                                const value =
                                  lab.resultValue !== null && lab.resultValue !== undefined
                                    ? `${lab.resultValue}${lab.unit ? ` ${lab.unit}` : ''}`
                                    : t('Pending');
                                return (
                                  <div
                                    key={`${lab.testName}-${lab.testDate ?? index}`}
                                    className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3"
                                  >
                                    <div className="text-sm font-semibold text-blue-700">{lab.testName}</div>
                                    <div className="mt-1 text-base font-semibold text-blue-900">{value}</div>
                                    {lab.testDate && (
                                      <div className="text-xs text-blue-600">
                                        {t('Collected {date}', { date: formatDateValue(lab.testDate) })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-gray-500">{t('No lab highlights for this visit.')}</p>
                          )}
                        </div>

                        <div>
                          <div className="text-sm font-semibold text-gray-900">{t('Observations')}</div>
                          {observations.length > 0 ? (
                            <ul className="mt-2 space-y-2 text-sm text-gray-700">
                              {observations.map((obs) => (
                                <li key={obs.obsId} className="rounded-lg border border-gray-200 bg-gray-100 px-4 py-3">
                                  <div>{obs.noteText}</div>
                                  <div className="mt-1 text-xs text-gray-500">{formatDateTimeValue(obs.createdAt)}</div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-sm text-gray-500">{t('No recent clinician notes.')}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </>
          )}
      </div>
    );
  }

  function renderVisits() {
    if (visitsLoading) {
      return (
        <div className="flex items-center justify-center rounded-2xl border border-gray-100 bg-gray-50 py-16">
          <div className="flex flex-col items-center gap-3">
            <SearchIcon className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-gray-600">{t('Loading visit history...')}</p>
          </div>
        </div>
      );
    }

    if (visitsError) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {t(visitsError)}
        </div>
      );
    }

    if (!visits) {
      return null;
    }

    if (visits.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <PatientsIcon className="h-12 w-12 text-gray-300" />
          <p className="text-sm font-medium text-gray-600">{t('No visits recorded in the system.')}</p>
          {id && (
            <Link
              to={`/patients/${id}/visits/new`}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              {t('Add visit')}
            </Link>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {visits.map((visit) => (
          <article
            key={visit.visitId}
            className="rounded-2xl border border-gray-200 bg-gray-50 p-5 shadow-sm"
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-blue-600">{formatDateValue(visit.visitDate)}</div>
                <h3 className="mt-1 text-lg font-semibold text-gray-900">
                  {t('Visit with {name}', { name: visit.doctor.name })}
                </h3>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-blue-600">
                    {visit.department}
                  </span>
                  {visit.reason && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-gray-600">
                      {visit.reason}
                    </span>
                  )}
                </div>
              </div>
              <Link
                to={`/visits/${visit.visitId}`}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                {t('View visit')}
              </Link>
            </div>
          </article>
        ))}
      </div>
    );
  }

  const contact = patient?.contact?.trim() || t('Not provided');
  const coverage = patient?.insurance?.trim() || t('Self-pay');
  const allergies = patient?.drugAllergies?.trim() || t('No known allergies');
  const gender = formatGenderValue(patient?.gender);
  const age = patient ? calculateAge(patient.dob) : null;
  const lastVisit = patient?.visits?.[0] ?? null;

  return (
    <DashboardLayout
      title={patient?.name ?? t('Patient Profile')}
      subtitle={subtitle}
      activeItem="patients"
      headerChildren={headerActions}
    >
      {loading ? (
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 shadow-sm">
            <SearchIcon className="h-10 w-10 animate-spin text-blue-500" />
            <p className="text-sm font-medium text-gray-600">{t('Loading patient record...')}</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
          <p className="text-sm font-semibold">{t(error)}</p>
          <Link
            to="/patients"
            className="mt-4 inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100"
          >
            {t('Back to patient directory')}
          </Link>
        </div>
      ) : patient ? (
        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap justify-between gap-6">
              <div>
                <p className="text-sm font-medium text-blue-600">{t('Patient Overview')}</p>
                <h2 className="mt-1 text-2xl font-semibold text-gray-900">{patient.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('Patient ID: {id}', { id: patient.patientId })}</p>
                <p className="mt-2 text-sm text-gray-600">
                  {t('Review demographic details and the latest clinical activity for this patient.')}
                </p>
              </div>
              <div className="min-w-[12rem] rounded-xl bg-gray-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('Primary contact')}
                </div>
                <div className="mt-2 text-base font-semibold text-gray-900">{contact}</div>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: t('Date of Birth'), value: formatDateValue(patient.dob) },
                { label: t('Age'), value: age !== null ? t('{count} yrs', { count: age }) : '—' },
                { label: t('Insurance'), value: coverage },
                { label: t('Drug allergies'), value: allergies },
                { label: t('Gender'), value: gender },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {stat.label}
                  </div>
                  <div className="mt-2 text-base font-semibold text-gray-900">{stat.value}</div>
                </div>
              ))}
            </div>
            <div
              className={`mt-6 rounded-xl px-4 py-3 text-sm ${
                lastVisit
                  ? 'bg-blue-50 text-blue-700'
                  : 'border border-dashed border-blue-200 text-blue-600'
              }`}
            >
              {lastVisit
                ? t('Last visit on {date} with {name} ({department}).', {
                    date: formatDateValue(lastVisit.visitDate),
                    name: lastVisit.doctor.name,
                    department: lastVisit.doctor.department,
                  })
                : t('No recorded visits yet. Add a visit to begin the clinical timeline.')}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Clinical Timeline')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('Explore recent encounters and the complete visit history.')}</p>
              </div>
              <nav
                role="tablist"
                aria-label={t('Patient detail tabs')}
                className="inline-flex rounded-full bg-gray-100 p-1 text-sm font-medium"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'summary'}
                  onClick={() => handleTabChange('summary')}
                  className={`rounded-full px-4 py-2 transition ${
                    activeTab === 'summary'
                      ? 'bg-white text-blue-600 shadow'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {t('Care Summary')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'visits'}
                  onClick={() => handleTabChange('visits')}
                  className={`rounded-full px-4 py-2 transition ${
                    activeTab === 'visits'
                      ? 'bg-white text-blue-600 shadow'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {t('Visit History')}
                </button>
              </nav>
            </div>

            <div className="mt-6">
              {activeTab === 'summary' ? renderSummary(patient) : renderVisits()}
            </div>
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
