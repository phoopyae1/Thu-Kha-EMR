import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createPatient } from '../api/client';
import DashboardLayout from '../components/DashboardLayout';
import { PatientsIcon, RegisterIcon } from '../components/icons';
import { useTranslation } from '../hooks/useTranslation';

export default function RegisterPatient() {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [insurance, setInsurance] = useState('');
  const [drugAllergies, setDrugAllergies] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { adminId } = useParams<{ adminId: string }>();
  const { t } = useTranslation();

  const age = useMemo(() => {
    if (!dob) return null;
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) return null;
    const diff = Date.now() - parsed.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)));
  }, [dob]);

  const previewDob = useMemo(() => {
    if (!dob) return t('Add date of birth');
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) return t('Invalid date');
    return parsed.toLocaleDateString();
  }, [dob, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const patient = await createPatient({ name, dob, insurance, drugAllergies: drugAllergies.trim() || undefined });
      navigate(`/admin/${adminId}/patients/${patient.patientId}`);
    } catch (err) {
      console.error(err);
      window.alert(t('Failed to register patient'));
    } finally {
      setSaving(false);
    }
  }

  const headerActions = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <Link
        to={`/admin/${adminId}/patients`}
        className="inline-flex items-center justify-center rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-100"
      >
        {t('View Patient Directory')}
      </Link>
      <span className="text-xs text-gray-500">{t('All new records sync instantly across the care team.')}</span>
    </div>
  );

  return (
    <DashboardLayout
      title={t('Register Patient')}
      subtitle={t('Capture demographic details to create a new patient record.')}
      activeItem="patients"
      headerChildren={headerActions}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Patient Information')}</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {t("We'll use these details to generate the official chart and identifiers.")}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
                {t('Step 1 of 1')}
              </span>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700" htmlFor="patient-name">
                  {t('Full name')}
                </label>
                <input
                  id="patient-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder={t('e.g. Jane Smith')}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="patient-dob">
                  {t('Date of Birth')}
                </label>
                <input
                  id="patient-dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">{t('Used to calculate age for visit planning and reports.')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="patient-insurance">
                  {t('Insurance partner')}
                </label>
                <input
                  id="patient-insurance"
                  type="text"
                  value={insurance}
                  onChange={(e) => setInsurance(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder={t('e.g. Medicare')}
                  required
                />
                <p className="mt-1 text-xs text-gray-500">{t('Include private or public coverage information.')}</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700" htmlFor="patient-allergies">
                  {t('Drug allergies')}
                </label>
                <textarea
                  id="patient-allergies"
                  value={drugAllergies}
                  onChange={(e) => setDrugAllergies(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder={t('e.g. Penicillin, Ibuprofen')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('Document medications to avoid during care.')}</p>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{t('Ready to create the chart?')}</h3>
              <p className="mt-1 text-sm text-gray-600">{t('Review the details above before saving. You can always edit later.')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/patients"
                className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                {t('Cancel')}
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? t('Saving...') : t('Save Patient')}
              </button>
            </div>
          </div>
        </form>

        <aside className="space-y-6">
          <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                <RegisterIcon className="h-5 w-5" />
              </span>
              <div>
                <div className="text-sm font-medium uppercase tracking-wide text-blue-600">{t('Live Preview')}</div>
                <div className="text-lg font-semibold text-gray-900">{name || t('New patient profile')}</div>
              </div>
            </div>

            <dl className="mt-6 space-y-4 text-sm text-gray-700">
              <div className="flex items-start justify-between gap-3">
                <dt className="font-medium text-gray-600">{t('Date of Birth')}</dt>
                <dd className="text-right text-gray-900">{previewDob}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-medium text-gray-600">{t('Age')}</dt>
                <dd className="text-right text-gray-900">{age != null ? t('{count} years', { count: age }) : '—'}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-medium text-gray-600">{t('Insurance')}</dt>
                <dd className="text-right text-gray-900">{insurance || t('Not captured yet')}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="font-medium text-gray-600">{t('Drug allergies')}</dt>
                <dd className="text-right text-gray-900">{drugAllergies || t('No known allergies')}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <PatientsIcon className="h-6 w-6" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-gray-900">{t('Next steps')}</h3>
                <p className="mt-1 text-sm text-gray-600">{t('After saving, you can add medical history, visits, and observations.')}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              <li>{t('• Schedule an initial visit with the assigned provider.')}</li>
              <li>{t('• Upload prior records or insurance documents if available.')}</li>
              <li>{t('• Notify the care team about new patient onboarding.')}</li>
            </ul>
          </div>
        </aside>
      </div>
    </DashboardLayout>
  );
}
