import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarIcon,
  CheckIcon,
  MessageIcon,
  PatientsIcon,
  PharmacyIcon,
  ReportsIcon,
  SearchIcon,
} from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';
import {
  fetchFacilities,
  fetchSpecialists,
  type FacilityResponse,
  type SpecialistResponse,
} from '../api/patientPortal';

const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatMinutes(minutes: number) {
  const hrs = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = Math.abs(minutes % 60)
    .toString()
    .padStart(2, '0');
  return `${hrs}:${mins}`;
}

export default function PatientPortalLanding() {
  const { appName, logo } = useSettings();
  const { t } = useTranslation();
  const displayName = useMemo(() => appName || t('EMR System'), [appName, t]);

  const featureCards = [
    {
      icon: CalendarIcon,
      title: t('Book visits in minutes'),
      body: t('Pick a time that works for you and our staff will confirm shortly.'),
    },
    {
      icon: MessageIcon,
      title: t('Stay connected'),
      body: t('Receive reminders, follow-up notes, and digital instructions.'),
    },
    {
      icon: CheckIcon,
      title: t('Track your care'),
      body: t('Review lab work, imaging, vaccines, and billing anytime.'),
    },
  ];

  const [facilities, setFacilities] = useState<FacilityResponse[]>([]);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistResponse[]>([]);
  const [specialistsError, setSpecialistsError] = useState<string | null>(null);

  useEffect(() => {
    fetchFacilities()
      .then(setFacilities)
      .catch((error: Error) => setFacilitiesError(error.message));

    fetchSpecialists()
      .then(setSpecialists)
      .catch((error: Error) => setSpecialistsError(error.message));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-white">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt={`${displayName} logo`} className="h-10 w-auto rounded" />
          ) : (
            <span className="text-xl font-semibold text-blue-700">{displayName}</span>
          )}
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t('Patient Portal')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/admin/login"
            className="rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          >
            {t('Return to admin login')}
          </Link>
          <Link
            to="/login"
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
          >
            {t('Access patient portal')}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 pb-16">
        <section className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-3xl bg-blue-700 p-10 text-white shadow-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-100">
              {t('Care that revolves around you')}
            </div>
            <h1 className="mt-6 text-4xl font-bold leading-tight sm:text-5xl">
              {t('Welcome to {name}', { name: displayName })}
            </h1>
            <p className="mt-4 text-lg text-blue-100">
              {t('Manage appointments, records, and payments from one secure place designed for patients and families.')}
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {featureCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.title} className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm backdrop-blur">
                    <Icon className="h-6 w-6 text-white" />
                    <div className="mt-3 font-semibold">{card.title}</div>
                    <p className="mt-1 text-blue-100/90">{card.body}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-8 shadow-xl">
            <h2 className="text-2xl font-semibold text-gray-900">{t('Your digital front door')}</h2>
            <p className="mt-2 text-sm text-gray-500">
              {t('Securely connect with your care team, schedule visits, and stay on top of your medical journey.')}
            </p>
            <div className="mt-6 space-y-4 text-sm text-gray-600">
              <div className="flex items-center gap-3">
                <CalendarIcon className="h-5 w-5 text-blue-600" />
                <span>{t('Request or reschedule appointments online')}</span>
              </div>
              <div className="flex items-center gap-3">
                <ReportsIcon className="h-5 w-5 text-blue-600" />
                <span>{t('Review lab, imaging, and visit summaries in one place')}</span>
              </div>
              <div className="flex items-center gap-3">
                <PharmacyIcon className="h-5 w-5 text-blue-600" />
                <span>{t('Track prescriptions and immunisations with reminders')}</span>
              </div>
              <div className="flex items-center gap-3">
                <PatientsIcon className="h-5 w-5 text-blue-600" />
                <span>{t('Manage care for family members with linked accounts')}</span>
              </div>
            </div>
            <Link
              to="/login"
              className="mt-8 inline-flex items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
            >
              {t('Sign in to continue')}
            </Link>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">{t('Clinics and hospitals')}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <SearchIcon className="h-5 w-5 text-blue-600" />
              {t('Find a location and get directions instantly.')}
            </div>
          </div>
          {facilitiesError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{facilitiesError}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {facilities.map((facility) => (
                <div key={facility.facilityId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">{facility.name}</h4>
                      <p className="text-xs uppercase tracking-wide text-blue-600">
                        {facility.type === 'GPClinic' ? t('GP clinic') : t('Hospital')}
                      </p>
                    </div>
                    <a
                      href={facility.mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"
                    >
                      {t('View map')}
                    </a>
                  </div>
                  <p className="mt-3 text-sm text-gray-600">
                    {facility.addressLine1}
                    {facility.addressLine2 ? `, ${facility.addressLine2}` : ''}, {facility.city}, {facility.state}
                    {facility.postalCode ? ` ${facility.postalCode}` : ''}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm text-gray-500">
                    {facility.phone ? <span>{facility.phone}</span> : null}
                    {facility.email ? <span>{facility.email}</span> : null}
                    {facility.website ? (
                      <a href={facility.website} className="text-blue-600 underline" target="_blank" rel="noreferrer">
                        {facility.website}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">{t('Find a specialist')}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <PatientsIcon className="h-5 w-5 text-blue-600" />
              {t('See who is available by department and facility.')}
            </div>
          </div>
          {specialistsError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{specialistsError}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {specialists.map((specialist) => (
                <div key={specialist.doctorId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">{specialist.name}</h4>
                      <p className="text-sm text-blue-600">{specialist.department}</p>
                    </div>
                    <SearchIcon className="h-5 w-5 text-blue-500" />
                  </div>
                  <div className="mt-3 text-sm text-gray-500">
                    {specialist.facility ? (
                      <span>
                        {specialist.facility.name} • {specialist.facility.city}, {specialist.facility.state}
                      </span>
                    ) : (
                      <span>{t('Virtual and in-clinic appointments')}</span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
                    {specialist.availabilities.map((window, index) => {
                      const dayLabel = dayLabels[window.dayOfWeek % 7] ?? t('Day {index}', { index: window.dayOfWeek });
                      return (
                        <span
                          key={`${specialist.doctorId}-${index}`}
                          className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700"
                        >
                          {dayLabel} {formatMinutes(window.startMin)}-{formatMinutes(window.endMin)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

