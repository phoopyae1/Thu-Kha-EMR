import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarIcon,
  CheckIcon,
  MessageIcon,
  AvatarIcon,
  ReportsIcon,
  SearchIcon,
  MapPinIcon,
  StethoscopeIcon,
  RadiologyIcon,
  VaccineIcon,
  WalletIcon,
} from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';
import {
  createPatientAppointment,
  fetchFacilities,
  fetchImmunizations,
  fetchLabResults,
  fetchPatientAppointments,
  fetchPatientProfile,
  fetchPayments,
  fetchRadiologyReports,
  fetchSpecialists,
  loginPatient,
  type FacilityResponse,
  type SpecialistResponse,
} from '../api/patientPortal';

interface LoginForm {
  email: string;
  password: string;
}

interface AppointmentForm {
  doctorId: string;
  date: string;
  time: string;
  reason: string;
}

interface PortalSession {
  token: string;
  patientId: string;
  email: string;
}

function formatMinutes(minutes: number) {
  const hrs = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = Math.abs(minutes % 60)
    .toString()
    .padStart(2, '0');
  return `${hrs}:${mins}`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MMK', maximumFractionDigits: 0 }).format(
    amount,
  );
}

const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const defaultLoginForm: LoginForm = { email: 'patient@example.com', password: '' };
const defaultAppointmentForm: AppointmentForm = { doctorId: '', date: '', time: '', reason: '' };

