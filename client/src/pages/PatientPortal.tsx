import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarIcon,
  CheckIcon,
  AvatarIcon,
  ReportsIcon,
  PharmacyIcon,
  DashboardIcon,
  CloseIcon,
  LabIcon,
} from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';
import {
  createPatientAppointment,
  fetchImmunizations,
  fetchLabResults,
  fetchPatientAppointments,
  fetchIntegrationEmbed,
  fetchPatientProfile,
  fetchPayments,
  fetchRadiologyReports,
  fetchSpecialists,
  fetchMedications,
  fetchPrescriptions,
  fetchMedicationOrders,
  createMedicationOrder,
  loginPatient,
  registerPatientPortalAccount,
  type IntegrationEmbed,
  type SpecialistResponse,
  type MedicationOrderResponse,
  type MedicationOrderStatus,
} from '../api/patientPortal';
import { loginAtenxionUser, logoutAtenxionUser, recordAtenxionTransaction } from '../api/atenxion';
import brillarLogo from '../public/brillar.avif';

interface LoginForm {
  email: string;
  password: string;
}

interface RegisterForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  dob: string;
  contact: string;
  insurance: string;
  drugAllergies: string;
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
  patientName?: string;
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

type PortalSectionId = 'overview' | 'timeline' | 'appointments' | 'medications' | 'labs' | 'billing';

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
        <div className="border-b border-slate-200 bg-slate-50 px-8 py-6">
          <div className="flex items-center justify-end gap-2 mb-4">
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
              <div className="font-semibold text-slate-700">{t('Invoice #{number}', { number: invoiceNumber })}</div>
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
const defaultRegisterForm: RegisterForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  dob: '',
  contact: '',
  insurance: '',
  drugAllergies: '',
};
const defaultAppointmentForm: AppointmentForm = { doctorId: '', date: '', time: '', reason: '' };

