import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import {
  AISummaryIcon,
  CalendarIcon,
  CheckIcon,
  PatientsIcon,
  PharmacyIcon,
  RegisterIcon,
  SearchIcon,
  LabIcon,
} from '../components/icons';
import { useAuth } from '../context/AuthProvider';
import {
  getAppointmentQueue,
  listAppointments,
  patchStatus,
  type Appointment,
  type AppointmentStatus,
} from '../api/appointments';
import {
  createVisit,
  getVisit,
  listDoctors,
  listUsers,
  listPatientVisits,
  type Doctor,
  type Observation,
  type UserAccount,
  type VisitDetail,
} from '../api/client';
import {
  listLowStockInventory,
  listPharmacyQueue,
  type LowStockInventoryItem,
  type PharmacyQueueItem,
} from '../api/pharmacy';
import { getPatientInsightSummary, type PatientAiSummary } from '../api/insights';
import VisitForm from '../components/VisitForm';
import {
  createVisitFormInitialValues,
  persistVisitFormValues,
  visitDetailToInitialValues,
  type VisitFormInitialValues,
  type VisitFormObservationValues,
  type VisitFormSubmitValues,
} from '../utils/visitForm';
import { useTranslation } from '../hooks/useTranslation';

type QuickActionId = 'appointments' | 'medications' | 'lab-profile' | 'search-clinic';

type QuickActionConfig = {
  label: string;
  heading: string;
  description: string;
  icon: typeof CalendarIcon;
  primaryAction: { to: string; label: string };
  secondaryAction?: { to: string; label: string };
  stat?: { label: string; value: string };
  infoChips?: Array<{ label: string; value: string }>;
  footnote?: string;
};

export default function Home() {
  const { user } = useAuth();

  if (user?.role === 'Doctor') {
    return <DoctorQueueDashboard />;
  }

  if (user?.role === 'ITAdmin') {
    return <ITAdminDashboard />;
  }

  if (user?.role === 'Pharmacist' || user?.role === 'PharmacyTech') {
    return <PharmacistDashboard />;
  }

  if (user?.role === 'InventoryManager') {
    return <InventoryDashboard />;
  }

  return <TeamDashboard role={user?.role} />;
}

