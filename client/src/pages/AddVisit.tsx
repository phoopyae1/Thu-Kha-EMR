import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  createVisit,
  listDoctors,
  getPatient,
  type Doctor,
  type Patient,
} from '../api/client';
import { useAuth } from '../context/AuthProvider';
import VisitForm from '../components/VisitForm';
import DashboardLayout from '../components/DashboardLayout';
import { PatientsIcon } from '../components/icons';
import { useTranslation } from '../hooks/useTranslation';
import {
  createVisitFormInitialValues,
  persistVisitFormValues,
  type VisitFormSubmitValues,
} from '../utils/visitForm';

export default function AddVisit() {
  const { id, adminId } = useParams<{ id: string; adminId: string }>();
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const { t } = useTranslation();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [saving, setSaving] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientError, setPatientError] = useState<string | null>(null);

  const initialValues = useMemo(
    () =>
      createVisitFormInitialValues({
        visitDate: new Date().toISOString().slice(0, 10),
        ...(user?.doctorId ? { doctorId: user.doctorId } : {}),
      }),
    [user?.doctorId],
  );

  useEffect(() => {
    if (!id) {
      setPatientError('error.patient-missing-id');
      setPatientLoading(false);
      return;
    }

    let cancelled = false;
    setPatientLoading(true);
    setPatientError(null);

    async function loadPatient(targetId: string) {
      try {
        const details = await getPatient(targetId);
        if (!cancelled) {
          setPatient(details as Patient);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setPatientError('error.patient-load');
        }
      } finally {
        if (!cancelled) {
          setPatientLoading(false);
        }
      }
    }

    loadPatient(id);

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!accessToken) return;
    listDoctors()
      .then(setDoctors)
      .catch((err) => console.error(err));
  }, [accessToken]);

  async function handleSubmit(values: VisitFormSubmitValues) {
    if (!id || !user || !values.doctorId) return;
    setSaving(true);
    try {
      const visit = await createVisit({
        patientId: id,
        visitDate: values.visitDate,
        doctorId: values.doctorId,
        department: values.department,
        reason: values.reason,
      });
      await persistVisitFormValues(visit.visitId, values);
      navigate(`/admin/${adminId}/patients/${id}?tab=visits`);
    } catch (err) {
      console.error(err);
      window.alert(t('Failed to save visit'));
    } finally {
      setSaving(false);
    }
  }

  const patientName = patient?.name ?? t('Record a visit');
  const patientSubtitle = patientLoading
    ? t('Loading patient context...')
    : patientError
      ? t(patientError)
      : t('Document the encounter so the care team stays aligned.');

  const patientAge = useMemo(() => (patient ? calculateAge(patient.dob) : null), [patient]);
  const formatDateValue = useCallback(
    (value: string | Date | null | undefined) => {
      if (!value) return t('Not recorded');
      const date = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(date.getTime())) return t('Invalid date');
      return date.toLocaleDateString();
    },
    [t],
  );
  const patientDob = patient ? formatDateValue(patient.dob) : t('Not recorded');
  const patientCoverage = patient?.insurance?.trim() || t('Self-pay');
  const patientContact = patient?.contact?.trim() || t('Not provided');

  const headerActions = id ? (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <Link
        to={`/admin/${adminId}/patients/${id}?tab=visits`}
        className="inline-flex items-center justify-center rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-100"
      >
        {t('Back to patient record')}
      </Link>
      <span className="text-xs text-gray-500">{t('New visits sync instantly with the patient chart.')}</span>
    </div>
  ) : undefined;

  return (
    <DashboardLayout
      title={patient ? t('Add visit for {name}', { name: patient.name }) : patientName}
      subtitle={patientSubtitle}
      activeItem="patients"
      headerChildren={headerActions}
    >
      {patientLoading ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
          <span className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          {t('Retrieving patient details...')}
        </div>
      ) : patientError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
          {t(patientError)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{t('Visit details')}</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t('Capture the visit reason, diagnoses, and treatment plan.')}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                  {t('Required')}
                </span>
              </div>

              <div className="mt-6">
                <VisitForm
                  doctors={doctors}
                  initialValues={initialValues}
                  onSubmit={handleSubmit}
                  saving={saving}
                />
              </div>
            </section>

            <section className="rounded-2xl bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                  <PatientsIcon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{t('Need a quick template?')}</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {t(
                      'Use the notes section to outline patient concerns, assessment, and plan in a SOAP-style format for rapid charting.',
                    )}
                  </p>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <PatientsIcon className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{t('Patient snapshot')}</h3>
                  <p className="mt-1 text-sm text-gray-600">{t('Key chart details for this encounter.')}</p>
                </div>
              </div>

              <dl className="mt-6 space-y-4 text-sm text-gray-700">
                <div className="flex items-start justify-between gap-3">
                  <dt className="font-medium text-gray-600">{t('Date of Birth')}</dt>
                  <dd className="text-right text-gray-900">{patientDob}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="font-medium text-gray-600">{t('Age')}</dt>
                  <dd className="text-right text-gray-900">{patientAge != null ? t('{count} years', { count: patientAge }) : '—'}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="font-medium text-gray-600">{t('Coverage')}</dt>
                  <dd className="text-right text-gray-900">{patientCoverage}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="font-medium text-gray-600">{t('Contact')}</dt>
                  <dd className="text-right text-gray-900">{patientContact}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">{t('Team updates')}</h3>
              <p className="mt-1 text-sm text-gray-600">
                {t(
                  'Mention notable trends or follow-up actions so care coordinators and providers stay aligned across subsequent visits.',
                )}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                <li>{t('• Flag any medication changes in the medication list.')}</li>
                <li>{t('• Log lab orders to populate the analytics dashboards.')}</li>
                <li>{t('• Capture observation notes for nurses reviewing the chart.')}</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </DashboardLayout>
  );
}

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