export default function PatientPortal() {
  const { appName, logo } = useSettings();
  const { t } = useTranslation();

  const [facilities, setFacilities] = useState<FacilityResponse[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistResponse[]>([]);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [specialistsError, setSpecialistsError] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState<LoginForm>(defaultLoginForm);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [session, setSession] = useState<PortalSession | null>(null);

  const [profile, setProfile] = useState<any | null>(null);
  const [appointments, setAppointments] = useState<any | null>(null);
  const [labs, setLabs] = useState<any[]>([]);
  const [immunizations, setImmunizations] = useState<any[]>([]);
  const [radiologyReports, setRadiologyReports] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const [appointmentForm, setAppointmentForm] = useState<AppointmentForm>(defaultAppointmentForm);
  const [appointmentStatus, setAppointmentStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [appointmentError, setAppointmentError] = useState<string | null>(null);

  useEffect(() => {
    fetchFacilities()
      .then(setFacilities)
      .catch((error: Error) => setFacilitiesError(error.message));
    fetchSpecialists()
      .then((data) => {
        setSpecialists(data);
        if (data.length > 0) {
          setAppointmentForm((previous) => ({ ...previous, doctorId: data[0].doctorId }));
        }
      })
      .catch((error: Error) => setSpecialistsError(error.message));
  }, []);

  const displayName = useMemo(() => appName || t('EMR System'), [appName, t]);

  const handleLoginChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setLoginForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleAppointmentChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setAppointmentForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setLoginStatus('loading');

    try {
      const response = await loginPatient(loginForm.email.trim(), loginForm.password.trim());
      setSession({ token: response.accessToken, patientId: response.user.patientId!, email: response.user.email });
      setLoginStatus('success');
      setPortalError(null);
    } catch (error) {
      setLoginStatus('idle');
      setLoginError(error instanceof Error ? error.message : t('Unable to sign in. Please try again.'));
    }
  };

  const loadPortalData = async (activeSession: PortalSession) => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const [profileData, appointmentData, labData, immunizationData, radiologyData, paymentData] = await Promise.all([
        fetchPatientProfile(activeSession.token),
        fetchPatientAppointments(activeSession.token),
        fetchLabResults(activeSession.token),
        fetchImmunizations(activeSession.token),
        fetchRadiologyReports(activeSession.token),
        fetchPayments(activeSession.token),
      ]);

      setProfile(profileData);
      setAppointments(appointmentData);
      setLabs(labData);
      setImmunizations(immunizationData);
      setRadiologyReports(radiologyData);
      setPayments(paymentData);
      setPortalLoading(false);
      setAppointmentStatus('idle');
    } catch (error) {
      setPortalLoading(false);
      setPortalError(error instanceof Error ? error.message : t('Unable to load patient data.'));
    }
  };

  useEffect(() => {
    if (session) {
      void loadPortalData(session);
    }
  }, [session]);

  const handleAppointmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;

    setAppointmentError(null);
    setAppointmentStatus('loading');

    const selectedDoctor = specialists.find((item) => item.doctorId === appointmentForm.doctorId);
    const [hour, minute] = appointmentForm.time.split(':');
    const startTimeMin = Number(hour) * 60 + Number(minute || '0');

    try {
      await createPatientAppointment(session.token, {
        doctorId: appointmentForm.doctorId,
        department: selectedDoctor?.department,
        date: appointmentForm.date,
        startTimeMin,
        reason: appointmentForm.reason,
      });
      setAppointmentStatus('success');
      setAppointmentForm((previous) => ({ ...previous, reason: '' }));
      await loadPortalData(session);
    } catch (error) {
      setAppointmentStatus('idle');
      setAppointmentError(error instanceof Error ? error.message : t('Unable to schedule appointment.'));
    }
  };

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

  const invoiceSummary = profile?.invoiceSummary;
  const upcomingAppointments = appointments?.upcoming ?? [];
  const pastAppointments = appointments?.past ?? [];

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
        <Link
          to="/login"
          className="rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
        >
          {t('Return to staff login')}
        </Link>
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
            <h2 className="text-2xl font-semibold text-gray-900">
              {session ? t('Signed in as {email}', { email: session.email }) : t('Patient sign-in')}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {session
                ? t('You can review your care history and book new visits below.')
                : t('Use the credentials shared by your clinic to access your personal records.')}
            </p>
            {session ? (
              <div className="mt-6 space-y-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <div className="flex items-center gap-2 font-medium">
                  <CheckIcon className="h-5 w-5" />
                  {t('You are securely signed in to the patient portal.')}
                </div>
                <p className="text-green-700">
                  {t('Need to sign in with a different account? Refresh the page or open a private browser window.')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="email" className="text-sm font-medium text-gray-700">
                    {t('Email address')}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={loginForm.email}
                    onChange={handleLoginChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="text-sm font-medium text-gray-700">
                    {t('Password')}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={loginForm.password}
                    onChange={handleLoginChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                {loginError ? <p className="text-sm text-red-600">{loginError}</p> : null}
                <button
                  type="submit"
                  disabled={loginStatus === 'loading'}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  <AvatarIcon className="h-5 w-5" />
                  {loginStatus === 'loading' ? t('Signing in...') : t('Access my records')}
                </button>
                <p className="text-xs text-gray-500">
                  {t('Tip: You can use the demo account {email} with password {password}.', {
                    email: 'patient@example.com',
                    password: 'PatientPass123!',
                  })}
                </p>
              </form>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">{t('Clinics and hospitals')}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <MapPinIcon className="h-5 w-5 text-blue-600" />
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
                      <p className="text-xs uppercase tracking-wide text-blue-600">{facility.type === 'GPClinic' ? t('GP clinic') : t('Hospital')}</p>
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
              <StethoscopeIcon className="h-5 w-5 text-blue-600" />
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
                        <span key={`${specialist.doctorId}-${index}`} className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
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

        {session ? (
          <section className="space-y-10">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900">{t('Your care hub')}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <ReportsIcon className="h-5 w-5 text-blue-600" />
                {portalLoading ? t('Loading your information...') : t('Secure access to your latest health data.')}
              </div>
            </div>

            {portalError ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{portalError}</p>
            ) : null}

            {profile ? (
              <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-6">
                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">{profile.patient.name}</h4>
                        <p className="text-sm text-gray-500">
                          {t('DOB: {date}', { date: new Date(profile.patient.dob).toLocaleDateString() })} •{' '}
                          {profile.patient.gender === 'F' ? t('Female') : t('Male')}
                        </p>
                      </div>
                      <AvatarIcon className="h-10 w-10 text-blue-600" />
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-gray-600">
                      {profile.patient.contact ? <span>{profile.patient.contact}</span> : null}
                      {profile.patient.insurance ? (
                        <span>
                          {t('Insurance: {provider}', { provider: profile.patient.insurance })}
                        </span>
                      ) : (
                        <span>{t('Insurance: Self-pay')}</span>
                      )}
                      {profile.patient.drugAllergies ? (
                        <span className="text-red-600">
                          {t('Allergies: {allergies}', { allergies: profile.patient.drugAllergies })}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">{t('Upcoming appointments')}</h4>
                      <CalendarIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    {upcomingAppointments.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">{t('You have no upcoming visits scheduled.')}</p>
                    ) : (
                      <ul className="mt-4 space-y-3 text-sm text-gray-600">
                        {upcomingAppointments.map((item: any) => (
                          <li key={item.appointmentId} className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
                            <div className="font-semibold text-blue-700">
                              {new Date(item.date).toLocaleDateString()} • {formatMinutes(item.startTimeMin)}
                            </div>
                            <div>{item.doctor.name}</div>
                            <div className="text-xs text-blue-600">
                              {item.department} • {item.location ?? t('Clinic visit')}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">{t('Book a new appointment')}</h4>
                      <StethoscopeIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    <form onSubmit={handleAppointmentSubmit} className="mt-4 space-y-4 text-sm">
                      <div>
                        <label htmlFor="doctorId" className="text-sm font-medium text-gray-700">
                          {t('Choose a doctor')}
                        </label>
                        <select
                          id="doctorId"
                          name="doctorId"
                          value={appointmentForm.doctorId}
                          onChange={handleAppointmentChange}
                          required
                          className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                          {specialists.map((specialist) => (
                            <option key={specialist.doctorId} value={specialist.doctorId}>
                              {specialist.name} • {specialist.department}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="date" className="text-sm font-medium text-gray-700">
                            {t('Preferred date')}
                          </label>
                          <input
                            id="date"
                            name="date"
                            type="date"
                            value={appointmentForm.date}
                            onChange={handleAppointmentChange}
                            required
                            className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                        <div>
                          <label htmlFor="time" className="text-sm font-medium text-gray-700">
                            {t('Preferred time')}
                          </label>
                          <input
                            id="time"
                            name="time"
                            type="time"
                            value={appointmentForm.time}
                            onChange={handleAppointmentChange}
                            required
                            className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="reason" className="text-sm font-medium text-gray-700">
                          {t('Visit reason')}
                        </label>
                        <textarea
                          id="reason"
                          name="reason"
                          value={appointmentForm.reason}
                          onChange={handleAppointmentChange}
                          rows={3}
                          className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          placeholder={t('E.g. Annual physical, lab review, medication refill')}
                        />
                      </div>
                      {appointmentError ? <p className="text-sm text-red-600">{appointmentError}</p> : null}
                      {appointmentStatus === 'success' ? (
                        <p className="text-sm text-green-600">{t('Appointment request received! We will confirm shortly.')}</p>
                      ) : null}
                      <button
                        type="submit"
                        disabled={appointmentStatus === 'loading'}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                      >
                        <CalendarIcon className="h-5 w-5" />
                        {appointmentStatus === 'loading' ? t('Scheduling...') : t('Schedule appointment')}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="space-y-6">
                  {invoiceSummary ? (
                    <div className="rounded-3xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-900 shadow-sm">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-semibold text-blue-900">{t('Billing summary')}</h4>
                        <WalletIcon className="h-5 w-5 text-blue-700" />
                      </div>
                      <div className="mt-4 grid gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-blue-500">{t('Outstanding balance')}</div>
                          <div className="text-lg font-semibold">{formatCurrency(invoiceSummary.outstanding)}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="text-blue-500">{t('Total paid')}</div>
                            <div className="text-base font-semibold text-blue-900">
                              {formatCurrency(invoiceSummary.paidTotal)}
                            </div>
                          </div>
                          <div>
                            <div className="text-blue-500">{t('Lifetime visits')}</div>
                            <div className="text-base font-semibold text-blue-900">
                              {formatCurrency(invoiceSummary.lifetimeValue)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">{t('Recent lab results')}</h4>
                      <ReportsIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    {labs.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">{t('No lab results available yet.')}</p>
                    ) : (
                      <ul className="mt-4 space-y-3 text-sm text-gray-600">
                        {labs.slice(0, 5).map((result) => (
                          <li key={result.labResultId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="font-semibold text-gray-800">{result.LabOrderItem.testName}</div>
                            <div className="text-xs text-gray-500">
                              {new Date(result.resultedAt).toLocaleDateString()} • {result.resultValue ?? result.resultValueNum}
                              {result.unit ? ` ${result.unit}` : ''}
                            </div>
                            {result.abnormalFlag ? (
                              <div className="mt-1 text-xs font-semibold text-orange-600">
                                {t('Flagged: {flag}', { flag: result.abnormalFlag })}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">{t('Immunisations')}</h4>
                      <VaccineIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    {immunizations.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">{t('No immunisation records yet.')}</p>
                    ) : (
                      <ul className="mt-4 space-y-3 text-sm text-gray-600">
                        {immunizations.map((entry) => (
                          <li key={entry.immunizationId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="font-semibold text-gray-800">{entry.vaccineName}</div>
                            <div className="text-xs text-gray-500">
                              {t('Administered {date}', { date: new Date(entry.administeredAt).toLocaleDateString() })}
                            </div>
                            {entry.nextDueDate ? (
                              <div className="text-xs text-blue-600">
                                {t('Next due {date}', { date: new Date(entry.nextDueDate).toLocaleDateString() })}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">{t('Radiology reports')}</h4>
                      <RadiologyIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    {radiologyReports.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">{t('No radiology reports available.')}</p>
                    ) : (
                      <ul className="mt-4 space-y-3 text-sm text-gray-600">
                        {radiologyReports.map((report) => (
                          <li key={report.reportId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="font-semibold text-gray-800">{report.modality}</div>
                            <div className="text-xs text-gray-500">
                              {t('Performed {date}', { date: new Date(report.performedAt).toLocaleDateString() })} •{' '}
                              {report.visit?.doctor?.name}
                            </div>
                            <p className="mt-2 text-xs text-gray-600 line-clamp-3">{report.reportText}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-gray-900">{t('Recent payments')}</h4>
                      <WalletIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    {payments.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">{t('No payments recorded yet.')}</p>
                    ) : (
                      <ul className="mt-4 space-y-3 text-sm text-gray-600">
                        {payments.map((invoice: any) => (
                          <li key={invoice.invoiceId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-semibold text-gray-800">{invoice.invoiceNo}</div>
                                <div className="text-xs text-gray-500">
                                  {t('Status: {status}', { status: invoice.status })}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-gray-800">{formatCurrency(invoice.amountDue)}</div>
                                <div className="text-xs text-gray-500">{t('Balance due')}</div>
                              </div>
                            </div>
                            {invoice.payments.length > 0 ? (
                              <div className="mt-2 space-y-1 text-xs text-gray-500">
                                {invoice.payments.map((payment: any) => (
                                  <div key={payment.paymentId} className="flex items-center justify-between">
                                    <span>
                                      {new Date(payment.paidAt).toLocaleDateString()} • {payment.method}
                                    </span>
                                    <span>{formatCurrency(payment.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {pastAppointments.length > 0 ? (
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <h4 className="text-lg font-semibold text-gray-900">{t('Previous appointments')}</h4>
                <ul className="mt-4 grid gap-3 text-sm text-gray-600 md:grid-cols-2">
                  {pastAppointments.slice(0, 4).map((item: any) => (
                    <li key={item.appointmentId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="font-semibold text-gray-800">
                        {new Date(item.date).toLocaleDateString()} • {item.doctor.name}
                      </div>
                      <div className="text-xs text-gray-500">{item.department}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