function ITAdminDashboard() {
  const { accessToken } = useAuth();
  const { t } = useTranslation();
  const [usersData, setUsersData] = useState<UserAccount[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [doctorsData, setDoctorsData] = useState<Doctor[] | null>(null);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setUsersData(null);
      setUsersError(null);
      setUsersLoading(false);
      return;
    }

    let active = true;
    setUsersLoading(true);
    setUsersError(null);

    listUsers()
      .then((data) => {
        if (!active) return;
        setUsersData(data);
        setUsersError(null);
      })
      .catch((error) => {
        if (!active) return;
        const message = extractErrorMessage(error);
        setUsersError(message ?? USERS_ERROR_FALLBACK);
        setUsersData(null);
      })
      .finally(() => {
        if (!active) return;
        setUsersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setDoctorsData(null);
      setDoctorsError(null);
      setDoctorsLoading(false);
      return;
    }

    let active = true;
    setDoctorsLoading(true);
    setDoctorsError(null);

    listDoctors()
      .then((data) => {
        if (!active) return;
        setDoctorsData(data);
        setDoctorsError(null);
      })
      .catch((error) => {
        if (!active) return;
        const message = extractErrorMessage(error);
        setDoctorsError(message ?? DOCTORS_ERROR_FALLBACK);
        setDoctorsData(null);
      })
      .finally(() => {
        if (!active) return;
        setDoctorsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken]);

  const userErrorMessage = usersError
    ? usersError === USERS_ERROR_FALLBACK
      ? t('Unable to load user accounts.')
      : usersError
    : null;

  const doctorErrorMessage = doctorsError
    ? doctorsError === DOCTORS_ERROR_FALLBACK
      ? t('Unable to load doctor data.')
      : doctorsError
    : null;

  const userStats = useMemo(() => {
    if (!usersData) {
      return { total: null, active: null, inactive: null, doctorAccounts: null };
    }
    const total = usersData.length;
    const active = usersData.filter((item) => item.status === 'active').length;
    const inactive = total - active;
    const doctorAccounts = usersData.filter((item) => item.role === 'Doctor').length;
    return { total, active, inactive, doctorAccounts };
  }, [usersData]);

  const { unassignedDoctors, unassignedCount } = useMemo(() => {
    if (!usersData || !doctorsData) {
      return { unassignedDoctors: null as Doctor[] | null, unassignedCount: null as number | null };
    }
    const assigned = new Set(
      usersData
        .map((account) => account.doctorId)
        .filter((id): id is string => Boolean(id)),
    );
    const unassigned = doctorsData.filter((doctor) => !assigned.has(doctor.doctorId));
    return { unassignedDoctors: unassigned, unassignedCount: unassigned.length };
  }, [doctorsData, usersData]);

  const latestUsers = useMemo(() => {
    if (!usersData) return [] as UserAccount[];
    return [...usersData]
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 5);
  }, [usersData]);

  const loadingUserMessage = usersLoading && !usersData ? t('Loading user accounts...') : null;
  const loadingDoctorMessage =
    (doctorsLoading || (usersLoading && !usersData)) && !doctorsData
      ? t('Loading doctor data...')
      : null;

  const doctorCardHelper =
    unassignedCount !== null
      ? t('Unassigned Doctors: {count}', { count: unassignedCount })
      : undefined;

  const resolvedDoctorError = userErrorMessage ?? doctorErrorMessage;

  return (
    <DashboardLayout
      title={t('IT Administrator Dashboard')}
      subtitle={t('Monitor user accounts, system access, and staff setup.')}
      activeItem="dashboard"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatsCard
            title={t('Staff Accounts')}
            value={userStats.total}
            loading={usersLoading && !usersData}
            fallback={t('No data available.')}
            error={userErrorMessage}
          />
          <StatsCard
            title={t('Active Accounts')}
            value={userStats.active}
            loading={usersLoading && !usersData}
            fallback={t('No data available.')}
            error={userErrorMessage}
          />
          <StatsCard
            title={t('Inactive Accounts')}
            value={userStats.inactive}
            loading={usersLoading && !usersData}
            fallback={t('No data available.')}
            error={userErrorMessage}
          />
          <StatsCard
            title={t('Doctor Accounts')}
            value={userStats.doctorAccounts}
            loading={usersLoading && !usersData}
            helper={doctorCardHelper}
            fallback={t('No data available.')}
            error={resolvedDoctorError}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm xl:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Latest User Accounts')}</h2>
              </div>
              {usersLoading && usersData && (
                <span className="text-xs font-medium text-gray-500">{t('Loading user accounts...')}</span>
              )}
            </div>
            {userErrorMessage ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {userErrorMessage}
              </div>
            ) : loadingUserMessage ? (
              <p className="mt-4 text-sm text-gray-500">{loadingUserMessage}</p>
            ) : usersData && usersData.length > 0 ? (
              <ul className="mt-4 divide-y divide-gray-100">
                {latestUsers.map((account) => {
                  const statusClass =
                    account.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-200 text-gray-600';
                  return (
                    <li key={account.userId} className="flex items-center justify-between py-3">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{account.email}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>{t(ACCOUNT_ROLE_LABELS[account.role])}</span>
                          {account.doctor?.name ? (
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                              {account.doctor.name}
                              {account.doctor.department && (
                                <span className="ml-1 text-[10px] text-blue-500">{account.doctor.department}</span>
                              )}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                              {t('Not assigned')}
                            </span>
                          )}
                          <span className="text-[11px] text-gray-400">
                            {t('Created')} {formatDateTime(account.createdAt)}
                          </span>
                        </div>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusClass}`}>
                        {t(STATUS_LABELS[account.status])}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-gray-500">{t('No user accounts available.')}</p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{t('Doctor Coverage')}</h2>
            {resolvedDoctorError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {resolvedDoctorError}
              </div>
            ) : loadingDoctorMessage ? (
              <p className="mt-4 text-sm text-gray-500">{loadingDoctorMessage}</p>
            ) : !usersData || !doctorsData ? (
              <p className="mt-4 text-sm text-gray-500">{t('No data available.')}</p>
            ) : unassignedDoctors && unassignedDoctors.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {unassignedDoctors.map((doctor) => (
                  <li
                    key={doctor.doctorId}
                    className="rounded-xl border border-yellow-100 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
                  >
                    <div className="font-medium text-yellow-900">{doctor.name}</div>
                    <div className="text-xs text-yellow-700">{doctor.department}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-gray-600">{t('All doctors have user accounts.')}</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

const ACCOUNT_ROLE_LABELS: Record<UserAccount['role'], string> = {
  Doctor: 'Doctor',
  Cashier: 'Cashier',
  AdminAssistant: 'Administrative Assistant',
  ITAdmin: 'IT Administrator',
  Pharmacist: 'Pharmacist',
  PharmacyTech: 'Pharmacy Technician',
  InventoryManager: 'Inventory Manager',
  Nurse: 'Nurse',
  LabTech: 'Laboratory Technician',
};

const STATUS_LABELS: Record<UserAccount['status'], 'Active' | 'Inactive'> = {
  active: 'Active',
  inactive: 'Inactive',
};

const USERS_ERROR_FALLBACK = '__fallback_users_error__';
const DOCTORS_ERROR_FALLBACK = '__fallback_doctors_error__';

interface StatsCardProps {
  title: string;
  value: number | null;
  helper?: string;
  fallback?: string;
  loading?: boolean;
  error?: string | null;
}

function StatsCard({ title, value, helper, fallback, loading, error }: StatsCardProps) {
  const displayValue =
    loading && value === null ? '…' : value !== null ? value.toLocaleString() : '—';

  const showFallback = !loading && value === null;
  const helperContent = error ?? (showFallback ? fallback : helper) ?? ' ';

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className="mt-2 text-4xl font-semibold text-gray-900">{displayValue}</div>
      <div className={`mt-3 text-sm ${error ? 'text-red-600' : 'text-gray-600'}`}>{helperContent}</div>
    </div>
  );
}

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as { message?: string; error?: string };
      if (parsed?.message && typeof parsed.message === 'string') {
        return parsed.message;
      }
      if (parsed?.error && typeof parsed.error === 'string') {
        return parsed.error;
      }
    } catch {
      /* ignore */
    }
    if (error.message) {
      return error.message;
    }
  }
  return null;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function createDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function PharmacistDashboard() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<PharmacyQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPharmacyQueue(['PENDING', 'PARTIAL']);
      setQueue(data);
    } catch (err) {
      setError(parseErrorMessage(err, t('Unable to load pharmacy queue.')));
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const pendingCount = useMemo(
    () => queue.filter((item) => item.status === 'PENDING').length,
    [queue],
  );
  const partialCount = useMemo(
    () => queue.filter((item) => item.status === 'PARTIAL').length,
    [queue],
  );
  const totalActive = pendingCount + partialCount;

  const subtitle = useMemo(() => {
    if (loading && !queue.length) {
      return t('Loading pharmacy queue...');
    }
    if (error) {
      return error;
    }
    if (!totalActive) {
      return t('No prescriptions waiting right now.');
    }
    return t('{count} prescriptions need attention.', { count: totalActive });
  }, [error, loading, queue.length, t, totalActive]);

  const tasks = useMemo(() => {
    const items: Array<{ key: string; label: string }> = [];
    if (pendingCount > 0) {
      items.push({
        key: 'pending',
        label: t('Verify {count} new prescriptions.', { count: pendingCount }),
      });
    }
    if (partialCount > 0) {
      items.push({
        key: 'partial',
        label: t('Complete {count} partial fills.', { count: partialCount }),
      });
    }
    if (!items.length) {
      items.push({ key: 'clear', label: t('Queue is clear—monitor for new orders.') });
    }
    return items;
  }, [partialCount, pendingCount, t]);

  const nextInQueue = useMemo(() => queue.slice(0, 3), [queue]);

  const renderCount = (value: number) => {
    if (loading && !queue.length) {
      return '…';
    }
    if (error) {
      return '—';
    }
    return value.toLocaleString();
  };

  return (
    <DashboardLayout
      title={t('Pharmacy Dashboard')}
      subtitle={subtitle}
      activeItem="dashboard"
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <PharmacyIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">{t('New prescriptions')}</div>
              <div className="mt-2 text-4xl font-semibold text-gray-900">{renderCount(pendingCount)}</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            {pendingCount > 0
              ? t('Review and verify orders before dispensing.')
              : t('No new prescriptions waiting.')}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <CheckIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">{t('Partial fills')}</div>
              <div className="mt-2 text-4xl font-semibold text-gray-900">{renderCount(partialCount)}</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            {partialCount > 0
              ? t('Complete dispensing and document pick up details.')
              : t('No partial fills outstanding.')}
          </p>
        </div>

        <div className="flex flex-col rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <CheckIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("Today's focus")}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('Keep the queue moving smoothly with these actions.')}
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-3">
            {tasks.map((task) => (
              <li key={task.key} className="flex items-start gap-2 text-sm text-gray-700">
                <CheckIcon className="mt-0.5 h-4 w-4 text-blue-500" />
                <span>{task.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('Next in dispensing queue')}</h2>
            {loading && queue.length > 0 ? (
              <p className="text-xs font-medium text-gray-500">{t('Refreshing queue...')}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadQueue}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              {t('Refresh queue')}
            </button>
            <Link to="/pharmacy/queue" className="text-xs font-semibold text-blue-600 hover:underline">
              {t('Open queue')}
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : loading && !queue.length ? (
          <p className="mt-4 text-sm text-gray-500">{t('Loading prescriptions...')}</p>
        ) : nextInQueue.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {nextInQueue.map((item) => {
              const lineLabel =
                item.items.length === 1
                  ? t('1 medication ordered')
                  : t('{count} medications ordered', { count: item.items.length });
              const timeDisplay = (() => {
                const timestamp = new Date(item.createdAt);
                if (Number.isNaN(timestamp.getTime())) return '—';
                return timestamp.toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                });
              })();
              return (
                <li
                  key={item.prescriptionId}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {item.patient?.name ?? t('Patient')}
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.doctor?.name
                          ? t('Ordered by {name}', { name: item.doctor.name })
                          : t('Ordering provider pending')}
                      </div>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                    <span>{lineLabel}</span>
                    <span>•</span>
                    <span>{t('Entered {time}', { time: timeDisplay })}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-gray-600">{t('Nothing waiting in the queue right now.')}</p>
        )}
      </div>
    </DashboardLayout>
  );
}

function InventoryDashboard() {
  const { t } = useTranslation();
  const LOW_STOCK_THRESHOLD = 20;
  const [items, setItems] = useState<LowStockInventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listLowStockInventory({ threshold: LOW_STOCK_THRESHOLD, limit: 6 });
      setItems(data);
    } catch (err) {
      setError(parseErrorMessage(err, t('Unable to load inventory status.')));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [LOW_STOCK_THRESHOLD, t]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  const zeroCount = useMemo(
    () => items.filter((item) => item.totalOnHand === 0).length,
    [items],
  );
  const criticalThreshold = Math.max(0, Math.floor(LOW_STOCK_THRESHOLD / 2));
  const criticalCount = useMemo(
    () => items.filter((item) => item.totalOnHand <= criticalThreshold).length,
    [criticalThreshold, items],
  );

  const subtitle = useMemo(() => {
    if (loading && !items.length) {
      return t('Checking stock levels...');
    }
    if (error) {
      return error;
    }
    if (!items.length) {
      return t('All monitored medications are above the safety threshold.');
    }
    return t('{count} medications need replenishment.', { count: items.length });
  }, [error, items.length, loading, t]);

  const renderCount = (value: number) => {
    if (loading && !items.length) {
      return '…';
    }
    if (error) {
      return '—';
    }
    return value.toLocaleString();
  };

  return (
    <DashboardLayout
      title={t('Inventory Dashboard')}
      subtitle={subtitle}
      activeItem="dashboard"
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <PharmacyIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">{t('Low stock items')}</div>
              <div className="mt-2 text-4xl font-semibold text-gray-900">{renderCount(items.length)}</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            {items.length > 0
              ? t('Prioritize replenishment for medications below the safety threshold.')
              : t('No items currently flagged as low stock.')}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <CheckIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">{t('Critical levels')}</div>
              <div className="mt-2 text-4xl font-semibold text-gray-900">{renderCount(criticalCount)}</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            {criticalCount > 0
              ? t('Escalate orders for medications nearing stock-out.')
              : t('No medications near stock-out today.')}
          </p>
        </div>

        <div className="flex flex-col rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <PharmacyIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('Inventory workspace')}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('Adjust counts, receive stock, and audit recent updates.')}
              </p>
            </div>
          </div>
          <div className="mt-6">
            <Link
              to="/pharmacy/inventory"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700"
            >
              {t('Open inventory tools')}
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('Lowest stock medications')}</h2>
            {loading && items.length > 0 ? (
              <p className="text-xs font-medium text-gray-500">{t('Refreshing inventory...')}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadInventory}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              {t('Refresh list')}
            </button>
            <Link to="/pharmacy/inventory" className="text-xs font-semibold text-blue-600 hover:underline">
              {t('Manage inventory')}
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : loading && !items.length ? (
          <p className="mt-4 text-sm text-gray-500">{t('Loading inventory...')}</p>
        ) : items.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {items.map((item) => {
              const isOut = item.totalOnHand === 0;
              const containerClass = isOut
                ? 'border-red-200 bg-red-50'
                : 'border-amber-200 bg-amber-50';
              const valueClass = isOut ? 'text-red-700' : 'text-amber-700';

              return (
                <li
                  key={item.drugId}
                  className={`rounded-xl border px-4 py-4 ${containerClass}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                      <div className="text-xs text-gray-600">{item.strength} • {item.form}</div>
                      {item.genericName ? (
                        <div className="text-xs text-gray-500">
                          {t('Generic: {name}', { name: item.genericName })}
                        </div>
                      ) : null}
                    </div>
                    <div className={`text-right ${valueClass}`}>
                      <div className="text-xl font-semibold">{item.totalOnHand.toLocaleString()}</div>
                      <div className="text-xs font-medium">
                        {isOut ? t('Out of stock') : t('Units on hand')}
                      </div>
                    </div>
                  </div>
                  {item.locations.length ? (
                    <ul className="mt-3 space-y-1 text-xs text-gray-600">
                      {item.locations.map((location) => (
                        <li key={location.location} className="flex items-center justify-between">
                          <span>{location.location}</span>
                          <span className="font-semibold text-gray-700">
                            {location.qtyOnHand.toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-gray-500">{t('No active stock locations recorded.')}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-gray-600">{t('Inventory levels look healthy today.')}</p>
        )}
      </div>
    </DashboardLayout>
  );
}

function TeamDashboard({ role }: { role?: string }) {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeQuickAction, setActiveQuickAction] = useState<QuickActionId>('appointments');
  const todayKey = useMemo(() => createDateKey(new Date()), []);
  const statusVisuals = getStatusVisuals(t);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    listAppointments({ from: todayKey, limit: 25 })
      .then((response) => {
        if (!active) return;
        setAppointments(response.data);
      })
      .catch((err) => {
        if (!active) return;
        setError(parseErrorMessage(err, t('Unable to load schedule.')));
        setAppointments([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [todayKey, t]);

  const todaysAppointments = useMemo(
    () => appointments.filter((appointment) => normalizeDateKey(appointment.date) === todayKey),
    [appointments, todayKey],
  );

  const statusTotals = useMemo(() => {
    const totals = {
      total: todaysAppointments.length,
      scheduled: 0,
      checkedIn: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
    };

    todaysAppointments.forEach((appointment) => {
      switch (appointment.status) {
        case 'Scheduled':
          totals.scheduled += 1;
          break;
        case 'CheckedIn':
          totals.checkedIn += 1;
          break;
        case 'InProgress':
          totals.inProgress += 1;
          break;
        case 'Completed':
          totals.completed += 1;
          break;
        case 'Cancelled':
          totals.cancelled += 1;
          break;
        default:
          break;
      }
    });

    return totals;
  }, [todaysAppointments]);

  const upcomingCount = statusTotals.scheduled + statusTotals.checkedIn + statusTotals.inProgress;
  const readyCount = statusTotals.checkedIn + statusTotals.inProgress;
  const waitingCount = statusTotals.scheduled;

  const overdueCount = useMemo(() => {
    const now = Date.now();
    return todaysAppointments.filter((appointment) => {
      if (appointment.status !== 'Scheduled') {
        return false;
      }
      const start = getAppointmentDateTime(appointment);
      return start !== null && start.getTime() < now;
    }).length;
  }, [todaysAppointments]);

  const tasks = useMemo(() => {
    const items: Array<{ key: string; label: string }> = [];

    if (waitingCount > 0) {
      items.push({
        key: 'check-in',
        label: t('Check in {count} scheduled patients.', { count: waitingCount }),
      });
    }

    if (readyCount > 0) {
      items.push({
        key: 'prep-rooms',
        label: t('Prepare rooms for {count} checked-in patients.', { count: readyCount }),
      });
    }

    if (overdueCount > 0) {
      items.push({
        key: 'overdue',
        label: t('Follow up on {count} appointments past their start time.', { count: overdueCount }),
      });
    }

    return items;
  }, [overdueCount, readyCount, waitingCount, t]);

  const upcomingAppointments = useMemo(() => {
    if (!appointments.length) {
      return [] as Appointment[];
    }

    const sorted = [...appointments].sort((a, b) => {
      const aTime = getAppointmentDateTime(a);
      const bTime = getAppointmentDateTime(b);

      if (!aTime && !bTime) return 0;
      if (!aTime) return 1;
      if (!bTime) return -1;
      return aTime.getTime() - bTime.getTime();
    });

    return sorted.slice(0, 5);
  }, [appointments]);

  const renderCount = (value: number) => {
    if (loading) {
      return '…';
    }
    if (error) {
      return '—';
    }
    return value.toLocaleString();
  };

  const hasAppointments = appointments.length > 0;

  const headerSearch = (
    <div className="relative w-full md:w-72">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        placeholder={t('Search patients...')}
        className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      />
    </div>
  );

  const appointmentSummary = error
    ? error
    : statusTotals.total > 0
      ? t('{upcoming} upcoming · {completed} completed', {
          upcoming: upcomingCount,
          completed: statusTotals.completed,
        })
      : t('No appointments scheduled today.');

  const checkedInSummary = error
    ? error
    : readyCount > 0
      ? t('{count} patients ready for their visit.', { count: readyCount })
      : waitingCount > 0
        ? t('{count} patients waiting to check in.', { count: waitingCount })
        : t('No patients have checked in yet.');

  const quickActions: Record<QuickActionId, QuickActionConfig> = {
    appointments: {
      label: t('Appointments'),
      heading: t('Coordinate today\'s schedule'),
      description: t('Review the visit queue, update appointment statuses, and keep the day on track.'),
      icon: CalendarIcon,
      primaryAction: { to: '/appointments', label: t('Open appointments') },
      secondaryAction: { to: '/appointments/new', label: t('Book new appointment') },
      stat: { label: t('Appointments today'), value: renderCount(statusTotals.total) },
      infoChips: [
        { label: t('Upcoming'), value: renderCount(upcomingCount) },
        { label: t('Checked-in'), value: renderCount(readyCount) },
        { label: t('Completed'), value: renderCount(statusTotals.completed) },
      ],
      footnote: appointmentSummary,
    },
    medications: {
      label: t('Prescriptions'),
      heading: t('Coordinate prescription fulfillment'),
      description: t('Review prescription orders waiting in the queue and confirm stock for hospital or client delivery.'),
      icon: PharmacyIcon,
      primaryAction: { to: '/pharmacy/queue', label: t('Go to pharmacy queue') },
      secondaryAction: { to: '/pharmacy/inventory', label: t('Check inventory') },
      footnote: t('Keep pharmacy teams informed of outstanding medication orders and inventory gaps.'),
    },
    'lab-profile': {
      label: t('Lab Profile'),
      heading: t('Follow up on lab work'),
      description: t('Track order statuses, review requisitions, and share results with the care team.'),
      icon: LabIcon,
      primaryAction: { to: '/lab-orders', label: t('View lab orders') },
      footnote: t('Ensure specimens are collected on time and results are routed to clinicians.'),
    },
    'search-clinic': {
      label: t('Search Clinic'),
      heading: t('Find clinic resources fast'),
      description: t('Look up contact information, panels, and patient groups associated with each clinic.'),
      icon: SearchIcon,
      primaryAction: { to: '/patients', label: t('Search clinic records') },
      secondaryAction: { to: '/reports', label: t('Open reports') },
      footnote: t('Use filters to locate clinics, confirm coverage, and share updates with the team.'),
    },
  };

  const quickActionOrder: QuickActionId[] = ['appointments', 'medications', 'lab-profile', 'search-clinic'];
  const activeQuickActionConfig = quickActions[activeQuickAction];

  return (
    <DashboardLayout
      title={t('Team Dashboard')}
      activeItem="dashboard"
      subtitle={
        role === 'AdminAssistant'
          ? t('Monitor appointments and keep patients informed.')
          : t('Track clinic activity and coordinate care.')
      }
      headerChildren={headerSearch}
    >
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('Quick workspace tabs')}</h2>
            <p className="mt-1 text-sm text-gray-600">
              {t('Switch between core clinic workflows without leaving the dashboard.')}
            </p>
          </div>
        </div>
        <div
          className="mt-6 flex flex-wrap gap-2"
          role="tablist"
          aria-label={t('Clinic workspace tabs')}
        >
          {quickActionOrder.map((tab) => {
            const config = quickActions[tab];
            const isActive = tab === activeQuickAction;
            return (
              <button
                key={tab}
                id={`quick-action-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`quick-action-panel-${tab}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveQuickAction(tab)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                  isActive
                    ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-600'
                }`}
              >
                <config.icon className="h-4 w-4" />
                <span>{config.label}</span>
              </button>
            );
          })}
        </div>
        <div
          id={`quick-action-panel-${activeQuickAction}`}
          role="tabpanel"
          aria-labelledby={`quick-action-tab-${activeQuickAction}`}
          className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-5"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-white p-3 text-blue-600 shadow-sm">
                <activeQuickActionConfig.icon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{activeQuickActionConfig.heading}</h3>
                <p className="mt-1 text-sm text-gray-600">{activeQuickActionConfig.description}</p>
              </div>
            </div>
            {activeQuickActionConfig.stat ? (
              <div className="rounded-xl bg-white px-4 py-3 text-center shadow-sm">
                <div className="text-2xl font-semibold text-gray-900">{activeQuickActionConfig.stat.value}</div>
                <div className="text-xs font-medium text-gray-500">{activeQuickActionConfig.stat.label}</div>
              </div>
            ) : null}
          </div>
          {activeQuickActionConfig.infoChips?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {activeQuickActionConfig.infoChips.map((chip) => (
                <span
                  key={`${activeQuickAction}-${chip.label}`}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm"
                >
                  <span className="text-gray-900">{chip.value}</span>
                  <span className="text-gray-500">{chip.label}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to={activeQuickActionConfig.primaryAction.to}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              {activeQuickActionConfig.primaryAction.label}
            </Link>
            {activeQuickActionConfig.secondaryAction ? (
              <Link
                to={activeQuickActionConfig.secondaryAction.to}
                className="inline-flex items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
              >
                {activeQuickActionConfig.secondaryAction.label}
              </Link>
            ) : null}
          </div>
          {activeQuickActionConfig.footnote ? (
            <p className="mt-4 text-xs text-gray-500">{activeQuickActionConfig.footnote}</p>
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <RegisterIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('Register New Patient')}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('Capture demographics and intake information for walk-in patients.')}
              </p>
            </div>
          </div>
          <div className="w-full max-w-sm rounded-3xl bg-white/10 p-6 text-sm text-white shadow-lg backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{t('Today’s highlights')}</p>
            <p className="mt-3 text-base font-semibold">{appointmentSummary}</p>
            <p className="mt-3 text-sm text-white/80">{checkedInSummary}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link
                to="/appointments/new"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow transition hover:bg-blue-50"
              >
                {t('Book appointment')}
              </Link>
              <Link
                to="/patients"
                className="inline-flex items-center justify-center rounded-2xl bg-white/20 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-white/30"
              >
                {t('Find patient')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

type SummaryEntry =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; summary: PatientAiSummary };

function DoctorQueueDashboard() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [selectedVisitDetail, setSelectedVisitDetail] = useState<VisitDetail | null>(null);
  const [visitInitialValues, setVisitInitialValues] = useState<VisitFormInitialValues | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [savingVisit, setSavingVisit] = useState(false);
  const [activeSummaryPatientId, setActiveSummaryPatientId] = useState<string | null>(null);
  const [summaryState, setSummaryState] = useState<Record<string, SummaryEntry>>({});
  const { t } = useTranslation();
  const statusVisuals = getStatusVisuals(t);

  const fetchSummary = useCallback(
    (patientId: string) => {
      setSummaryState((prev) => ({ ...prev, [patientId]: { status: 'loading' } }));
      getPatientInsightSummary(patientId, { lastN: 5 })
        .then((response) => {
          const summary =
            response.aiSummary ?? { headline: '', bulletPoints: [], generatedAt: new Date().toISOString() };
          setSummaryState((prev) => ({
            ...prev,
            [patientId]: { status: 'success', summary },
          }));
        })
        .catch((err) => {
          setSummaryState((prev) => ({
            ...prev,
            [patientId]: {
              status: 'error',
              message: parseErrorMessage(err, t('Unable to generate AI summary.')),
            },
          }));
        });
    },
    [t],
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAppointmentQueue();
      setAppointments(response.data);
    } catch (err) {
      setError(parseErrorMessage(err, t('Unable to load queue.')));
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    let ignore = false;

    async function loadDoctorsList() {
      try {
        const list = await listDoctors();
        if (!ignore) {
          setDoctors(list);
        }
      } catch (err) {
        if (!ignore) {
          console.error(err);
          setError(parseErrorMessage(err, t('Unable to load doctors.')));
        }
      }
    }

    loadDoctorsList();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!appointments.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((previous) => {
      if (previous && appointments.some((appt) => appt.appointmentId === previous)) {
        return previous;
      }
      return appointments[0].appointmentId;
    });
  }, [appointments]);

  useEffect(() => {
    if (!activeSummaryPatientId) return;
    const stillInQueue = appointments.some((appointment) => appointment.patientId === activeSummaryPatientId);
    if (!stillInQueue) {
      setActiveSummaryPatientId(null);
    }
  }, [activeSummaryPatientId, appointments]);

  const selected = appointments.find((appt) => appt.appointmentId === selectedId) ?? null;

  const handleSummaryToggle = (
    event: MouseEvent<HTMLButtonElement>,
    appointment: Appointment,
  ) => {
    event.stopPropagation();
    const patientId = appointment.patientId;
    if (!patientId) {
      return;
    }

    if (activeSummaryPatientId === patientId) {
      setActiveSummaryPatientId(null);
      return;
    }

    setActiveSummaryPatientId(patientId);
    const entry = summaryState[patientId];
    if (!entry || entry.status === 'error') {
      fetchSummary(patientId);
    }
  };

  const renderSummaryContent = (entry: SummaryEntry | undefined, patientId: string) => {
    if (!entry || entry.status === 'loading') {
      return <p className="mt-2 text-xs text-gray-500">{t('Loading AI summary...')}</p>;
    }

    if (entry.status === 'error') {
      return (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-red-600">{entry.message}</p>
          <button
            type="button"
            onClick={(refreshEvent) => {
              refreshEvent.stopPropagation();
              fetchSummary(patientId);
            }}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            {t('Refresh summary')}
          </button>
        </div>
      );
    }

    if (entry.summary.bulletPoints.length === 0) {
      return <p className="mt-2 text-xs text-gray-500">{t('No AI summary is available.')}</p>;
    }

    return (
      <div className="mt-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">
          {entry.summary.headline || t('AI-generated patient overview')}
        </p>
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-gray-700">
          {entry.summary.bulletPoints.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-400">{t('Generated using GPT-5 mini.')}</p>
      </div>
    );
  };

  const handleQueueItemKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    appointmentId: string,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedId(appointmentId);
    }
  };

  useEffect(() => {
    setSuccess(null);
    setError(null);
    setSelectedVisitId(null);
    setSelectedVisitDetail(null);
    setSavingVisit(false);

    if (!selected) {
      setVisitInitialValues(null);
      return;
    }

    const baseValues = createVisitFormInitialValues({
      visitDate: normalizeDateKey(selected.date),
      doctorId: selected.doctorId,
      department: selected.department,
      reason: selected.reason ?? undefined,
    });
    setVisitInitialValues(baseValues);

    let ignore = false;

    async function loadExistingVisitDetails(current: Appointment) {
      try {
        const visits = await listPatientVisits(current.patientId);
        const appointmentDate = normalizeDateKey(current.date);
        const match = visits.find(
          (visit) =>
            visit.doctor.doctorId === current.doctorId &&
            normalizeDateKey(visit.visitDate) === appointmentDate,
        );

        if (!match) {
          return;
        }

        const detail = await getVisit(match.visitId);
        if (!ignore) {
          setSelectedVisitId(match.visitId);
          setSelectedVisitDetail(detail);
          setVisitInitialValues(visitDetailToInitialValues(detail));
        }
      } catch (err) {
        if (!ignore) {
          console.error(err);
          setError(parseErrorMessage(err, t('Unable to load existing visit details.')));
        }
      }
    }

    loadExistingVisitDetails(selected);

    return () => {
      ignore = true;
    };
  }, [
    selected?.appointmentId,
    selected?.patientId,
    selected?.doctorId,
    selected?.date,
    selected?.department,
    selected?.reason,
  ]);

  const handleInvite = async (appointment: Appointment) => {
    setInvitingId(appointment.appointmentId);
    setSuccess(null);
    setError(null);
    try {
      await patchStatus(appointment.appointmentId, { status: 'InProgress' });
      await loadQueue();
      setSuccess(t('Invited {name} to the consultation room.', { name: appointment.patient.name }));
      setSelectedId(appointment.appointmentId);
    } catch (err) {
      setError(parseErrorMessage(err, t('Unable to update appointment status.')));
    } finally {
      setInvitingId(null);
    }
  };

  const handleVisitSubmit = async (values: VisitFormSubmitValues) => {
    if (!selected) {
      setError(t('Select an appointment before saving visit details.'));
      return;
    }

    if (!values.doctorId) {
      setError(t('A doctor must be selected for the visit.'));
      return;
    }

    const summaryPatientId = selected.patientId;
    setSavingVisit(true);
    setSuccess(null);
    setError(null);

    try {
      let visitId = selectedVisitId;
      let detail = selectedVisitDetail;

      if (!visitId) {
        const visit = await createVisit({
          patientId: selected.patientId,
          visitDate: values.visitDate,
          doctorId: values.doctorId,
          department: values.department,
          reason: values.reason,
        });
        visitId = visit.visitId;
        await persistVisitFormValues(visitId, values);
        detail = await getVisit(visitId);
      } else {
        const additions = computeVisitAdditions(values, detail);
        const hasAdditions =
          additions.diagnoses.length > 0 ||
          additions.medications.length > 0 ||
          additions.labs.length > 0 ||
          Boolean(additions.observation);

        if (hasAdditions) {
          await persistVisitFormValues(visitId, additions);
          detail = await getVisit(visitId);
        }
      }

      if (detail) {
        setSelectedVisitDetail(detail);
        setVisitInitialValues(visitDetailToInitialValues(detail));
      }

      if (visitId) {
        setSelectedVisitId(visitId);
      }

      if (selected.status !== 'Completed') {
        const result = await patchStatus(selected.appointmentId, { status: 'Completed' });
        if ('visitId' in result && typeof result.visitId === 'string') {
          visitId = result.visitId;
          setSelectedVisitId(result.visitId);
          if (!detail || detail.visitId !== result.visitId) {
            const refreshed = await getVisit(result.visitId);
            setSelectedVisitDetail(refreshed);
            setVisitInitialValues(visitDetailToInitialValues(refreshed));
          }
        }
      }

      setSuccess(
        selected.status === 'Completed'
          ? t('Visit details updated.')
          : t('Visit saved and appointment completed.'),
      );
      await loadQueue();
      setSelectedId(selected.appointmentId);
      if (summaryState[summaryPatientId]) {
        fetchSummary(summaryPatientId);
      }
    } catch (err) {
      console.error(err);
      setError(parseErrorMessage(err, t('Unable to save visit details.')));
    } finally {
      setSavingVisit(false);
    }
  };

  return (
    <DashboardLayout
      title={t("Today's Queue")}
      activeItem="dashboard"
      subtitle={t('Invite your next patient, capture notes, and wrap up the visit.')}
      headerChildren={
        <button
          type="button"
          onClick={loadQueue}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
        >
          {t('Refresh Queue')}
        </button>
      }
    >
      {loading ? (
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 shadow-sm">
            <SearchIcon className="h-10 w-10 animate-spin text-blue-500" />
            <p className="text-sm font-medium text-gray-600">{t('Loading your appointments...')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{t('Upcoming patients')}</h2>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                {t('{count} in queue', { count: appointments.length })}
              </span>
            </div>
            <ul className="mt-4 space-y-3">
              {appointments.length === 0 ? (
                <li className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
                  {t('No patients waiting. Enjoy a short break!')}
                </li>
              ) : (
                appointments.map((appointment) => {
                  const status = statusVisuals[appointment.status];
                  const isSelected = appointment.appointmentId === selectedId;
                  const patientSummaryId = appointment.patientId;
                  const summaryEntry = summaryState[patientSummaryId];
                  const summaryOpen = activeSummaryPatientId === patientSummaryId;
                  return (
                    <li
                      key={appointment.appointmentId}
                      className={`rounded-xl border px-4 py-3 transition ${
                        isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(appointment.appointmentId)}
                          onKeyDown={(event) =>
                            handleQueueItemKeyDown(event, appointment.appointmentId)
                          }
                          className="flex flex-1 cursor-pointer flex-col text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-50"
                        >
                          <Link
                            to={`/patients/${appointment.patientId}`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-sm font-semibold text-blue-600 hover:underline focus:outline-none focus-visible:underline focus-visible:text-blue-700"
                          >
                            {appointment.patient.name}
                          </Link>
                          <span className="mt-1 text-xs text-gray-500">
                            {formatDateDisplay(appointment.date)} ·{' '}
                            {formatTimeRange(appointment.startTimeMin, appointment.endTimeMin)}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <button
                                type="button"
                                aria-label={t('AI Summary')}
                                aria-expanded={summaryOpen}
                                onClick={(event) => handleSummaryToggle(event, appointment)}
                                className={`rounded-full border p-2 text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                                  summaryOpen
                                    ? 'border-blue-300 bg-blue-50 text-blue-600'
                                    : 'border-gray-200 hover:border-blue-200 hover:text-blue-600'
                                }`}
                              >
                                <AISummaryIcon className="h-4 w-4" />
                              </button>
                              {summaryOpen && (
                                <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-blue-100 bg-white p-4 text-xs shadow-xl">
                                  <p className="text-xs font-semibold text-blue-600">{t('AI Summary')}</p>
                                  {renderSummaryContent(summaryEntry, patientSummaryId)}
                                </div>
                              )}
                            </div>
                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${status.chip}`}>
                              <span className={`mr-2 h-2 w-2 rounded-full ${status.dot}`}></span>
                              {status.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            {selected ? (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="text-sm font-medium text-gray-500">{t('Current patient')}</div>
                  <h2 className="mt-1 text-2xl font-semibold text-gray-900">{selected.patient.name}</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {(selected.reason && selected.reason.trim()) || t('No visit reason recorded.')}
                    {' · '}
                    {(selected.location && selected.location.trim()) || t('Room assignment pending')}
                  </p>
                </div>

                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('Scheduled time')}</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {formatDateDisplay(selected.date)} · {formatTimeRange(selected.startTimeMin, selected.endTimeMin)}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('Status')}</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">{statusVisuals[selected.status].label}</dd>
                  </div>
                </dl>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-700">{t('Visit documentation')}</h3>
                  {visitInitialValues ? (
                    <VisitForm
                      doctors={doctors}
                      initialValues={visitInitialValues}
                      onSubmit={handleVisitSubmit}
                      saving={savingVisit}
                      disableDoctorSelection
                      disableVisitDate
                      submitLabel={
                        selected.status === 'Completed'
                          ? t('Update Visit')
                          : t('Save Visit & Complete')
                      }
                      submitDisabled={
                        !(selected.status === 'InProgress' || selected.status === 'Completed')
                      }
                      extraActions={
                        selected.status === 'Scheduled' || selected.status === 'CheckedIn'
                          ? (
                              <button
                                type="button"
                                onClick={() => handleInvite(selected)}
                                disabled={invitingId === selected.appointmentId}
                                className={`rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition ${
                                  invitingId === selected.appointmentId
                                    ? 'cursor-not-allowed bg-blue-300'
                                    : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                              >
                                {invitingId === selected.appointmentId
                                  ? t('Inviting...')
                                  : t('Invite Patient')}
                              </button>
                            )
                          : null
                      }
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
                      {t('Loading visit form...')}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                )}
                {success && (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                {t('Select a patient from the queue to begin charting their visit.')}
              </div>
            )}
          </section>
        </div>
      )}
    </DashboardLayout>
  );
}

function computeVisitAdditions(
  values: VisitFormSubmitValues,
  detail: VisitDetail | null,
): VisitFormSubmitValues {
  if (!detail) {
    return values;
  }

  const existingDiagnoses = new Set(
    detail.diagnoses.map((diagnosis) => createDiagnosisKey(diagnosis.diagnosis)),
  );
  const diagnoses = values.diagnoses.filter((diagnosis) => {
    const key = createDiagnosisKey(diagnosis);
    if (!key || existingDiagnoses.has(key)) {
      return false;
    }
    existingDiagnoses.add(key);
    return true;
  });

  const existingMedications = new Set(
    detail.medications.map((medication) =>
      createMedicationKey({ drugName: medication.drugName, dosage: medication.dosage ?? undefined }),
    ),
  );
  const medications = values.medications.filter((medication) => {
    const key = createMedicationKey(medication);
    if (!key || existingMedications.has(key)) {
      return false;
    }
    existingMedications.add(key);
    return true;
  });

  const existingLabs = new Set(detail.labResults.map((lab) => createLabKey(lab)));
  const labs = values.labs.filter((lab) => {
    const key = createLabKey(lab);
    if (!key || existingLabs.has(key)) {
      return false;
    }
    existingLabs.add(key);
    return true;
  });

  let observation: VisitFormObservationValues | undefined;
  if (values.observation) {
    const latestObservation = detail.observations[0];
    if (observationHasChanges(values.observation, latestObservation)) {
      observation = values.observation;
    }
  }

  return {
    ...values,
    diagnoses,
    medications,
    labs,
    observation,
  };
}

function createDiagnosisKey(value: string): string {
  return value.trim().toLowerCase();
}

function createMedicationKey(medication: { drugName: string; dosage?: string }): string {
  const name = medication.drugName.trim().toLowerCase();
  const dose = medication.dosage ? medication.dosage.trim().toLowerCase() : '';
  return `${name}|${dose}`;
}

function createLabKey(lab: { testName: string; resultValue?: number | null; unit?: string | null }): string {
  const name = lab.testName.trim().toLowerCase();
  const value = lab.resultValue !== undefined && lab.resultValue !== null ? String(lab.resultValue) : '';
  const unit = lab.unit ? lab.unit.trim().toLowerCase() : '';
  return `${name}|${value}|${unit}`;
}

function observationHasChanges(
  next: VisitFormObservationValues,
  latest?: Observation,
): boolean {
  if (!latest) {
    return true;
  }

  if (next.noteText.trim() !== (latest.noteText ?? '').trim()) {
    return true;
  }

  const numericFields = [
    'bpSystolic',
    'bpDiastolic',
    'heartRate',
    'temperatureC',
    'spo2',
    'bmi',
  ] as const satisfies ReadonlyArray<keyof VisitFormObservationValues & keyof Observation>;

  for (const field of numericFields) {
    const nextValue = next[field] ?? null;
    const latestValue = latest[field] ?? null;
    if (nextValue !== latestValue) {
      return true;
    }
  }

  return false;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function getStatusVisuals(
  t: Translate,
): Record<AppointmentStatus, { label: string; chip: string; dot: string }> {
  return {
    Scheduled: {
      label: t('Scheduled'),
      chip: 'bg-blue-50 text-blue-600',
      dot: 'bg-blue-500',
    },
    CheckedIn: {
      label: t('Checked-in'),
      chip: 'bg-amber-50 text-amber-700',
      dot: 'bg-amber-500',
    },
    InProgress: {
      label: t('In progress'),
      chip: 'bg-purple-50 text-purple-700',
      dot: 'bg-purple-500',
    },
    Completed: {
      label: t('Completed'),
      chip: 'bg-green-50 text-green-700',
      dot: 'bg-green-500',
    },
    Cancelled: {
      label: t('Cancelled'),
      chip: 'bg-gray-100 text-gray-500',
      dot: 'bg-gray-400',
    },
  };
}

function parseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const message = (parsed as { error?: string }).error;
        if (message) return message;
      }
    } catch {
      /* ignore */
    }
    return error.message || fallback;
  }
  if (typeof error === 'string') return error;
  return fallback;
}

function formatDateDisplay(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimeRange(startMin: number, endMin: number) {
  return `${formatTime(startMin)} – ${formatTime(endMin)}`;
}

function formatTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = ((hours + 11) % 12) + 1;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function normalizeDateKey(value: string) {
  return value.includes('T') ? value.split('T')[0] : value;
}

function getAppointmentDateTime(appointment: Pick<Appointment, 'date' | 'startTimeMin'>) {
  const base = new Date(appointment.date);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(appointment.startTimeMin);
  return start;
}
