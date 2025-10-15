import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarIcon,
  CheckIcon,
  AvatarIcon,
  ReportsIcon,
  PatientsIcon,
  PharmacyIcon,
  DashboardIcon,
  CloseIcon,
} from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';
import {
  createPatientAppointment,
  fetchImmunizations,
  fetchLabResults,
  fetchPatientAppointments,
  fetchPatientProfile,
  fetchPayments,
  fetchRadiologyReports,
  fetchSpecialists,
  fetchMedications,
  loginPatient,
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

interface PaymentReceiptModalProps {
  invoice: any;
  patient: any | null;
  onClose: () => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
  displayName: string;
  logo?: string | null;
  formatCurrency: (amount: number) => string;
}

type ToastState = {
  type: 'success' | 'error';
  title: string;
  message: string;
};

function PaymentReceiptModal({ invoice, patient, onClose, t, displayName, logo, formatCurrency }: PaymentReceiptModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const payments = invoice.payments ?? [];
  const lineItems = invoice.lineItems ?? [];
  const invoiceDate = new Date(invoice.createdAt).toLocaleDateString();
  const totalPaid = payments.reduce((sum: number, payment: any) => sum + (payment.amount ?? 0), 0);
  const amountDue = invoice.amountDue ?? invoice.total ?? 0;
  const amountPaid = invoice.amountPaid ?? totalPaid;
  const balanceDue = invoice.balanceDue ?? Math.max(amountDue - amountPaid, 0);
  const invoiceNumber = invoice.invoiceNo ?? invoice.invoiceId;
  const patientGenderLabel =
    patient && typeof patient.gender === 'string'
      ? patient.gender === 'F'
        ? t('Female')
        : patient.gender === 'M'
          ? t('Male')
          : patient.gender
      : null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
          >
            {t('Print receipt')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
          >
            <CloseIcon className="h-4 w-4" />
            <span className="sr-only">{t('Close')}</span>
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {logo ? (
                <img src={logo} alt={`${displayName} logo`} className="h-10 w-auto rounded" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                  <DashboardIcon className="h-6 w-6" />
                </div>
              )}
              <div>
                <p className="text-lg font-semibold text-slate-900">{displayName}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">{t('Payment receipt')}</p>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>{t('Invoice #{number}', { number: invoiceNumber })}</div>
              <div>{invoiceDate}</div>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 text-sm text-slate-600">
          {patient ? (
            <div className="grid gap-1 text-sm text-slate-600">
              <p className="text-base font-semibold text-slate-900">{patient.name}</p>
              <p>{t('Patient ID: {id}', { id: patient.patientId })}</p>
              <p>
                {t('DOB: {date}', { date: new Date(patient.dob).toLocaleDateString() })}
                {patientGenderLabel ? ` • ${patientGenderLabel}` : ''}
              </p>
              {patient.contact ? <p>{patient.contact}</p> : null}
              {patient.insurance ? (
                <p>{t('Insurance: {provider}', { provider: patient.insurance })}</p>
              ) : (
                <p>{t('Insurance: Self-pay')}</p>
              )}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t('Invoice status')}</span>
              <span className="font-semibold text-slate-900">{invoice.status ?? t('Issued')}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t('Total amount')}</span>
              <span className="font-semibold text-slate-900">{formatCurrency(amountDue)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t('Amount paid')}</span>
              <span className="font-semibold text-emerald-600">{formatCurrency(amountPaid)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t('Balance due')}</span>
              <span className="font-semibold text-rose-600">{formatCurrency(balanceDue)}</span>
            </div>
          </div>

          {lineItems.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-900">{t('Services')}</h3>
              <ul className="mt-3 space-y-2">
                {lineItems.map((item: any) => (
                  <li key={item.lineItemId ?? item.description ?? item.serviceName} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-900">{item.description ?? item.serviceName}</p>
                      {item.notes ? <p className="text-xs text-slate-500">{item.notes}</p> : null}
                    </div>
                    <div className="text-right text-sm font-semibold text-slate-900">{formatCurrency(item.amount ?? 0)}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">{t('Payments applied')}</h3>
            {payments.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {payments.map((payment: any) => (
                  <li key={payment.paymentId} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-900">{formatCurrency(payment.amount ?? 0)}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(payment.paidAt).toLocaleDateString()} • {payment.method ?? t('Payment')}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {payment.reference ?? payment.referenceNo ?? payment.note ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">{t('No payments have been recorded for this invoice yet.')}</p>
            )}
          </div>

          {invoice.notes ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              <p className="font-semibold text-amber-800">{t('Notes')}</p>
              <p>{invoice.notes}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
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

function calculateAge(dob?: string | null) {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

const defaultLoginForm: LoginForm = { email: 'patient@example.com', password: '' };
const defaultAppointmentForm: AppointmentForm = { doctorId: '', date: '', time: '', reason: '' };

export default function PatientPortal() {
  const { appName, logo } = useSettings();
  const { t } = useTranslation();

  const [specialists, setSpecialists] = useState<SpecialistResponse[]>([]);
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
  const [medications, setMedications] = useState<any[]>([]);
  const [portalLoading, setPortalLoading] = useState(false);

  const [appointmentForm, setAppointmentForm] = useState<AppointmentForm>(defaultAppointmentForm);
  const [appointmentStatus, setAppointmentStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [appointmentError, setAppointmentError] = useState<string | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<any | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((nextToast: ToastState) => {
    setToast(nextToast);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const handle = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    fetchSpecialists()
      .then((data) => {
        setSpecialists(data);
        if (data.length > 0) {
          setAppointmentForm((previous) => ({ ...previous, doctorId: data[0].doctorId }));
        }
      })
      .catch((error: Error) => {
        const fallback = t('Unable to load specialists');
        const message = error.message || fallback;
        setSpecialistsError(message);
        showToast({ type: 'error', title: fallback, message });
      });
  }, [showToast, t]);

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
      setSession({ token: response.accessToken, patientId: response.patient?.patientId!, email: loginForm.email.trim() });
      setLoginStatus('success');
    } catch (error) {
      setLoginStatus('idle');
      const message = error instanceof Error ? error.message : t('Unable to sign in. Please try again.');
      setLoginError(message);
      showToast({ type: 'error', title: t('Sign-in failed'), message });
    }
  };

  const loadPortalData = async (activeSession: PortalSession) => {
    setPortalLoading(true);
    try {
      const [
        profileData,
        appointmentData,
        labData,
        immunizationData,
        radiologyData,
        paymentData,
        medicationData,
      ] = await Promise.all([
        fetchPatientProfile(activeSession.token, activeSession.patientId),
        fetchPatientAppointments(activeSession.token, activeSession.patientId),
        fetchLabResults(activeSession.token, activeSession.patientId),
        fetchImmunizations(activeSession.token, activeSession.patientId),
        fetchRadiologyReports(activeSession.token, activeSession.patientId),
        fetchPayments(activeSession.token, activeSession.patientId),
        fetchMedications(activeSession.token, activeSession.patientId),
      ]);

      setProfile(profileData);
      setAppointments(appointmentData);
      setLabs(labData);
      setImmunizations(immunizationData);
      setRadiologyReports(radiologyData);
      setPayments(paymentData);
      setMedications(medicationData);
      setPortalLoading(false);
      setAppointmentStatus('idle');
    } catch (error) {
      setPortalLoading(false);
      const message = error instanceof Error ? error.message : t('Unable to load patient data.');
      showToast({ type: 'error', title: t('Portal data unavailable'), message });
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
        patientId: session.patientId,
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
      const message = error instanceof Error ? error.message : t('Unable to schedule appointment.');
      setAppointmentError(message);
      showToast({ type: 'error', title: t('Appointment request failed'), message });
    }
  };

  const handleLogout = () => {
    setSession(null);
    setLoginForm(defaultLoginForm);
    setLoginError(null);
    setLoginStatus('idle');
    setPortalLoading(false);
    setProfile(null);
    setAppointments(null);
    setLabs([]);
    setImmunizations([]);
    setRadiologyReports([]);
    setPayments([]);
    setMedications([]);
    setAppointmentForm(defaultAppointmentForm);
    setAppointmentStatus('idle');
    setReceiptInvoice(null);
  };

  const invoiceSummary = profile?.invoiceSummary;
  const upcomingAppointments = appointments?.upcoming ?? [];
  const pastAppointments = appointments?.past ?? [];
  const recentVisits = profile?.recentVisits ?? [];
  const latestImmunization = profile?.latestImmunization ?? null;
  const patientDetails = profile?.patient;
  const nextAppointment = upcomingAppointments[0] ?? null;
  const lastVisit = recentVisits[0] ?? null;
  const patientAge = calculateAge(patientDetails?.dob ?? null);
  const genderLabel =
    patientDetails && typeof patientDetails.gender === 'string'
      ? patientDetails.gender === 'F'
        ? t('Female')
        : patientDetails.gender === 'M'
          ? t('Male')
          : patientDetails.gender
      : t('Not recorded');

  const profileCards = patientDetails
    ? [
        {
          label: t('Date of birth'),
          value: patientDetails.dob ? new Date(patientDetails.dob).toLocaleDateString() : t('Not recorded'),
        },
        {
          label: t('Age'),
          value: patientAge !== null ? t('{count} years old', { count: patientAge }) : t('Not recorded'),
        },
        {
          label: t('Gender'),
          value: genderLabel,
        },
        {
          label: t('Primary contact'),
          value: patientDetails.contact?.trim() || t('Not available'),
        },
        {
          label: t('Insurance'),
          value: patientDetails.insurance?.trim() || t('Self-pay'),
        },
        {
          label: t('Drug allergies'),
          value: patientDetails.drugAllergies?.trim() || t('None reported'),
        },
      ]
    : [];

  const quickLinks = [
    { label: t('Profile'), href: '#profile' },
    { label: t('Appointments'), href: '#appointments' },
    { label: t('Labs'), href: '#labs' },
    { label: t('Medications'), href: '#medications' },
    { label: t('Immunisations'), href: '#immunisations' },
    { label: t('Radiology'), href: '#radiology' },
    { label: t('Payments'), href: '#payments' },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      {toast && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50">
          <div className="pointer-events-auto flex w-80 items-start gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-black/5">
            <span
              className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${toast.type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'}`}
              aria-hidden="true"
            />
            <div className="flex-1 text-sm">
              <div className="font-semibold text-slate-900">{toast.title}</div>
              <p className="mt-1 text-slate-600">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="-mr-2 rounded-full p-1 text-slate-400 transition hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span className="sr-only">{t('Dismiss')}</span>×
            </button>
          </div>
        </div>
      )}

      <header className="border-b border-slate-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt={`${displayName} logo`} className="h-10 w-auto rounded" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                <DashboardIcon className="h-6 w-6" />
              </div>
            )}
            <div>
              <p className="text-xl font-semibold text-blue-700">{displayName}</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">{t('Patient portal')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/patient-portal"
              className="rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
            >
              {t('Portal home')}
            </Link>
            <Link
              to="/login"
              className="rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
            >
              {t('Return to staff login')}
            </Link>
            {session ? (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
              >
                {t('Sign out')}
              </button>
            ) : null}
          </div>
        </div>
        {session ? (
          <nav className="mx-auto hidden w-full max-w-6xl flex-wrap items-center gap-2 px-6 pb-4 md:flex">
            {quickLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-full border border-blue-100 bg-white px-4 py-1.5 text-sm font-medium text-blue-700 transition hover:border-blue-200 hover:bg-blue-50"
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-10">
        {session ? (
          <>
            <section className="rounded-3xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 p-[1px] shadow-xl">
              <div className="rounded-[calc(theme(borderRadius.3xl)-4px)] bg-white/95 p-8">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">{t('Secure session')}</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">{t('Welcome back')}</h2>
                    <p className="mt-2 text-sm text-slate-600">{t('Signed in as {email}', { email: session.email })}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {t('Review your care history, request appointments, and download receipts.')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
                    >
                      {t('Sign out')}
                    </button>
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                      <CheckIcon className="h-5 w-5" />
                      {portalLoading ? t('Syncing data...') : t('Portal connected')}
                    </span>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">{t('Upcoming visits')}</div>
                    <div className="mt-2 text-2xl font-semibold text-blue-900">{upcomingAppointments.length}</div>
                    <p className="text-xs text-blue-700">{t('Scheduled visits ready to check in')}</p>
                  </div>
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{t('Lab results')}</div>
                    <div className="mt-2 text-2xl font-semibold text-indigo-900">{labs.length}</div>
                    <p className="text-xs text-indigo-700">{t('Recent results securely shared')}</p>
                  </div>
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-rose-600">{t('Outstanding balance')}</div>
                    <div className="mt-2 text-2xl font-semibold text-rose-900">{formatCurrency(invoiceSummary?.outstanding ?? 0)}</div>
                    <p className="text-xs text-rose-700">{t('Track payments and receipts below')}</p>
                  </div>
                </div>
              </div>
            </section>

            <div className="mt-10 grid gap-8 xl:grid-cols-[320px_1fr]">
              <aside className="space-y-6">
                {patientDetails ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{patientDetails.name}</h3>
                        <p className="text-sm text-slate-500">
                          {t('DOB: {date}', { date: new Date(patientDetails.dob).toLocaleDateString() })} •{' '}
                          {patientDetails.gender === 'F' ? t('Female') : t('Male')}
                        </p>
                      </div>
                      <AvatarIcon className="h-10 w-10 text-blue-600" />
                    </div>
                    <dl className="mt-4 space-y-3 text-sm text-slate-600">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-500">{t('Patient ID')}</dt>
                        <dd className="font-medium text-slate-900">{patientDetails.patientId}</dd>
                      </div>
                      {patientDetails.contact ? (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">{t('Contact')}</dt>
                          <dd className="font-medium text-slate-900">{patientDetails.contact}</dd>
                        </div>
                      ) : (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-slate-500">{t('Contact')}</dt>
                          <dd className="font-medium text-slate-900">{t('Not available')}</dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-500">{t('Insurance')}</dt>
                        <dd className="font-medium text-slate-900">{patientDetails.insurance ?? t('Self-pay')}</dd>
                      </div>
                      {patientDetails.drugAllergies ? (
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-rose-500">{t('Allergies')}</dt>
                          <dd className="font-medium text-rose-600">{patientDetails.drugAllergies}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </section>
                ) : null}

                <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:hidden">
                  <h3 className="text-sm font-semibold text-slate-900">{t('Quick sections')}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {quickLinks.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:border-blue-200 hover:bg-blue-100"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </section>

                {latestImmunization ? (
                  <section className="rounded-3xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-900 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-blue-900">{t('Latest immunisation')}</h3>
                      <PharmacyIcon className="h-5 w-5 text-blue-700" />
                    </div>
                    <p className="mt-3 text-base font-semibold">{latestImmunization.vaccineName}</p>
                    <p className="text-xs text-blue-800">
                      {t('Administered {date}', { date: new Date(latestImmunization.administeredAt).toLocaleDateString() })}
                    </p>
                    {latestImmunization.provider ? (
                      <p className="text-xs text-blue-700">{latestImmunization.provider}</p>
                    ) : null}
                  </section>
                ) : null}

                {invoiceSummary ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-900">{t('Billing summary')}</h3>
                      <PharmacyIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="mt-4 grid gap-4 text-sm text-slate-600">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">{t('Outstanding')}</div>
                        <div className="text-lg font-semibold text-slate-900">{formatCurrency(invoiceSummary.outstanding)}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">{t('Total paid')}</div>
                          <div className="text-base font-semibold text-emerald-600">{formatCurrency(invoiceSummary.paidTotal)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">{t('Lifetime value')}</div>
                          <div className="text-base font-semibold text-slate-900">{formatCurrency(invoiceSummary.lifetimeValue)}</div>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {recentVisits.length > 0 ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">{t('Recent visits')}</h3>
                    <ul className="mt-4 space-y-3 text-sm text-slate-600">
                      {recentVisits.map((visit: any) => (
                        <li key={visit.visitId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="font-semibold text-slate-900">
                            {new Date(visit.visitDate).toLocaleDateString()} • {visit.doctor?.name ?? ''}
                          </div>
                          <div className="text-xs text-slate-500">{visit.department}</div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>

              <div className="space-y-8">
                {patientDetails ? (
                  <section id="profile" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-6">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">{t('Patient profile')}</div>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">{patientDetails.name}</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          {t('Review demographic information, care milestones, and upcoming activity in one place.')}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                        <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">{t('Patient ID')}</div>
                        <div className="mt-1 text-base font-semibold text-blue-900">{patientDetails.patientId}</div>
                      </div>
                    </div>

                    {profileCards.length > 0 ? (
                      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {profileCards.map((card) => (
                          <div key={card.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</div>
                            <div className="mt-2 text-base font-semibold text-slate-900">{card.value}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {(nextAppointment || lastVisit || latestImmunization) && (
                      <div className="mt-6 grid gap-4 md:grid-cols-2">
                        {nextAppointment ? (
                          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                            <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">{t('Next appointment')}</div>
                            <div className="mt-2 text-base font-semibold text-blue-900">
                              {new Date(nextAppointment.date).toLocaleDateString()} • {nextAppointment.doctor?.name}
                            </div>
                            <p className="mt-1 text-xs text-blue-700">
                              {(nextAppointment.department as string | undefined) ?? t('Department pending')} • {formatMinutes(nextAppointment.startTimeMin)}
                            </p>
                          </div>
                        ) : null}

                        {lastVisit ? (
                          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-500">{t('Most recent visit')}</div>
                            <div className="mt-2 text-base font-semibold text-emerald-900">
                              {new Date(lastVisit.visitDate).toLocaleDateString()} • {lastVisit.doctor?.name ?? ''}
                            </div>
                            <p className="mt-1 text-xs text-emerald-700">{lastVisit.department ?? t('Department pending')}</p>
                          </div>
                        ) : null}

                        {latestImmunization ? (
                          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                            <div className="text-xs font-semibold uppercase tracking-wide text-amber-500">{t('Latest immunisation')}</div>
                            <div className="mt-2 text-base font-semibold text-amber-900">{latestImmunization.vaccineName}</div>
                            <p className="mt-1 text-xs text-amber-700">
                              {t('Administered {date}', {
                                date: new Date(latestImmunization.administeredAt).toLocaleDateString(),
                              })}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </section>
                ) : null}

                <section id="appointments" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{t('Care coordination')}</h3>
                      <p className="text-sm text-slate-500">{t('Manage upcoming visits and request new appointments.')}</p>
                    </div>
                    <CalendarIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  {portalLoading ? (
                    <p className="mt-4 text-sm text-slate-500">{t('Refreshing your schedule...')}</p>
                  ) : null}
                  <div className="mt-6 grid gap-6 lg:grid-cols-2">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('Upcoming appointments')}</h4>
                      {upcomingAppointments.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">{t('You have no upcoming visits scheduled.')}</p>
                      ) : (
                        <ul className="mt-4 space-y-3 text-sm text-slate-600">
                          {upcomingAppointments.map((item: any) => (
                            <li key={item.appointmentId} className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
                              <div className="font-semibold text-blue-800">
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
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('Request a new appointment')}</h4>
                      <form onSubmit={handleAppointmentSubmit} className="mt-4 space-y-4 text-sm">
                        {specialistsError ? (
                          <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{specialistsError}</p>
                        ) : null}
                        <div>
                          <label htmlFor="doctorId" className="text-sm font-medium text-slate-700">
                            {t('Choose a doctor')}
                          </label>
                          <select
                            id="doctorId"
                            name="doctorId"
                            value={appointmentForm.doctorId}
                            onChange={handleAppointmentChange}
                            required
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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
                            <label htmlFor="date" className="text-sm font-medium text-slate-700">
                              {t('Preferred date')}
                            </label>
                            <input
                              id="date"
                              name="date"
                              type="date"
                              value={appointmentForm.date}
                              onChange={handleAppointmentChange}
                              required
                              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                          </div>
                          <div>
                            <label htmlFor="time" className="text-sm font-medium text-slate-700">
                              {t('Preferred time')}
                            </label>
                            <input
                              id="time"
                              name="time"
                              type="time"
                              value={appointmentForm.time}
                              onChange={handleAppointmentChange}
                              required
                              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor="reason" className="text-sm font-medium text-slate-700">
                            {t('Visit reason')}
                          </label>
                          <textarea
                            id="reason"
                            name="reason"
                            value={appointmentForm.reason}
                            onChange={handleAppointmentChange}
                            rows={3}
                            placeholder={t('E.g. Annual physical, lab review, medication refill')}
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                        {appointmentError ? <p className="text-sm text-rose-600">{appointmentError}</p> : null}
                        <button
                          type="submit"
                          disabled={appointmentStatus === 'loading'}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                        >
                          <CalendarIcon className="h-5 w-5" />
                          {appointmentStatus === 'loading' ? t('Scheduling...') : t('Schedule appointment')}
                        </button>
                        {appointmentStatus === 'success' ? (
                          <p className="text-sm text-emerald-600">{t('Appointment request received! We will confirm shortly.')}</p>
                        ) : null}
                      </form>
                    </div>
                  </div>
                  {pastAppointments.length > 0 ? (
                    <div className="mt-8">
                      <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('Previous appointments')}</h4>
                      <ul className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                        {pastAppointments.slice(0, 6).map((item: any) => (
                          <li key={item.appointmentId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {new Date(item.date).toLocaleDateString()} • {item.doctor.name}
                            </div>
                            <div className="text-xs text-slate-500">{item.department}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <section id="labs" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{t('Laboratory results')}</h3>
                      <p className="text-sm text-slate-500">{t('Review your latest diagnostic findings at a glance.')}</p>
                    </div>
                    <ReportsIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  {labs.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">{t('No lab results available yet.')}</p>
                  ) : (
                    <ul className="mt-5 space-y-3 text-sm text-slate-600">
                      {labs.slice(0, 8).map((result) => (
                        <li key={result.labResultId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="font-semibold text-slate-900">{result.LabOrderItem.testName}</div>
                          <div className="text-xs text-slate-500">
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
                </section>

                <section id="medications" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{t('Medication history')}</h3>
                      <p className="text-sm text-slate-500">{t('Track what has been prescribed during your visits.')}</p>
                    </div>
                    <PharmacyIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  {medications.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">{t('No medications have been recorded yet.')}</p>
                  ) : (
                    <ul className="mt-5 space-y-3 text-sm text-slate-600">
                      {medications.slice(0, 8).map((medication) => (
                        <li key={medication.medId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900">{medication.drugName}</div>
                              {medication.dosage ? <div className="text-sm text-slate-600">{medication.dosage}</div> : null}
                              {medication.instructions ? (
                                <div className="text-xs text-slate-500">{medication.instructions}</div>
                              ) : null}
                            </div>
                            {medication.visit ? (
                              <div className="text-right text-xs text-slate-500">
                                <div>{new Date(medication.visit.visitDate).toLocaleDateString()}</div>
                                <div>{medication.visit.doctor?.name ?? ''}</div>
                                <div>{medication.visit.department}</div>
                              </div>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section id="immunisations" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{t('Immunisations')}</h3>
                      <p className="text-sm text-slate-500">{t('Stay up to date with completed vaccines and boosters.')}</p>
                    </div>
                    <PharmacyIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  {immunizations.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">{t('No immunisation records yet.')}</p>
                  ) : (
                    <ul className="mt-5 space-y-3 text-sm text-slate-600">
                      {immunizations.map((entry) => (
                        <li key={entry.immunizationId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="font-semibold text-slate-900">{entry.vaccineName}</div>
                          <div className="text-xs text-slate-500">
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
                </section>

                <section id="radiology" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{t('Radiology reports')}</h3>
                      <p className="text-sm text-slate-500">{t('Images and interpretations from your diagnostic visits.')}</p>
                    </div>
                    <ReportsIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  {radiologyReports.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">{t('No radiology reports available.')}</p>
                  ) : (
                    <ul className="mt-5 space-y-3 text-sm text-slate-600">
                      {radiologyReports.map((report) => (
                        <li key={report.reportId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="font-semibold text-slate-900">{report.modality}</div>
                          <div className="text-xs text-slate-500">
                            {t('Reported {date}', { date: new Date(report.reportDate).toLocaleDateString() })}
                          </div>
                          {report.impression ? (
                            <div className="mt-1 text-xs text-slate-500">{report.impression}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section id="payments" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{t('Payments')}</h3>
                      <p className="text-sm text-slate-500">{t('Review balances, payments, and download receipts.')}</p>
                    </div>
                    <ReportsIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  {payments.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">{t('No payments recorded yet.')}</p>
                  ) : (
                    <ul className="mt-5 space-y-3 text-sm text-slate-600">
                      {payments.map((invoice: any) => {
                        const invoicePayments = invoice.payments ?? [];

                        return (
                          <li key={invoice.invoiceId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold text-slate-900">{invoice.invoiceNo}</div>
                                <div className="text-xs text-slate-500">
                                  {t('Status: {status}', { status: invoice.status })}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {t('Issued {date}', { date: new Date(invoice.createdAt).toLocaleDateString() })}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-slate-900">{formatCurrency(invoice.amountDue ?? 0)}</div>
                                <div className="text-xs text-slate-500">{t('Balance due')}</div>
                              </div>
                            </div>
                            {invoicePayments.length > 0 ? (
                              <div className="mt-3 space-y-1 text-xs text-slate-500">
                                {invoicePayments.map((payment: any) => (
                                  <div key={payment.paymentId} className="flex items-center justify-between">
                                    <span>
                                      {new Date(payment.paidAt).toLocaleDateString()} • {payment.method}
                                    </span>
                                    <span>{formatCurrency(payment.amount ?? 0)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-3 text-xs text-slate-500">{t('No payments applied yet.')}</p>
                            )}
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs text-slate-500">
                                {t('Total paid')}: {formatCurrency(invoice.amountPaid ?? 0)}
                              </div>
                              <button
                                type="button"
                                onClick={() => setReceiptInvoice(invoice)}
                                className="inline-flex items-center justify-center rounded-full border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
                              >
                                {t('View receipt')}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </div>

            {receiptInvoice ? (
              <PaymentReceiptModal
                invoice={receiptInvoice}
                patient={patientDetails ?? null}
                onClose={() => setReceiptInvoice(null)}
                t={t}
                displayName={displayName}
                logo={logo}
                formatCurrency={formatCurrency}
              />
            ) : null}
          </>
        ) : (
          <section className="mx-auto w-full max-w-3xl">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                {t('Patient portal login')}
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-slate-900">{t('Sign in to manage your care')}</h1>
              <p className="mt-2 text-sm text-slate-500">
                {t('Use the credentials shared by your clinic to access your personal records.')}
              </p>
              <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="email" className="text-sm font-medium text-slate-700">
                    {t('Email address')}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={loginForm.email}
                    onChange={handleLoginChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="text-sm font-medium text-slate-700">
                    {t('Password')}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={loginForm.password}
                    onChange={handleLoginChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                {loginError ? <p className="text-sm text-rose-600">{loginError}</p> : null}
                <button
                  type="submit"
                  disabled={loginStatus === 'loading'}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  <AvatarIcon className="h-5 w-5" />
                  {loginStatus === 'loading' ? t('Signing in...') : t('Access my records')}
                </button>
                <p className="text-xs text-slate-500">
                  {t('Tip: You can use the demo account {email} with password {password}.', {
                    email: 'patient@example.com',
                    password: 'PatientPass123!',
                  })}
                </p>
              </form>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