export default function PatientPortal() {
  const { patientId: urlPatientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();
  const { appName } = useSettings();
  const { t } = useTranslation();
  const logo = brillarLogo;

  const [specialists, setSpecialists] = useState<SpecialistResponse[]>([]);
  const [specialistsError, setSpecialistsError] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState<LoginForm>(defaultLoginForm);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [session, setSession] = useState<PortalSession | null>(() => {
    // Load session from localStorage on mount
    try {
      const stored = localStorage.getItem('patient_portal_session');
      if (stored) {
        return JSON.parse(stored) as PortalSession;
      }
    } catch {
      // Ignore errors
    }
    return null;
  });
  const lastAtenxionLoginPatientId = useRef<string | null>(null);

  const [integrationIframe, setIntegrationIframe] = useState<string>('');

  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterForm>(defaultRegisterForm);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerStatus, setRegisterStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const [profile, setProfile] = useState<any | null>(null);
  const [appointments, setAppointments] = useState<any | null>(null);
  const [labs, setLabs] = useState<any[]>([]);
  const [immunizations, setImmunizations] = useState<any[]>([]);
  const [radiologyReports, setRadiologyReports] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [medications, setMedications] = useState<any[]>([]);
  const [medicationOrders, setMedicationOrders] = useState<MedicationOrderResponse[]>([]);
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [portalLoading, setPortalLoading] = useState(false);
  const [todaysAppointment, setTodaysAppointment] = useState<any | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  const [appointmentForm, setAppointmentForm] = useState<AppointmentForm>(defaultAppointmentForm);
  const [appointmentStatus, setAppointmentStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [appointmentError, setAppointmentError] = useState<string | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<any | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeTab, setActiveTab] = useState<PortalSectionId>('overview');

  useEffect(() => {
    const loadIntegrationIframe = async () => {
      try {
        const embed = await fetchIntegrationEmbed();
        if (embed?.iframeCode) {
          let iframeHtml = embed.iframeCode;
          
          // Clean up the iframe HTML (remove line breaks and extra spaces)
          iframeHtml = iframeHtml.replace(/\s+/g, ' ').trim();
          
          // Extract URL to add patient context
          const urlMatch = iframeHtml.match(/src=["']([^"']+)["']/);
          if (urlMatch) {
            let iframeUrl = urlMatch[1];
            
            // Add patient context if user is logged in
            if (session?.patientId) {
              const separator = iframeUrl.includes('?') ? '&' : '?';
              iframeUrl = `${iframeUrl}${separator}patientId=${session.patientId}`;
              
              // Update the iframe HTML with the new URL
              iframeHtml = iframeHtml.replace(/src=["'][^"']*["']/, `src="${iframeUrl}"`);
            }
          }
          
          // Override positioning styles to work within our container
          iframeHtml = iframeHtml.replace(/style="[^"]*"/, 'style="width:100%;height:100%;border:none;border-radius:12px;"');
          
          console.log('Setting integration iframe:', iframeHtml);
          setIntegrationIframe(iframeHtml);
        } else {
          console.log('No iframe code found in embed:', embed);
        }
      } catch (error) {
        console.error('Failed to load integration widget', error);
      }
    };

    loadIntegrationIframe();
  }, [session?.patientId]);

  const tabs = useMemo(
    () => [
      {
        id: 'overview' as const,
        label: t('Overview'),
        description: t('Profile snapshot and recent activity.'),
        icon: DashboardIcon,
      },
      {
        id: 'timeline' as const,
        label: t('Timeline'),
        description: t('Visits, events, and care history.'),
        icon: ReportsIcon,
      },
      {
        id: 'appointments' as const,
        label: t('Appointments'),
        description: t('Request, review, and confirm visits.'),
        icon: CalendarIcon,
      },
      {
        id: 'medications' as const,
        label: t('Prescriptions'),
        description: t('Review prescriptions, immunisations, and pharmacy orders.'),
        icon: PharmacyIcon,
      },
      {
        id: 'labs' as const,
        label: t('Labs & imaging'),
        description: t('Test results and diagnostic reports.'),
        icon: LabIcon,
      },
      {
        id: 'billing' as const,
        label: t('Billing'),
        description: t('Invoices, receipts, and payments.'),
        icon: ReportsIcon,
      },
    ],
    [t],
  );




  const showToast = useCallback((nextToast: ToastState) => {
    setToast(nextToast);
  }, []);

  const handleMedicationOrder = useCallback(
    async (entry: any) => {
      if (!entry) return;
      if (!session) {
        showToast({
          type: 'error',
          title: t('Medication order unavailable'),
          message: t('Please sign in to submit a medication order.'),
        });
        return;
      }

      const isPrescription = typeof entry.prescriptionId === 'string' && entry.prescriptionId.length > 0;
      const summaryLines: string[] = [];
      const payload: {
        patientId: string;
        prescriptionId?: string;
        drugName?: string;
        dosage?: string;
        instructions?: string;
        quantity?: number;
      } = { patientId: session.patientId };

      if (isPrescription) {
        payload.prescriptionId = entry.prescriptionId;
        const rxCode = entry.prescriptionId ? entry.prescriptionId.slice(0, 8).toUpperCase() : '';
        if (rxCode) {
          summaryLines.push(t('Rx #{id}', { id: rxCode }));
        }
        summaryLines.push(t('Items ordered'));

        if (Array.isArray(entry.items) && entry.items.length > 0) {
          entry.items.forEach((item: any, index: number) => {
            const drugName = item.drug
              ? [item.drug.name, item.drug.strength].filter(Boolean).join(' ')
              : t('Prescription item');
            const instructionParts = [item.dose, item.route, item.frequency]
              .filter((part) => part && String(part).trim().length > 0)
              .join(' • ');
            const orderDetails = [
              `${index + 1}. ${drugName}`,
              instructionParts ? `   ${instructionParts}` : null,
              item.durationDays ? `   ${t('Duration: {days} days', { days: item.durationDays })}` : null,
              item.quantityPrescribed
                ? `   ${t('Quantity prescribed: {quantity}', { quantity: item.quantityPrescribed })}`
                : null,
              item.prn ? `   ${t('As needed')}` : null,
              item.notes ? `   ${item.notes}` : null,
            ].filter(Boolean);

            summaryLines.push(orderDetails.join('\n'));
          });
        }
      } else {
        const drugName = entry.drugName ? String(entry.drugName).trim() : '';
        if (!drugName) {
          showToast({
            type: 'error',
            title: t('Medication order unavailable'),
            message: t('Medication name is required to submit an order.'),
          });
          return;
        }
        payload.drugName = drugName;
        if (entry.dosage) payload.dosage = String(entry.dosage);
        if (entry.instructions) payload.instructions = String(entry.instructions);
        if (entry.quantity) {
          const numericQty = Number(entry.quantity);
          if (!Number.isNaN(numericQty) && numericQty > 0) {
            payload.quantity = numericQty;
          }
        }

        summaryLines.push(t('Medication order'));
        summaryLines.push(drugName);
        if (payload.dosage) {
          summaryLines.push(t('Dosage: {dosage}', { dosage: payload.dosage }));
        }
        if (payload.instructions) {
          summaryLines.push(t('Instructions: {instructions}', { instructions: payload.instructions }));
        }

        const visitDoctor = entry.visit?.doctor?.name ? String(entry.visit.doctor.name).trim() : '';
        if (visitDoctor) {
          summaryLines.push(t('Ordered by {name}', { name: visitDoctor }));
        }

        if (entry.visit?.visitDate) {
          summaryLines.push(
            t('Visit date: {date}', { date: new Date(entry.visit.visitDate).toLocaleDateString() }),
          );
        }

        if (entry.visit?.department) {
          summaryLines.push(entry.visit.department);
        }
      }

      const summary = summaryLines.join('\n').trim();

      try {
        const order = await createMedicationOrder(session.token, payload);
        setMedicationOrders((previous) => {
          const next = [order, ...previous.filter((existing) => existing.orderId !== order.orderId)];
          return next.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
        });

        const atenxionSummary = summary || undefined;
        void recordAtenxionTransaction(
          {
            userId: session.patientId,
            patientName: session.patientName || profile?.patient?.name || session.email,
          },
          {
            type: isPrescription ? 'prescription-order' : 'medication-order',
            orderId: order.orderId,
            patientId: order.patientId,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            drugName: order.drugName,
            dosage: order.dosage,
            quantity: order.quantity,
            summary: atenxionSummary,
          },
          session.token,
        ).catch((atenxionError) => {
          console.warn('Atenxion transaction logging failed', atenxionError);
        });

        let successMessage = isPrescription
          ? t('Our pharmacy team will review your prescription shortly.')
          : t('Your medication request has been sent to the pharmacy.');

        if (summary) {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(summary);
              successMessage = t(
                'Order details copied. Share with the hospital or client to arrange medication.',
              );
            }
          } catch (clipboardError) {
            console.error('Unable to copy order details', clipboardError);
          }
        }

        showToast({
          type: 'success',
          title: t('Medication order submitted'),
          message: successMessage,
        });
      } catch (error) {
        let message = t('Unable to place medication order.');
        if (error instanceof Error) {
          try {
            const parsed = JSON.parse(error.message);
            if (parsed && typeof parsed.error === 'string') {
              message = parsed.error;
            }
          } catch {
            message = error.message;
          }
        }

        showToast({
          type: 'error',
          title: t('Medication order failed'),
          message,
        });
      }
    },
    [session, setMedicationOrders, showToast, t],
  );

  useEffect(() => {
    if (!toast) return undefined;
    const handle = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  // Persist session to localStorage
  useEffect(() => {
    try {
      if (session) {
        localStorage.setItem('patient_portal_session', JSON.stringify(session));
      } else {
        localStorage.removeItem('patient_portal_session');
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [session]);

  // Ensure the URL reflects the active session
  useEffect(() => {
    if (!session) return;

    if (!urlPatientId || session.patientId !== urlPatientId) {
      navigate(`/${session.patientId}`, { replace: true });
    }
  }, [navigate, session, urlPatientId]);

  useEffect(() => {
    if (!session) {
      lastAtenxionLoginPatientId.current = null;
      return;
    }

    if (lastAtenxionLoginPatientId.current === session.patientId) {
      return;
    }

    const fallbackName = session.patientName || profile?.patient?.name || session.email;
    void loginAtenxionUser(
      {
        userId: session.patientId,
        patientName: fallbackName,
      },
      session.token,
    )
      .then(() => {
        lastAtenxionLoginPatientId.current = session.patientId;
      })
      .catch((atenxionError) => {
        console.warn('Atenxion login sync failed', atenxionError);
      });
  }, [profile?.patient?.name, session]);

  // Clear any stale session data when on login page
  useEffect(() => {
    if (!urlPatientId && !session) {
      // Clear any stale session data when on login page
      try {
        localStorage.removeItem('patient_portal_session');
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [urlPatientId, session]);

  // Redirect unauthenticated users away from patient-specific routes
  useEffect(() => {
    if (!session && urlPatientId) {
      navigate('/login', { replace: true });
    }
  }, [navigate, session, urlPatientId]);

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
      const patientId = response.patient?.patientId;
      if (!patientId) {
        throw new Error(t('Unable to determine patient ID for the session.'));
      }

      const patientName = response.patient?.name?.trim() || loginForm.email.trim();
      const nextSession: PortalSession = {
        token: response.accessToken,
        patientId,
        email: loginForm.email.trim(),
        patientName,
      };

      setSession(nextSession);
      setLoginStatus('success');

      try {
        await loginAtenxionUser(
          {
            userId: patientId,
            patientName,
          },
          response.accessToken,
        );
        lastAtenxionLoginPatientId.current = patientId;
      } catch (atenxionError) {
        console.warn('Atenxion login notification failed', atenxionError);
      }
    } catch (error) {
      setLoginStatus('idle');
      const message = error instanceof Error ? error.message : t('Unable to sign in. Please try again.');
      setLoginError(message);
      showToast({ type: 'error', title: t('Sign-in failed'), message });
    }
  };

  const handleRegisterChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setRegisterForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleRegisterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRegisterError(null);

    if (registerForm.password !== registerForm.confirmPassword) {
      setRegisterError(t('Passwords do not match'));
      return;
    }

    setRegisterStatus('loading');

    try {
      const payload = {
        name: registerForm.name.trim(),
        email: registerForm.email.trim(),
        password: registerForm.password,
        dob: registerForm.dob,
        contact: registerForm.contact.trim(),
        ...(registerForm.insurance.trim()
          ? { insurance: registerForm.insurance.trim() }
          : {}),
        ...(registerForm.drugAllergies.trim()
          ? { drugAllergies: registerForm.drugAllergies.trim() }
          : {}),
      };

      const response = await registerPatientPortalAccount(payload);

      setRegisterStatus('success');
      showToast({
        type: 'success',
        title: t('Account created successfully'),
        message: response?.message || t('You can now sign in to your patient portal account.'),
 
      });

      // Reset form and switch to login
      setTimeout(() => {
        setRegisterForm(defaultRegisterForm);
        setShowRegister(false);
        setRegisterStatus('idle');
      }, 2000);
    } catch (error) {
      setRegisterStatus('idle');
      let message = t('Unable to create account. Please try again.');
      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed && typeof parsed.error === 'string') {
            message = parsed.error;
          }
        } catch {
          message = error.message;
        }
      }
      setRegisterError(message);
      showToast({ type: 'error', title: t('Registration failed'), message });
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
        prescriptionData,
        medicationOrderData,
      ] = await Promise.all([
        fetchPatientProfile(activeSession.token, activeSession.patientId),
        fetchPatientAppointments(activeSession.token, activeSession.patientId),
        fetchLabResults(activeSession.token, activeSession.patientId),
        fetchImmunizations(activeSession.token, activeSession.patientId),
        fetchRadiologyReports(activeSession.token, activeSession.patientId),
        fetchPayments(activeSession.token, activeSession.patientId),
        fetchMedications(activeSession.token, activeSession.patientId),
        fetchPrescriptions(activeSession.token, activeSession.patientId),
        fetchMedicationOrders(activeSession.token, activeSession.patientId),
      ]);

      setProfile(profileData);
      setAppointments(appointmentData);
      setLabs(labData);
      setImmunizations(immunizationData);
      setRadiologyReports(radiologyData);
      setPayments(paymentData);
      setMedications(medicationData);
      setPrescriptions(prescriptionData);
      setMedicationOrders(medicationOrderData);

      if (!activeSession.patientName && profileData?.patient?.name) {
        setSession((previous) => {
          if (!previous || previous.patientId !== activeSession.patientId) {
            return previous;
          }

          if (previous.patientName && previous.patientName === profileData.patient?.name) {
            return previous;
          }

          return {
            ...previous,
            patientName: profileData.patient?.name ?? previous.patientName,
          };
        });
      }

      const appointmentToday = (appointmentData?.upcoming ?? []).find((appointment: any) => {
        const appointmentDate = new Date(appointment.date);
        if (Number.isNaN(appointmentDate.getTime())) {
          return false;
        }
        const now = new Date();
        return (
          appointmentDate.getFullYear() === now.getFullYear() &&
          appointmentDate.getMonth() === now.getMonth() &&
          appointmentDate.getDate() === now.getDate()
        );
      });

      if (appointmentToday) {
        setTodaysAppointment(appointmentToday);
        setReminderDismissed(false);
      } else {
        setTodaysAppointment(null);
      }
      setPortalLoading(false);
      setAppointmentStatus('idle');
    } catch (error) {
      setPortalLoading(false);
      setTodaysAppointment(null);
      setReminderDismissed(false);
      setMedicationOrders([]);
      let message = t('Unable to load patient data.');
      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed && typeof parsed.error === 'string') {
            message = parsed.error;
          }
        } catch {
          message = error.message;
        }
      }
      showToast({ type: 'error', title: t('Portal data unavailable'), message });
    }
  };

  useEffect(() => {
    if (session) {
      void loadPortalData(session);
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setActiveTab('overview');
      setMedicationOrders([]);
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
      showToast({ 
        type: 'success', 
        title: t('Appointment scheduled'), 
        message: t('Your appointment has been successfully scheduled.')
      });
      await loadPortalData(session);
    } catch (error) {
      setAppointmentStatus('idle');
      let message = t('Unable to schedule appointment.');
      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed && typeof parsed.error === 'string') {
            message = parsed.error;
          }
        } catch {
          message = error.message;
        }
      }
      setAppointmentError(message);
      showToast({ type: 'error', title: t('Appointment request failed'), message });
    }
  };

  const handleLogout = () => {
    if (session) {
      const atenxionName = session.patientName || profile?.patient?.name || session.email;
      void logoutAtenxionUser(
        {
          userId: session.patientId,
          patientName: atenxionName,
        },
        session.token,
      ).catch((atenxionError) => {
        console.warn('Atenxion logout notification failed', atenxionError);
      });
      lastAtenxionLoginPatientId.current = null;
    }
    // Clear localStorage
    try {
      localStorage.removeItem('patient_portal_session');
    } catch {
      // Ignore localStorage errors
    }
    
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
    setMedicationOrders([]);
    setAppointmentForm(defaultAppointmentForm);
    setAppointmentStatus('idle');
    setReceiptInvoice(null);
    setTodaysAppointment(null);
    setReminderDismissed(false);
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

  const clinicMapLocations = useMemo(
    () => [
      {
        id: 'building-4',
        code: '4',
        label: t('Building 4 - Outpatient pavilion'),
        description: t('Check-in, family medicine, and pharmacy pickup'),
        x: 28,
        y: 58,
      },
      {
        id: 'building-5',
        code: '5',
        label: t('Building 5 - Diagnostics hub'),
        description: t('Radiology, lab services, and imaging check-in'),
        x: 66,
        y: 32,
      },
    ],
    [t],
  );

  const latestLab = labs[0] ?? null;
  const latestRadiology = radiologyReports[0] ?? null;
  const showAppointmentReminder = todaysAppointment && !reminderDismissed;
  const reminderDoctorName = todaysAppointment?.doctor?.name?.trim() || t('your care team');
  const reminderLocation =
    todaysAppointment?.location?.trim() || todaysAppointment?.department?.trim() || t('the clinic');

  const activeContent = (() => {
    switch (activeTab) {
      case 'timeline':
        return (
          <TimelineSection
            t={t}
            nextAppointment={nextAppointment}
            lastVisit={lastVisit}
            recentVisits={recentVisits}
            formatMinutes={formatMinutes}
          />
        );
      case 'appointments':
        return (
          <AppointmentsSection
            t={t}
            portalLoading={portalLoading}
            upcomingAppointments={upcomingAppointments}
            pastAppointments={pastAppointments}
            appointmentForm={appointmentForm}
            appointmentStatus={appointmentStatus}
            appointmentError={appointmentError}
            specialists={specialists}
            specialistsError={specialistsError}
            onAppointmentChange={handleAppointmentChange}
            onAppointmentSubmit={handleAppointmentSubmit}
            formatMinutes={formatMinutes}
          />
        );
      case 'medications':
        return (
          <MedicationsSection
            t={t}
            latestImmunization={latestImmunization}
            immunizations={immunizations}
            medications={medications}
            prescriptions={prescriptions}
            orders={medicationOrders}
            onOrderMedication={handleMedicationOrder}
          />
        );
      case 'labs':
        return (
          <LabsSection
            t={t}
            labs={labs}
            medications={medications}
            immunizations={immunizations}
            radiologyReports={radiologyReports}
          />
        );
      case 'billing':
        return (
          <BillingSection
            t={t}
            invoiceSummary={invoiceSummary}
            payments={payments}
            formatCurrency={formatCurrency}
            setReceiptInvoice={setReceiptInvoice}
          />
        );
      case 'overview':
      default:
        return (
          <OverviewSection
            t={t}
            patientDetails={patientDetails ?? null}
            profileCards={profileCards}
            genderLabel={genderLabel}
            latestLab={latestLab}
            latestRadiology={latestRadiology}
            latestImmunization={latestImmunization}
            clinicMapLocations={clinicMapLocations}
          />
        );
    }
  })();

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
            {session ? (
              <button
                type="button"
                onClick={() => {
                  handleLogout();
                  navigate('/login', { replace: true });
                }}
                className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {t('Sign out')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                navigate('/');
              }}
              className="rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
            >
              {t('Portal home')}
            </button>
            <Link
              to="/admin/login"
              className="rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
            >
              {t('Return to staff login')}
            </Link>
          </div>
        </div>
        {session ? (
          <nav className="mx-auto w-full max-w-6xl px-6 pb-4 md:hidden">
            <div className="flex gap-2 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex snap-center items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                    activeTab === tab.id
                      ? 'border-blue-500 bg-blue-600 text-white shadow'
                      : 'border-blue-100 bg-white text-blue-700 hover:border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-10">

        {session ? (
          <>

            <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">{t('Secure session')}</p>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-900">{t('Your care workspace')}</h2>
                  <p className="mt-2 text-sm text-slate-500">{t('Signed in as {email}', { email: session.email })}</p>
                  <p className="mt-1 font-mono text-xs text-slate-400">
                    {t('Patient ID')}: {session.patientId}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-3 text-sm text-slate-600 sm:flex-row sm:items-center">
                  {portalLoading ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 font-semibold text-emerald-700">
                      <CheckIcon className="h-5 w-5" />
                      {t('Syncing data...')}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            {showAppointmentReminder ? (
              <section
                className="mt-6 flex flex-col gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-800 shadow-sm"
                role="status"
                aria-live="polite"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                      {t('Appointment reminder')}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-amber-900">
                      {t('You have an appointment today with {name}.', { name: reminderDoctorName })}
                    </h3>
                    <p className="mt-2 text-sm text-amber-800">
                      {t('Please arrive by {time} at {location}.', {
                        time: formatMinutes(todaysAppointment.startTimeMin ?? 0),
                        location: reminderLocation,
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReminderDismissed(true)}
                    className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
                  >
                    {t('Dismiss reminder')}
                  </button>
                </div>
              </section>
            ) : null}

            <div className="mt-10 flex flex-col gap-8 md:flex-row">
              <aside className="hidden md:block md:w-64 lg:w-72">
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Portal sections')}</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {t('Choose a category to focus on details about your care.')}
                  </p>
                  <nav className="mt-6 flex flex-col gap-2">
                    {tabs.map((tab) => (
                        <button
                        key={tab.id}
                          type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                          activeTab === tab.id
                            ? 'border-blue-500 bg-blue-600 text-white shadow-lg'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
                        }`}
                      >
                        <span
                          className={`mt-1 rounded-full p-2 ${
                            activeTab === tab.id ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600'
                          }`}
                        >
                          <tab.icon className="h-4 w-4" />
                          </span>
                        <span>
                          <span className="block text-sm font-semibold">
                            {tab.label}
                          </span>
                          <span className={`mt-1 block text-xs ${activeTab === tab.id ? 'text-blue-100' : 'text-slate-500'}`}>
                            {tab.description}
                          </span>
                          </span>
                        </button>
                      ))}
                  </nav>
                    </div>
              </aside>
              <div className="flex-1 space-y-8">{activeContent}</div>
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
          <section className="mx-auto w-full max-w-md">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                {showRegister ? t('Create account') : t('Patient portal login')}
                            </div>
              <h1 className="mt-4 text-2xl font-semibold text-slate-900">
                {showRegister ? t('Register for patient portal') : t('Sign in to manage your care')}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {showRegister 
                  ? t('Create your account to access your health records.')
                  : t('Use the credentials shared by your clinic to access your personal records.')
                }
              </p>

              {!showRegister ? (
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
                  <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                    <p className="text-xs text-slate-500">{t('Don\'t have an account?')}</p>
                    <button
                      type="button"
                      onClick={() => setShowRegister(true)}
                      className="text-sm font-semibold text-blue-600 transition hover:text-blue-700"
                    >
                      {t('Create account')}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleRegisterSubmit} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="register-name" className="text-sm font-medium text-slate-700">
                      {t('Full name')}
                    </label>
                    <input
                      id="register-name"
                      name="name"
                      type="text"
                      value={registerForm.name}
                      onChange={handleRegisterChange}
                      required
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    </div>
                    <div>
                    <label htmlFor="register-email" className="text-sm font-medium text-slate-700">
                      {t('Email address')}
                          </label>
                    <input
                      id="register-email"
                      name="email"
                      type="email"
                      value={registerForm.email}
                      onChange={handleRegisterChange}
                            required
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                      <label htmlFor="register-dob" className="text-sm font-medium text-slate-700">
                        {t('Date of birth')}
                            </label>
                            <input
                        id="register-dob"
                        name="dob"
                              type="date"
                        value={registerForm.dob}
                        onChange={handleRegisterChange}
                              required
                              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                          </div>
                          <div>
                      <label htmlFor="register-contact" className="text-sm font-medium text-slate-700">
                        {t('Contact number')}
                            </label>
                            <input
                        id="register-contact"
                        name="contact"
                        type="tel"
                        value={registerForm.contact}
                        onChange={handleRegisterChange}
                              required
                              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                          </div>
                        </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                      <label htmlFor="register-insurance" className="text-sm font-medium text-slate-700">
                        {t('Insurance provider (optional)')}
                          </label>
                      <input
                        id="register-insurance"
                        name="insurance"
                        type="text"
                        value={registerForm.insurance}
                        onChange={handleRegisterChange}
                        placeholder={t('Self-pay')}
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          />
                        </div>
                    <div>
                      <label htmlFor="register-drugAllergies" className="text-sm font-medium text-slate-700">
                        {t('Drug allergies (optional)')}
                      </label>
                      <input
                        id="register-drugAllergies"
                        name="drugAllergies"
                        type="text"
                        value={registerForm.drugAllergies}
                        onChange={handleRegisterChange}
                        placeholder={t('None')}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
            </div>
              </div>
                <div>
                    <label htmlFor="register-password" className="text-sm font-medium text-slate-700">
                      {t('Password')}
                  </label>
                  <input
                      id="register-password"
                      name="password"
                      type="password"
                      value={registerForm.password}
                      onChange={handleRegisterChange}
                    required
                      minLength={8}
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div>
                    <label htmlFor="register-confirmPassword" className="text-sm font-medium text-slate-700">
                      {t('Confirm password')}
                  </label>
                  <input
                      id="register-confirmPassword"
                      name="confirmPassword"
                    type="password"
                      value={registerForm.confirmPassword}
                      onChange={handleRegisterChange}
                    required
                      minLength={8}
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                  {registerError ? <p className="text-sm text-rose-600">{registerError}</p> : null}
                  {registerStatus === 'success' ? (
                    <p className="text-sm text-emerald-600">{t('Account created! You can sign in now.')}</p>
                  ) : null}
                <button
                  type="submit"
                    disabled={registerStatus === 'loading' || registerStatus === 'success'}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  <AvatarIcon className="h-5 w-5" />
                    {registerStatus === 'loading' ? t('Creating account...') : t('Create account')}
                </button>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                    <p className="text-xs text-slate-500">{t('Already have an account?')}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowRegister(false);
                        setRegisterError(null);
                      }}
                      className="text-sm font-semibold text-blue-600 transition hover:text-blue-700"
                    >
                      {t('Sign in')}
                    </button>
                  </div>
              </form>
              )}
            </div>
          </section>
        )}
      </main>
      
      {/* Fixed positioned widget in bottom-right corner */}
      {integrationIframe && (
        <div 
          className="fixed bottom-4 right-4 z-50"
          dangerouslySetInnerHTML={{ __html: integrationIframe }}
        />
      )}
    </div>
  );
}




function OverviewSection({
  t,
  patientDetails,
  profileCards,
  genderLabel,
  latestLab,
  latestRadiology,
  latestImmunization,
  clinicMapLocations,
}: any) {
  return (
    <div className="space-y-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Current patient')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              {patientDetails?.name ?? t('Patient profile pending')}
            </h2>
            {patientDetails?.patientId && (
              <p className="mt-1 text-xs font-medium text-blue-600">
                {t('ID: {id}', { id: patientDetails.patientId })}
              </p>
            )}
          <p className="mt-2 text-sm text-slate-500">
              {patientDetails
                ? t('DOB {dob} • {gender}', {
                    dob: patientDetails.dob
                      ? new Date(patientDetails.dob).toLocaleDateString()
                      : t('Not recorded'),
                    gender: genderLabel,
                  })
                : t('Link your chart to see demographics and alerts.')}
            </p>
                  </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
            <AvatarIcon className="h-7 w-7 text-blue-600" />
                  </div>
        </div>
        {profileCards.length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {profileCards.slice(0, 4).map((card: any) => (
              <div key={card.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{card.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {latestImmunization ? (
          <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-500">{t('Latest immunisation')}</div>
            <div className="mt-2 text-base font-semibold text-amber-900">{latestImmunization.vaccineName}</div>
            <p className="mt-1 text-xs">
              {t('Administered {date}', { date: new Date(latestImmunization.administeredAt).toLocaleDateString() })}
            </p>
            {latestImmunization.provider ? (
              <p className="mt-1 text-xs">{latestImmunization.provider}</p>
            ) : null}
          </div>
        ) : null}
        </section>
      {latestLab || latestRadiology ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">{t('Latest updates')}</h3>
          <div className="mt-4 space-y-4 text-sm text-slate-600">
            {latestLab ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{t('Lab result')}</div>
                <div className="mt-1 text-base font-semibold text-indigo-900">{latestLab.LabOrderItem.testName}</div>
                <div className="text-xs text-indigo-700">
                  {new Date(latestLab.resultedAt).toLocaleDateString()} • {latestLab.resultValue ?? latestLab.resultValueNum}
                  {latestLab.unit ? ` ${latestLab.unit}` : ''}
                </div>
              </div>
            ) : null}
            {latestRadiology ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">{t('Imaging')}</div>
                <div className="mt-1 text-base font-semibold text-emerald-900">{latestRadiology.studyType}</div>
                <div className="text-xs text-emerald-700">
                  {new Date(latestRadiology.performedAt).toLocaleDateString()} • {latestRadiology.location ?? t('On site')}
                </div>
                {latestRadiology.impression ? (
                  <p className="mt-1 text-xs text-emerald-700">{latestRadiology.impression}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{t('Clinic map')}</h3>
            <DashboardIcon className="h-5 w-5 text-blue-600" />
          </div>
          <p className="mt-2 text-sm text-slate-500">{t('Preview arrival points before your visit.')}</p>
          <div className="mt-4 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-slate-50 to-emerald-50 p-4">
            <div className="relative h-44 w-full overflow-hidden rounded-xl bg-white shadow-inner">
              <div
                className="absolute inset-0 opacity-80"
                style={{
                  background:
                    'radial-gradient(circle at 20% 25%, rgba(37, 99, 235, 0.15), transparent 55%), radial-gradient(circle at 70% 40%, rgba(16, 185, 129, 0.15), transparent 60%), linear-gradient(135deg, rgba(14, 116, 144, 0.08), transparent)',
                }}
              />
              <div className="absolute inset-5 grid grid-cols-4 grid-rows-4 gap-3 opacity-60">
                {Array.from({ length: 16 }).map((_, index) => (
                  <div key={index} className="rounded-xl border border-slate-100 bg-slate-50" />
                ))}
              </div>
            {clinicMapLocations.map((location: any) => (
                <button
                  key={location.id}
                  type="button"
                  className="group absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
                  style={{ left: `${location.x}%`, top: `${location.y}%` }}
                  aria-label={location.label}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white shadow-lg ring-4 ring-white/80">
                    {location.code}
                  </span>
                  <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-36 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-lg group-hover:block group-focus-visible:block">
                    <span className="block font-semibold text-slate-900">{location.label}</span>
                    <span className="mt-1 block text-slate-500">{location.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
          {clinicMapLocations.map((location: any) => (
              <li key={location.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">{location.label}</div>
                <p className="mt-1 text-xs text-slate-500">{location.description}</p>
              </li>
            ))}
          </ul>
        </section>
            </div>
  );
}

function TimelineSection({ t, nextAppointment, lastVisit, recentVisits, formatMinutes }: any) {
  return (
      <div className="space-y-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{t('Care timeline')}</h3>
            <ReportsIcon className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {nextAppointment ? (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">{t('Next appointment')}</div>
                <div className="mt-2 text-base font-semibold text-blue-900">
                  {new Date(nextAppointment.date).toLocaleDateString()} • {nextAppointment.doctor?.name ?? ''}
                </div>
                <p className="mt-1 text-xs text-blue-700">
                  {(nextAppointment.department as string | undefined) ?? t('Department pending')} • {formatMinutes(nextAppointment.startTimeMin)}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                {t('No upcoming appointments have been scheduled yet.')}
              </div>
            )}

            {lastVisit ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-500">{t('Most recent visit')}</div>
                <div className="mt-2 text-base font-semibold text-emerald-900">
                  {new Date(lastVisit.visitDate).toLocaleDateString()} • {lastVisit.doctor?.name ?? ''}
                </div>
                <p className="mt-1 text-xs text-emerald-700">{lastVisit.department ?? t('Department pending')}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                {t('Past visits will appear here once recorded.')}
              </div>
            )}
          </div>
        </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t('Recent visits')}</h3>
          <CalendarIcon className="h-5 w-5 text-blue-600" />
        </div>
        {recentVisits.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No past visits recorded yet.')}</p>
        ) : (
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
        )}
      </section>
    </div>
  );
}

function AppointmentsSection({
  t,
  portalLoading,
  upcomingAppointments,
  pastAppointments,
  appointmentForm,
  appointmentStatus,
  appointmentError,
  specialists,
  specialistsError,
  onAppointmentChange,
  onAppointmentSubmit,
  formatMinutes,
}: any) {
  return (
    <div className="space-y-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t('Manage appointments')}</h3>
              <p className="text-sm text-slate-500">{t('Request new visits or review confirmed times.')}</p>
            </div>
            <CalendarIcon className="h-6 w-6 text-blue-600" />
          </div>
        {portalLoading ? <p className="mt-4 text-sm text-slate-500">{t('Refreshing your schedule...')}</p> : null}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <form onSubmit={onAppointmentSubmit} className="space-y-4 text-sm">
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
                  onChange={onAppointmentChange}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                required
              >
                {specialists.map((doctor: any) => (
                  <option key={doctor.doctorId} value={doctor.doctorId}>
                    {doctor.name} • {doctor.department}
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
                    onChange={onAppointmentChange}
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
                    onChange={onAppointmentChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="reason" className="text-sm font-medium text-slate-700">
                {t('Reason for visit')}
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  value={appointmentForm.reason}
                  onChange={onAppointmentChange}
                  rows={3}
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
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('Previous appointments')}</h4>
              {pastAppointments.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t('No prior visits recorded yet.')}</p>
              ) : (
                <ul className="mt-3 space-y-3 text-sm text-slate-600">
                {pastAppointments.slice(0, 6).map((item: any) => (
                    <li key={item.appointmentId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="font-semibold text-slate-900">
                        {new Date(item.date).toLocaleDateString()} • {item.doctor.name}
                      </div>
                      <div className="text-xs text-slate-500">{item.department}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t("Today's queue")}</h3>
          <CalendarIcon className="h-5 w-5 text-blue-600" />
            </div>
        <p className="mt-2 text-sm text-slate-500">{t('Upcoming visits linked to your portal account.')}</p>
        {upcomingAppointments.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No upcoming appointments scheduled.')}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcomingAppointments.slice(0, 5).map((item: any, index: number) => (
              <li
                key={item.appointmentId}
                className={`rounded-2xl border px-4 py-3 ${
                  index === 0 ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
                  <span>{new Date(item.date).toLocaleDateString()}</span>
                  <span>{formatMinutes(item.startTimeMin)}</span>
          </div>
                <div className="mt-1 text-sm text-slate-600">{item.doctor?.name ?? t('Provider pending')}</div>
                <div className="text-xs text-slate-500">
                  {(item.department as string | undefined) ?? t('Department pending')} • {item.location ?? t('Clinic visit')}
              </div>
              </li>
            ))}
          </ul>
        )}
      </section>
              </div>
  );
}

const MEDICATION_ORDER_PROGRESS_MAP: Record<MedicationOrderStatus, number | null> = {
  PENDING: 0,
  APPROVED: 0,
  SHIPPING: 0,
  SHIPPED: 1,
  ON_THE_WAY: 2,
  DELIVERED: 3,
  CANCELLED: null,
};

function MedicationsSection({ t, latestImmunization, immunizations, medications, prescriptions, orders, onOrderMedication }: any) {
  const medicationOrdersList = Array.isArray(orders) ? orders : [];
  const orderStatusLabels: Record<string, string> = {
    PENDING: t('Pending approval'),
    APPROVED: t('Approved'),
    SHIPPING: t('In progress'),
    ON_THE_WAY: t('On the way'),
    SHIPPED: t('Shipped'),
    DELIVERED: t('Delivered'),
    CANCELLED: t('Cancelled'),
  };

  const [expandedMedications, setExpandedMedications] = useState<Record<string, boolean>>({});
  const [customOrder, setCustomOrder] = useState({
    medication: '',
    dosageMg: '',
    quantity: '',
    instructions: '',
  });
  const [customOrderError, setCustomOrderError] = useState<string | null>(null);
  const [isSubmittingCustomOrder, setIsSubmittingCustomOrder] = useState(false);
  const prescriptionStatusLabels: Record<string, string> = {
    PENDING: t('Pending'),
    PARTIAL: t('Partially dispensed'),
    DISPENSED: t('Dispensed'),
    CANCELLED: t('Cancelled'),
  };

  const dispenseStatusLabels: Record<string, string> = {
    READY: t('Ready'),
    PARTIAL: t('Partial'),
    COMPLETED: t('Completed'),
    CANCELLED: t('Cancelled'),
  };

  const formatStatus = (status: string, dictionary: Record<string, string>) => dictionary[status] ?? status;

  const [expandedPrescriptions, setExpandedPrescriptions] = useState<Record<string, boolean>>({});

  const togglePrescriptionDetails = (prescriptionId: string) => {
    setExpandedPrescriptions((previous) => ({
      ...previous,
      [prescriptionId]: !previous[prescriptionId],
    }));
  };

  const toggleMedicationDetails = (medicationId: string) => {
    setExpandedMedications((previous) => ({
      ...previous,
      [medicationId]: !previous[medicationId],
    }));
  };

  const handleCustomOrderChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setCustomOrder((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleCustomOrderSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCustomOrderError(null);

    const trimmedMedication = customOrder.medication.trim();
    if (!trimmedMedication) {
      setCustomOrderError(t('Medication name is required.'));
      return;
    }

    const payload: {
      drugName: string;
      dosage?: string;
      quantity?: number;
      instructions?: string;
    } = {
      drugName: trimmedMedication,
    };

    const dosageValue = customOrder.dosageMg.trim();
    if (dosageValue) {
      payload.dosage = `${dosageValue} ${t('mg')}`;
    }

    const parsedQuantity = Number(customOrder.quantity);
    if (!Number.isNaN(parsedQuantity) && parsedQuantity > 0) {
      payload.quantity = parsedQuantity;
    }

    const trimmedInstructions = customOrder.instructions.trim();
    if (trimmedInstructions) {
      payload.instructions = trimmedInstructions;
    }

    try {
      setIsSubmittingCustomOrder(true);
      await onOrderMedication?.(payload);
      setCustomOrder({ medication: '', dosageMg: '', quantity: '', instructions: '' });
    } finally {
      setIsSubmittingCustomOrder(false);
    }
  };

  return (
    <div className="space-y-8">
      {latestImmunization ? (
        <section className="rounded-3xl border border-amber-100 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-amber-900">{t('Latest immunisation')}</h3>
            <PharmacyIcon className="h-5 w-5 text-amber-600" />
          </div>
          <p className="mt-3 text-base font-semibold">{latestImmunization.vaccineName}</p>
          <p className="mt-1 text-xs">
            {t('Administered {date}', { date: new Date(latestImmunization.administeredAt).toLocaleDateString() })}
          </p>
          {latestImmunization.provider ? (
            <p className="mt-1 text-xs">{latestImmunization.provider}</p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            {t('Request medication from pharmacy')}
          </h3>
          <PharmacyIcon className="h-5 w-5 text-blue-600" />
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {t('Let us know which medication you need and the strength in milligrams. Our pharmacy team will follow up with you.')}
        </p>
        <form className="mt-4 space-y-4" onSubmit={handleCustomOrderSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              {t('Medication name')}
              <input
                type="text"
                name="medication"
                value={customOrder.medication}
                onChange={handleCustomOrderChange}
                placeholder={t('e.g. Amoxicillin')}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              {t('Dosage (mg)')}
              <input
                type="number"
                min="0"
                step="0.01"
                name="dosageMg"
                value={customOrder.dosageMg}
                onChange={handleCustomOrderChange}
                placeholder={t('e.g. 500')}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              {t('Quantity (optional)')}
              <input
                type="number"
                min="0"
                step="1"
                name="quantity"
                value={customOrder.quantity}
                onChange={handleCustomOrderChange}
                placeholder={t('Number of tablets or capsules')}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              {t('Instructions for the pharmacist (optional)')}
              <textarea
                name="instructions"
                value={customOrder.instructions}
                onChange={handleCustomOrderChange}
                placeholder={t('Add any notes such as refill request or preferred pickup time')}
                rows={3}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
          </div>
          {customOrderError ? <p className="text-sm text-rose-600">{customOrderError}</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSubmittingCustomOrder}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              <PharmacyIcon className="h-4 w-4" />
              {isSubmittingCustomOrder ? t('Sending request…') : t('Send request to pharmacy')}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t('Prescriptions')}</h3>
          <PharmacyIcon className="h-5 w-5 text-blue-600" />
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {t('Select a prescription to review details and share with our pharmacy.')}
        </p>
        {prescriptions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No prescriptions have been issued yet.')}</p>
        ) : (
          <ul className="mt-4 space-y-4 text-sm text-slate-600">
            {prescriptions.map((prescription: any) => {
              const statusLabel = formatStatus(prescription.status, prescriptionStatusLabels);
              const lastDispense = prescription.dispenses?.[0] ?? null;
              const dispenseMessage = lastDispense
                ? lastDispense.dispensedAt
                  ? t('Dispensed {date}', {
                      date: new Date(lastDispense.dispensedAt).toLocaleDateString(),
                    })
                  : t('Fulfilment status: {status}', {
                      status: formatStatus(lastDispense.status, dispenseStatusLabels),
                    })
                : t('Not yet dispensed');

              const visitSummary = prescription.visit
                ? t('Linked visit {date}', {
                    date: new Date(prescription.visit.visitDate).toLocaleDateString(),
                  })
                : null;

              const rxCode = prescription.prescriptionId.slice(0, 8).toUpperCase();
              const isExpanded = Boolean(expandedPrescriptions[prescription.prescriptionId]);

              return (
                <li key={prescription.prescriptionId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 text-xs text-slate-500">
                      <div className="uppercase tracking-wide text-slate-400">{t('Rx #{id}', { id: rxCode })}</div>
                      <div className="text-sm font-semibold text-slate-900">
                        {t('Status: {status}', { status: statusLabel })}
                      </div>
                      <div>{t('Prescribed {date}', { date: new Date(prescription.createdAt).toLocaleDateString() })}</div>
                      {visitSummary ? (
                        <div>
                          {visitSummary}
                          {prescription.visit?.department ? ` • ${prescription.visit.department}` : ''}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {prescription.doctor?.name ? (
                        <div>{t('Ordered by {name}', { name: prescription.doctor.name })}</div>
                      ) : null}
                      {prescription.doctor?.department ? <div>{prescription.doctor.department}</div> : null}
                      <div>{dispenseMessage}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* Only show order button if prescription status is PENDING and not already dispensed */}
                    {prescription.status === 'PENDING' && !lastDispense ? (
                      <button
                        type="button"
                        onClick={() => onOrderMedication?.(prescription)}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
                      >
                        <PharmacyIcon className="h-4 w-4" />
                        {t('Request pharmacy order')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => togglePrescriptionDetails(prescription.prescriptionId)}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                    >
                      {isExpanded ? t('Hide details') : t('View details')}
                    </button>
                  </div>
                  {isExpanded && prescription.notes ? (
                    <p className="mt-2 text-xs text-slate-500">{prescription.notes}</p>
                  ) : null}
                  {isExpanded && prescription.items && prescription.items.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t('Items ordered')}
                      </p>
                      <ul className="mt-2 space-y-2 text-xs text-slate-600">
                        {prescription.items.map((item: any) => {
                          const drugName = item.drug
                            ? [item.drug.name, item.drug.strength].filter(Boolean).join(' ')
                            : t('Prescription item');
                          const instructionParts = [item.dose, item.route, item.frequency]
                            .filter((part) => part && String(part).trim().length > 0)
                            .join(' • ');
                          const supplyParts = [
                            t('Duration: {days} days', { days: item.durationDays }),
                            t('Quantity prescribed: {quantity}', { quantity: item.quantityPrescribed }),
                          ];
                          if (item.prn) {
                            supplyParts.push(t('As needed'));
                          }

                          return (
                            <li
                              key={item.itemId}
                              className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-2"
                            >
                              <div className="font-semibold text-slate-900">{drugName}</div>
                              {instructionParts ? (
                                <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                                  {instructionParts}
                                </div>
                              ) : null}
                              <div className="mt-1 text-[11px] text-slate-500">
                                {supplyParts.join(' • ')}
                              </div>
                              {item.notes ? (
                                <div className="mt-1 text-[11px] text-slate-500">{item.notes}</div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t('Medication orders')}</h3>
          <PharmacyIcon className="h-5 w-5 text-emerald-600" />
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {t('Track pharmacy approvals, shipping updates, and delivery milestones.')}
        </p>
        {medicationOrdersList.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No medication orders submitted yet.')}</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            {medicationOrdersList.map((order: any) => {
              const statusLabel = orderStatusLabels[order.status] ?? order.status;
              const createdAt = order.createdAt ? new Date(order.createdAt) : null;
              const updatedAt = order.updatedAt ? new Date(order.updatedAt) : null;
              const approvedAt = order.approvedAt ? new Date(order.approvedAt) : null;
              const prescriptionCode = order.prescription?.prescriptionId
                ? order.prescription.prescriptionId.slice(0, 8).toUpperCase()
                : null;
              const sourceLabel = prescriptionCode
                ? t('Prescription #{id}', { id: prescriptionCode })
                : order.drugName || t('Medication order');
              const prescriptionItems = Array.isArray(order.prescription?.items)
                ? order.prescription.items
                    .map((item: any) =>
                      item.drug
                        ? [item.drug.name, item.drug.strength].filter(Boolean).join(' ')
                        : item.dose,
                    )
                    .filter(Boolean)
                    .join(', ')
                : null;

              return (
                <li key={order.orderId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 text-xs text-slate-500">
                      <div className="text-sm font-semibold text-slate-900">{sourceLabel}</div>
                      <div>{t('Status: {status}', { status: statusLabel })}</div>
                      {createdAt ? (
                        <div>{t('Requested {date}', { date: createdAt.toLocaleString() })}</div>
                      ) : null}
                      {approvedAt ? (
                        <div>{t('Approved {date}', { date: approvedAt.toLocaleString() })}</div>
                      ) : null}
                      {order.notes ? (
                        <div>{t('Notes: {notes}', { notes: order.notes })}</div>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {updatedAt ? (
                        <div>{t('Updated {date}', { date: updatedAt.toLocaleString() })}</div>
                      ) : null}
                      {order.quantity ? (
                        <div>{t('Quantity: {quantity}', { quantity: order.quantity })}</div>
                      ) : null}
                      {order.prescription?.doctor?.name ? (
                        <div>{t('Doctor: {name}', { name: order.prescription.doctor.name })}</div>
                      ) : null}
                      {order.prescription?.doctor?.department ? (
                        <div>{order.prescription.doctor.department}</div>
                      ) : null}
                      {order.approvedBy?.email ? (
                        <div>{t('Handled by {email}', { email: order.approvedBy.email })}</div>
                      ) : null}
                    </div>
                  </div>
                  {prescriptionItems ? (
                    <div className="mt-2 text-xs text-slate-500">{prescriptionItems}</div>
                  ) : null}
                  {!order.prescription && (order.dosage || order.instructions) ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      {order.dosage ? (
                        <div>{t('Dosage: {dosage}', { dosage: order.dosage })}</div>
                      ) : null}
                      {order.instructions ? (
                        <div>{t('Instructions: {instructions}', { instructions: order.instructions })}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <MedicationOrderProgress status={order.status as MedicationOrderStatus} t={t} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t('Past Medications (Visit History)')}</h3>
          <PharmacyIcon className="h-5 w-5 text-slate-400" />
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {t('Medications from previous visits. For active prescriptions, see above.')}
        </p>
        {medications.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No past medications recorded.')}</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            {medications.map((medication: any) => {
              const isExpanded = Boolean(expandedMedications[medication.medId]);
              const visitDoctor = medication.visit?.doctor?.name ?? '';
              const visitDate = medication.visit?.visitDate
                ? new Date(medication.visit.visitDate).toLocaleDateString()
                : null;

              return (
                <li key={medication.medId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 text-xs text-slate-500">
                      <div className="text-sm font-semibold text-slate-900">{medication.drugName}</div>
                      {medication.dosage ? <div className="text-sm text-slate-600">{medication.dosage}</div> : null}
                      {visitDate ? <div>{t('Visit date: {date}', { date: visitDate })}</div> : null}
                    </div>
                    {medication.visit ? (
                      <div className="text-right text-xs text-slate-500">
                        {visitDoctor ? <div>{t('Ordered by {name}', { name: visitDoctor })}</div> : null}
                        <div>{medication.visit.department}</div>
                      </div>
                    ) : null}
                  </div>
                  {medication.dosage || medication.instructions ? (
                    <div className="mt-3 space-y-1 text-xs">
                      {medication.dosage ? (
                        <div className="text-slate-600">
                          <span className="font-semibold text-slate-700">Dosage:</span> {medication.dosage}
                        </div>
                      ) : null}
                      {medication.instructions ? (
                        <div className="text-slate-600">
                          <span className="font-semibold text-slate-700">Instructions:</span> {medication.instructions}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{t('Immunisations')}</h3>
          <PharmacyIcon className="h-5 w-5 text-blue-600" />
        </div>
        {immunizations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No immunisations recorded yet.')}</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            {immunizations.map((dose: any) => (
              <li key={dose.immunizationId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="font-semibold text-slate-900">{dose.vaccineName}</div>
                <div className="text-xs text-slate-500">
                  {t('Administered {date}', { date: new Date(dose.administeredAt).toLocaleDateString() })}
                </div>
                {dose.provider ? <div className="text-xs text-slate-500">{dose.provider}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MedicationOrderProgress({
  status,
  t,
}: {
  status: MedicationOrderStatus;
  t: (key: string, variables?: Record<string, string | number>) => string;
}) {
  const currentStage = MEDICATION_ORDER_PROGRESS_MAP[status];
  const steps = useMemo(
    () => [
      { key: 'IN_PROGRESS', label: t('In progress') },
      { key: 'SHIPPED', label: t('Shipped') },
      { key: 'ON_THE_WAY', label: t('On the way') },
      { key: 'DELIVERED', label: t('Delivered') },
    ],
    [t],
  );

  if (currentStage === null || currentStage === undefined) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="flex items-center">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isCompleted = currentStage > index;
          const isActive = currentStage === index;
          const circleBase =
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold';
          let circleClass = `${circleBase} border-slate-300 bg-white text-slate-400`;

          if (isCompleted) {
            circleClass = `${circleBase} border-emerald-500 bg-emerald-500 text-white`;
          } else if (isActive) {
            circleClass = `${circleBase} border-emerald-500 bg-emerald-50 text-emerald-700`;
          }

          return (
            <div key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
              <div className={circleClass}>{isCompleted ? <CheckIcon className="h-3 w-3" /> : index + 1}</div>
              {!isLast ? (
                <div className={`mx-2 h-0.5 flex-1 ${currentStage > index ? 'bg-emerald-500' : 'bg-slate-200'}`} />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-semibold uppercase tracking-wide">
        {steps.map((step, index) => (
          <span key={step.key} className={currentStage >= index ? 'text-emerald-600' : 'text-slate-400'}>
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function LabsSection({ t, labs, medications, immunizations, radiologyReports }: any) {
  return (
    <div className="space-y-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t('Clinical records')}</h3>
              <p className="text-sm text-slate-500">{t('Recent results and active therapies at a glance.')}</p>
            </div>
          <ReportsIcon className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{t('Labs')}</div>
              {labs.length === 0 ? (
                <p className="mt-2 text-xs text-indigo-700">{t('No results yet.')}</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-indigo-700">
                {labs.slice(0, 3).map((result: any) => (
                    <li key={result.labResultId}>
                      <span className="block font-semibold text-indigo-900">{result.LabOrderItem.testName}</span>
                      <span className="block">{new Date(result.resultedAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">{t('Prescriptions')}</div>
              {medications.length === 0 ? (
                <p className="mt-2 text-xs text-emerald-700">{t('No active prescriptions recorded.')}</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-emerald-700">
                {medications.slice(0, 3).map((medication: any) => (
                    <li key={medication.medId}>
                      <span className="block font-semibold text-emerald-900">{medication.drugName}</span>
                      {medication.dosage ? <span className="block">{medication.dosage}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">{t('Vaccines')}</div>
              {immunizations.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700">{t('No immunisations recorded yet.')}</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-amber-700">
                  {immunizations.slice(0, 3).map((dose: any) => (
                    <li key={dose.immunizationId}>
                      <span className="block font-semibold text-amber-900">{dose.vaccineName}</span>
                      <span className="block">{new Date(dose.administeredAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-600">{t('Imaging')}</div>
              {radiologyReports.length === 0 ? (
                <p className="mt-2 text-xs text-sky-700">{t('No imaging studies available yet.')}</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-sky-700">
                  {radiologyReports.slice(0, 3).map((report: any) => (
                    <li key={report.radiologyReportId}>
                      <span className="block font-semibold text-sky-900">{report.studyType}</span>
                      <span className="block">{new Date(report.performedAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{t('Laboratory results')}</h3>
            <ReportsIcon className="h-5 w-5 text-blue-600" />
          </div>
          {labs.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t('No lab results available yet.')}</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
            {labs.map((result: any) => (
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{t('Radiology reports')}</h3>
            <ReportsIcon className="h-5 w-5 text-blue-600" />
          </div>
          {radiologyReports.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t('No imaging studies available yet.')}</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              {radiologyReports.map((report: any) => (
                <li key={report.radiologyReportId} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-900">{report.studyType}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(report.performedAt).toLocaleDateString()} • {report.location ?? t('On site')}
                  </div>
                  {report.impression ? (
                    <p className="mt-1 text-xs text-slate-500">{report.impression}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
  );
}

function BillingSection({ t, invoiceSummary, payments, formatCurrency, setReceiptInvoice }: any) {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t('Billing & receipts')}</h3>
            <p className="text-sm text-slate-500">{t('Download invoices and track payments made to date.')}</p>
          </div>
          <PharmacyIcon className="h-5 w-5 text-blue-600" />
        </div>
        {invoiceSummary ? (
          <div className="mt-4 grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">{t('Outstanding')}</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{formatCurrency(invoiceSummary.outstanding)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">{t('Total paid')}</div>
              <div className="mt-1 text-base font-semibold text-emerald-600">{formatCurrency(invoiceSummary.paidTotal)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">{t('Lifetime value')}</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{formatCurrency(invoiceSummary.lifetimeValue)}</div>
            </div>
          </div>
        ) : null}
        {payments.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('No invoices available yet.')}</p>
        ) : (
          <ul className="mt-5 space-y-3 text-sm text-slate-600">
            {payments.slice(0, 5).map((invoice: any) => {
              const invoicePayments = invoice.payments ?? [];
              return (
                <li key={invoice.invoiceId ?? invoice.invoiceNo} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{invoice.invoiceNo ?? invoice.invoiceId}</div>
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
  );
}
