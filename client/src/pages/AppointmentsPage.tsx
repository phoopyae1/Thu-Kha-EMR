import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { CalendarIcon } from '../components/icons';
import {
  listAppointments,
  patchStatus,
  type Appointment,
  type AppointmentListParams,
  type AppointmentStatus,
  type AppointmentStatusPatch,
} from '../api/appointments';
import { listDoctors, type Doctor } from '../api/client';
import { useAuth } from '../context/AuthProvider';
import { useTranslation } from '../hooks/useTranslation';

const DAY_START_MINUTE = 8 * 60;
const DAY_END_MINUTE = 18 * 60;
const DAY_VISIBLE_MINUTES = DAY_END_MINUTE - DAY_START_MINUTE;
const MIN_SLOT_MINUTES = 30;

type DateMode = 'single' | 'range';

type ToastState = {
  id: number;
  title: string;
  titleParams?: Record<string, string | number>;
  message: string;
  messageParams?: Record<string, string | number>;
  link?: { to: string; label: string; labelParams?: Record<string, string | number> };
};

const allowedTransitions: Record<AppointmentStatus, AppointmentStatusPatch[]> = {
  Scheduled: ['CheckedIn', 'Cancelled'],
  CheckedIn: ['InProgress', 'Cancelled'],
  InProgress: ['Completed'],
  Completed: [],
  Cancelled: [],
};

const statusVisuals: Record<AppointmentStatus, { label: string; chipClass: string; dotClass: string }> = {
  Scheduled: {
    label: 'Scheduled',
    chipClass: 'border-blue-200 bg-blue-50 text-blue-600',
    dotClass: 'bg-blue-500',
  },
  CheckedIn: {
    label: 'Checked-in',
    chipClass: 'border-amber-200 bg-amber-50 text-amber-700',
    dotClass: 'bg-amber-500',
  },
  InProgress: {
    label: 'In progress',
    chipClass: 'border-purple-200 bg-purple-50 text-purple-600',
    dotClass: 'bg-purple-500',
  },
  Completed: {
    label: 'Completed',
    chipClass: 'border-green-200 bg-green-50 text-green-700',
    dotClass: 'bg-green-500',
  },
  Cancelled: {
    label: 'Cancelled',
    chipClass: 'border-gray-200 bg-gray-100 text-gray-600',
    dotClass: 'bg-gray-400',
  },
};

type Tone = 'neutral' | 'primary' | 'success' | 'danger';

const toneStyles: Record<Tone, { enabled: string; disabled: string }> = {
  neutral: {
    enabled: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-400',
    disabled: 'bg-gray-100 text-gray-300 cursor-not-allowed',
  },
  primary: {
    enabled: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    disabled: 'bg-blue-200 text-blue-300 cursor-not-allowed',
  },
  success: {
    enabled: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
    disabled: 'bg-green-200 text-green-300 cursor-not-allowed',
  },
  danger: {
    enabled: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    disabled: 'bg-red-200 text-red-300 cursor-not-allowed',
  },
};

const actionConfigs: Array<{
  key: string;
  label: string;
  targetStatus: AppointmentStatusPatch;
  tone: Tone;
  confirm?: boolean;
}> = [
  { key: 'check-in', label: 'Check-in', targetStatus: 'CheckedIn', tone: 'neutral' },
  { key: 'start', label: 'Start', targetStatus: 'InProgress', tone: 'primary' },
  { key: 'complete', label: 'Complete', targetStatus: 'Completed', tone: 'success' },
  { key: 'cancel', label: 'Cancel', targetStatus: 'Cancelled', tone: 'danger', confirm: true },
];

const statusOptions: AppointmentStatus[] = ['Scheduled', 'CheckedIn', 'InProgress', 'Completed', 'Cancelled'];

function toDateKey(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value.includes('T') ? value.split('T')[0] : value;
}

function getWeekStart(date: Date): Date {
  const weekStart = new Date(date);
  const day = weekStart.getDay();
  const diff = (day + 6) % 7;
  weekStart.setDate(weekStart.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function clampMinutes(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBlock(startTimeMin: number, endTimeMin?: number) {
  const safeStart = clampMinutes(startTimeMin, DAY_START_MINUTE, DAY_END_MINUTE - MIN_SLOT_MINUTES);
  const proposedEnd =
    typeof endTimeMin === 'number' ? clampMinutes(endTimeMin, safeStart + MIN_SLOT_MINUTES, DAY_END_MINUTE) : null;
  const fallbackEnd = clampMinutes(safeStart + 60, safeStart + MIN_SLOT_MINUTES, DAY_END_MINUTE);
  const safeEnd = proposedEnd ?? fallbackEnd;
  const top = ((safeStart - DAY_START_MINUTE) / DAY_VISIBLE_MINUTES) * 100;
  const rawHeight = ((safeEnd - safeStart) / DAY_VISIBLE_MINUTES) * 100;
  const minHeight = (MIN_SLOT_MINUTES / DAY_VISIBLE_MINUTES) * 100;
  const availableSpace = Math.max(0, 100 - top);
  const height = Math.min(Math.max(rawHeight, minHeight), Math.max(minHeight, availableSpace));
  return { top, height };
}

function formatHourLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = ((hours + 11) % 12) + 1;
  return `${displayHours}:00 ${suffix}`;
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const message = (parsed as { error?: { message?: string } }).error?.message;
        if (message) return message;
      }
    } catch (err) {
      // ignore JSON parse errors and fall back to raw message
    }
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong. Please try again.';
}

function formatDateDisplay(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(minutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = ((hours + 11) % 12) + 1;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

function formatTimeRange(startMin: number, endMin: number) {
  if (endMin <= startMin) {
    return formatTime(startMin);
  }
  return `${formatTime(startMin)} – ${formatTime(endMin)}`;
}

export default function AppointmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userRole = user?.role ?? 'ITAdmin';
  const isDoctorUser = userRole === 'Doctor';
  const canCreateAppointment = userRole === 'AdminAssistant' || userRole === 'ITAdmin';
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dateMode, setDateMode] = useState<DateMode>('single');
  const [singleDate, setSingleDate] = useState(() => toDateKey(new Date()));
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('');
  const [refreshToken, setRefreshToken] = useState(0);

  const [calendarView, setCalendarView] = useState<'day' | 'week'>('day');

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const effectiveDoctorId = isDoctorUser ? user?.doctorId ?? '' : doctorId;

  useEffect(() => {
    if (isDoctorUser) {
      setDoctorId(user?.doctorId ?? '');
    }
  }, [isDoctorUser, user?.doctorId]);

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const focusDateKey = useMemo(() => {
    if (dateMode === 'single') {
      return singleDate || todayKey;
    }
    if (fromDate) return fromDate;
    if (toDate) return toDate;
    return todayKey;
  }, [dateMode, singleDate, fromDate, toDate, todayKey]);

  const focusDate = useMemo(() => {
    const parsed = new Date(`${focusDateKey}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return new Date(`${todayKey}T00:00:00`);
    }
    return parsed;
  }, [focusDateKey, todayKey]);

  const hourMarkers = useMemo(() => {
    const markers: number[] = [];
    for (let minute = DAY_START_MINUTE; minute <= DAY_END_MINUTE; minute += 60) {
      markers.push(minute);
    }
    return markers;
  }, []);

  const allowedActionKeys = useMemo(() => {
    if (userRole === 'Doctor') {
      return ['start', 'complete'];
    }
    if (userRole === 'AdminAssistant') {
      return ['check-in', 'cancel'];
    }
    return ['check-in', 'start', 'complete', 'cancel'];
  }, [userRole]);

  const visibleActionConfigs = useMemo(
    () => actionConfigs.filter((action) => allowedActionKeys.includes(action.key)),
    [allowedActionKeys],
  );

  const gridMarkers = useMemo(() => {
    const markers: number[] = [];
    for (let minute = DAY_START_MINUTE; minute <= DAY_END_MINUTE; minute += MIN_SLOT_MINUTES) {
      markers.push(minute);
    }
    return markers;
  }, []);

  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.forEach((appointment) => {
      const key = toDateKey(appointment.date);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(appointment);
    });
    map.forEach((list) => list.sort((a, b) => a.startTimeMin - b.startTimeMin));
    return map;
  }, [appointments]);

  const dayAppointments = useMemo(
    () => appointmentsByDate.get(focusDateKey) ?? [],
    [appointmentsByDate, focusDateKey],
  );

  const weekDates = useMemo(() => {
    const start = getWeekStart(focusDate);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [focusDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadDoctors() {
      setDoctorsLoading(true);
      setDoctorError(null);
      try {
        const list = await listDoctors();
        if (!cancelled) {
          setDoctors(list);
        }
      } catch (err) {
        if (!cancelled) {
          setDoctorError(parseErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setDoctorsLoading(false);
        }
      }
    }

    loadDoctors();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAppointments() {
      setLoading(true);
      setError(null);
      try {
        const params: AppointmentListParams = { limit: 50 };
        if (dateMode === 'single') {
          if (singleDate) {
            params.date = singleDate;
          }
        } else {
          if (fromDate) params.from = fromDate;
          if (toDate) params.to = toDate;
        }
        if (effectiveDoctorId) {
          params.doctorId = effectiveDoctorId;
        }
        if (statusFilter) {
          params.status = statusFilter;
        }

        const result = await listAppointments(params);
        if (!cancelled) {
          setAppointments(result.data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(parseErrorMessage(err));
          setAppointments([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAppointments();

    return () => {
      cancelled = true;
    };
  }, [dateMode, singleDate, fromDate, toDate, effectiveDoctorId, statusFilter, refreshToken]);

  useEffect(() => {
    if (!toast) return undefined;
    const handle = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const headerActions = canCreateAppointment ? (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <Link
        to="/appointments/new"
        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
      >
        {t('New Appointment')}
      </Link>
    </div>
  ) : null;

  const hasActiveFilters =
    (dateMode === 'single' ? Boolean(singleDate) : Boolean(fromDate || toDate)) ||
    (!isDoctorUser && doctorId !== '') ||
    statusFilter !== '';

  function handleClearFilters() {
    setDateMode('single');
    setSingleDate('');
    setFromDate('');
    setToDate('');
    setDoctorId(isDoctorUser ? user?.doctorId ?? '' : '');
    setStatusFilter('');
  }

  function isUpdating(id: string) {
    return Boolean(updating[id]);
  }

  async function handleStatusChange(
    appointment: Appointment,
    targetStatus: AppointmentStatusPatch,
    requireConfirm?: boolean,
  ) {
    if (requireConfirm) {
      const confirmed = window.confirm(t('Cancel this appointment?'));
      if (!confirmed) return;
    }

    setActionError(null);
    setUpdating((prev) => ({ ...prev, [appointment.appointmentId]: true }));

    try {
      const result = await patchStatus(appointment.appointmentId, { status: targetStatus });

      if ('visitId' in result) {
        setAppointments((current) =>
          current.map((item) =>
            item.appointmentId === appointment.appointmentId
              ? { ...item, status: 'Completed', cancelReason: null }
              : item,
          ),
        );
        setToast({
          id: Date.now(),
          title: 'Visit created',
          message: 'A visit was created for {name}.',
          messageParams: { name: appointment.patient.name },
          link: { to: `/visits/${result.visitId}`, label: 'Open visit details' },
        });
      } else {
        setAppointments((current) =>
          current.map((item) => (item.appointmentId === result.appointmentId ? result : item)),
        );
      }
    } catch (err) {
      setActionError(parseErrorMessage(err));
    } finally {
      setUpdating((prev) => {
        const next = { ...prev };
        delete next[appointment.appointmentId];
        return next;
      });
    }
  }

  function handleRefresh() {
    setRefreshToken((token) => token + 1);
  }

  function openAppointmentDetail(id: string) {
    navigate(`/appointments/${id}`);
  }

  function openCreateSlot(dateKey: string, startMinute: number, endMinute: number) {
    if (!canCreateAppointment) return;
    const params = new URLSearchParams();
    params.set('date', dateKey);
    params.set('start', String(startMinute));
    params.set('end', String(endMinute));
    navigate(`/appointments/new?${params.toString()}`);
  }

  function handleDayGridClick(event: MouseEvent<HTMLDivElement>) {
    if (!canCreateAppointment) return;
    const { currentTarget } = event;
    if (!currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const ratio = offset / rect.height;
    const snappedMinutes = Math.round((ratio * DAY_VISIBLE_MINUTES) / MIN_SLOT_MINUTES) * MIN_SLOT_MINUTES;
    const startMinute = clampMinutes(
      DAY_START_MINUTE + snappedMinutes,
      DAY_START_MINUTE,
      DAY_END_MINUTE - MIN_SLOT_MINUTES,
    );
    const endMinute = clampMinutes(startMinute + 60, startMinute + MIN_SLOT_MINUTES, DAY_END_MINUTE);
    openCreateSlot(focusDateKey, startMinute, endMinute);
  }

  function handleWeekGridClick(dateKey: string) {
    return (event: MouseEvent<HTMLDivElement>) => {
      if (!canCreateAppointment) return;
      const { currentTarget } = event;
      if (!currentTarget) return;
      const rect = currentTarget.getBoundingClientRect();
      const offset = event.clientY - rect.top;
      const ratio = offset / rect.height;
      const snappedMinutes = Math.round((ratio * DAY_VISIBLE_MINUTES) / MIN_SLOT_MINUTES) * MIN_SLOT_MINUTES;
      const startMinute = clampMinutes(
        DAY_START_MINUTE + snappedMinutes,
        DAY_START_MINUTE,
        DAY_END_MINUTE - MIN_SLOT_MINUTES,
      );
      const endMinute = clampMinutes(startMinute + 60, startMinute + MIN_SLOT_MINUTES, DAY_END_MINUTE);
      openCreateSlot(dateKey, startMinute, endMinute);
    };
  }

  const focusDateDisplay = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return formatter.format(focusDate);
  }, [focusDate]);

  return (
    <DashboardLayout
      title={t('Appointments')}
      subtitle={t('Monitor and manage patient visits as they progress through the day.')}
      activeItem="appointments"
      headerChildren={headerActions}
    >
      <>
        {toast && (
          <div className="pointer-events-none fixed bottom-6 right-6 z-50">
            <div className="pointer-events-auto flex w-80 items-start gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-black/5">
              <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-green-500" aria-hidden="true" />
              <div className="flex-1 text-sm">
                <div className="font-semibold text-gray-900">{t(toast.title, toast.titleParams)}</div>
                <p className="mt-1 text-gray-600">{t(toast.message, toast.messageParams)}</p>
                {toast.link && (
                  <Link
                    to={toast.link.to}
                    className="mt-3 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
                    onClick={() => setToast(null)}
                  >
                    {t(toast.link.label, toast.link.labelParams)}
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="-mr-2 rounded-full p-1 text-gray-400 transition hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <span className="sr-only">Dismiss</span>
                ×
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Filters')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('Refine appointments by schedule, doctor, or status.')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  {t('Refresh')}
                </button>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  disabled={!hasActiveFilters}
                  className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition ${
                    hasActiveFilters
                      ? 'border border-gray-200 text-gray-700 hover:bg-gray-100'
                      : 'border border-gray-100 text-gray-300'
                  }`}
                >
                  {t('Clear filters')}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('Date')}</div>
                <div className="flex flex-wrap gap-3">
                  <div className="inline-flex overflow-hidden rounded-full border border-gray-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => setDateMode('single')}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        dateMode === 'single'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {t('Single day')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateMode('range')}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        dateMode === 'range'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {t('Date range')}
                    </button>
                  </div>
                </div>
                {dateMode === 'single' ? (
                  <div className="flex flex-wrap gap-3">
                    <input
                      type="date"
                      value={singleDate}
                      onChange={(event) => setSingleDate(event.target.value)}
                      className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 lg:w-auto"
                    />
                    <span className="self-center text-xs text-gray-400">{t('Leave blank to show all dates')}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(event) => setFromDate(event.target.value)}
                      className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 sm:w-auto"
                      placeholder={t('From')}
                    />
                    <span className="text-sm text-gray-400">{t('to')}</span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(event) => setToDate(event.target.value)}
                      className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 sm:w-auto"
                      placeholder={t('To')}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('Doctor')}</div>
                <select
                  value={effectiveDoctorId}
                  onChange={(event) => setDoctorId(event.target.value)}
                  disabled={isDoctorUser}
                  className={`w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                    isDoctorUser ? 'cursor-not-allowed bg-gray-100 text-gray-500' : ''
                  }`}
                >
                  <option value="">{t('All doctors')}</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.doctorId} value={doctor.doctorId}>
                      {doctor.name} — {doctor.department}
                    </option>
                  ))}
                </select>
                {isDoctorUser ? (
                  <p className="text-xs text-gray-400">{t('Viewing your schedule.')}</p>
                ) : doctorError ? (
                  <p className="text-xs text-red-600">{t(doctorError)}</p>
                ) : doctorsLoading ? (
                  <p className="text-xs text-gray-400">{t('Loading doctors...')}</p>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('Status')}</div>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === '') {
                      setStatusFilter('');
                    } else {
                      setStatusFilter(value as AppointmentStatus);
                    }
                  }}
                  className="w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">{t('All statuses')}</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {t(statusVisuals[status].label)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Schedule overview')}</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {calendarView === 'day'
                    ? focusDateDisplay
                    : t('Week of {date}', { date: focusDateDisplay })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex overflow-hidden rounded-full border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setCalendarView('day')}
                    className={`px-4 py-2 text-sm font-medium transition ${
                      calendarView === 'day' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t('Day view')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarView('week')}
                    className={`px-4 py-2 text-sm font-medium transition ${
                      calendarView === 'week' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t('Week view')}
                  </button>
                </div>
                {canCreateAppointment && (
                  <button
                    type="button"
                    onClick={() =>
                      openCreateSlot(
                        focusDateKey,
                        DAY_START_MINUTE,
                        clampMinutes(DAY_START_MINUTE + 60, DAY_START_MINUTE + MIN_SLOT_MINUTES, DAY_END_MINUTE),
                      )
                    }
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    {t('Add at 8:00 AM')}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {calendarView === 'day' ? (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                  <div className="relative h-[600px] select-none pr-2 text-right text-xs text-gray-400">
                    {hourMarkers.map((minute) => {
                      const offset = ((minute - DAY_START_MINUTE) / DAY_VISIBLE_MINUTES) * 100;
                      return (
                        <div
                          key={`day-axis-${minute}`}
                          className="absolute right-0 -translate-y-1/2"
                          style={{ top: `${offset}%` }}
                        >
                          {formatHourLabel(minute)}
                        </div>
                      );
                    })}
                  </div>
                  <div
                    role="presentation"
                    className="relative h-[600px] rounded-2xl border border-gray-200 bg-gray-50"
                    onClick={handleDayGridClick}
                  >
                    {gridMarkers.map((minute) => {
                      const offset = ((minute - DAY_START_MINUTE) / DAY_VISIBLE_MINUTES) * 100;
                      const isHour = minute % 60 === 0;
                      return (
                        <div
                          key={`day-grid-${minute}`}
                          className={`absolute inset-x-0 border-t ${
                            isHour ? 'border-gray-200' : 'border-dashed border-gray-200/70'
                          }`}
                          style={{ top: `${offset}%` }}
                        />
                      );
                    })}
                    {dayAppointments.length === 0 && (
                      <div className="pointer-events-none absolute left-1/2 top-1/2 w-56 -translate-x-1/2 -translate-y-1/2 text-center text-sm text-gray-400">
                        {t('Click anywhere on the grid to schedule a new appointment.')}
                      </div>
                    )}
                    {dayAppointments.map((appointment) => {
                      const { top, height } = normalizeBlock(appointment.startTimeMin, appointment.endTimeMin);
                      return (
                        <button
                          key={appointment.appointmentId}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openAppointmentDetail(appointment.appointmentId);
                          }}
                          className="absolute left-1 right-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-medium text-blue-900 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          style={{ top: `${top}%`, height: `${height}%` }}
                        >
                          <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 leading-tight">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                              {appointment.doctor.name}
                            </span>
                            <span className="text-sm font-semibold text-blue-900">
                              {appointment.patient.name}
                            </span>
                            <span className="ml-auto text-[11px] font-medium text-blue-700">
                              {formatTimeRange(appointment.startTimeMin, appointment.endTimeMin)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] items-end gap-4">
                    <div className="text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Time</div>
                    {weekDates.map((date) => {
                      const dateKey = toDateKey(date);
                      return (
                        <div key={`week-label-${dateKey}`} className="text-center">
                          <div
                            className={`text-sm font-semibold ${
                              dateKey === focusDateKey ? 'text-blue-600' : 'text-gray-900'
                            }`}
                          >
                            {date.toLocaleDateString(undefined, { weekday: 'short' })}
                          </div>
                          <div className="text-xs text-gray-500">
                            {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-4">
                    <div className="relative h-[600px] select-none pr-2 text-right text-xs text-gray-400">
                      {hourMarkers.map((minute) => {
                        const offset = ((minute - DAY_START_MINUTE) / DAY_VISIBLE_MINUTES) * 100;
                        return (
                          <div
                            key={`week-axis-${minute}`}
                            className="absolute right-0 -translate-y-1/2"
                            style={{ top: `${offset}%` }}
                          >
                            {formatHourLabel(minute)}
                          </div>
                        );
                      })}
                    </div>
                    {weekDates.map((date) => {
                      const dateKey = toDateKey(date);
                      const columnAppointments = appointmentsByDate.get(dateKey) ?? [];
                      return (
                        <div
                          key={`week-col-${dateKey}`}
                          role="presentation"
                          className={`relative h-[600px] rounded-2xl border border-gray-200 bg-gray-50 ${
                            dateKey === focusDateKey ? 'ring-1 ring-blue-200' : ''
                          }`}
                          onClick={handleWeekGridClick(dateKey)}
                        >
                          <div className="pointer-events-none absolute inset-0">
                            {gridMarkers.map((minute) => {
                              const offset = ((minute - DAY_START_MINUTE) / DAY_VISIBLE_MINUTES) * 100;
                              const isHour = minute % 60 === 0;
                              return (
                                <div
                                  key={`week-grid-${dateKey}-${minute}`}
                                  className={`absolute inset-x-0 border-t ${
                                    isHour ? 'border-gray-200' : 'border-dashed border-gray-200/70'
                                  }`}
                                  style={{ top: `${offset}%` }}
                                />
                              );
                            })}
                          </div>
                          {columnAppointments.length === 0 && (
                            <div className="pointer-events-none absolute left-1/2 top-1/2 w-40 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] text-gray-400">
                              {t('Click to add')}
                            </div>
                          )}
                          {columnAppointments.map((appointment) => {
                            const { top, height } = normalizeBlock(appointment.startTimeMin, appointment.endTimeMin);
                            return (
                              <button
                                key={appointment.appointmentId}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAppointmentDetail(appointment.appointmentId);
                                }}
                                className="absolute left-1 right-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-medium text-blue-900 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ top: `${top}%`, height: `${height}%` }}
                              >
                                <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 leading-tight">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                                    {appointment.doctor.name}
                                  </span>
                                  <span className="text-sm font-semibold text-blue-900">
                                    {appointment.patient.name}
                                  </span>
                                  <span className="ml-auto text-[11px] font-medium text-blue-700">
                                    {formatTimeRange(appointment.startTimeMin, appointment.endTimeMin)}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {actionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {t(actionError)}
            </div>
          )}

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Scheduled Appointments')}</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {loading
                    ? t('Loading appointments...')
                    : error
                      ? t('Unable to load appointments right now.')
                      : appointments.length === 1
                        ? t('Showing {count} appointment.', { count: appointments.length })
                        : t('Showing {count} appointments.', { count: appointments.length })}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                {t('Refresh list')}
              </button>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-gray-100">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <CalendarIcon className="h-10 w-10 animate-spin text-blue-500" />
                  <div className="text-sm font-medium text-gray-700">{t('Fetching the latest appointments...')}</div>
                  <p className="text-xs text-gray-500">{t('Please wait while we load the schedule.')}</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <CalendarIcon className="h-10 w-10 text-red-300" />
                  <div className="text-sm font-medium text-red-600">{t(error)}</div>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    {t('Try again')}
                  </button>
                </div>
              ) : appointments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-6 py-3">{t('Time')}</th>
                        <th className="px-6 py-3">{t('Patient')}</th>
                        <th className="px-6 py-3">{t('Doctor')}</th>
                        <th className="px-6 py-3">{t('Department')}</th>
                        <th className="px-6 py-3">{t('Status')}</th>
                        <th className="px-6 py-3 text-right">{t('Actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {appointments.map((appointment) => {
                        const visuals = statusVisuals[appointment.status];
                        const busy = isUpdating(appointment.appointmentId);
                        return (
                          <tr key={appointment.appointmentId} className="transition hover:bg-blue-50/40">
                            <td className="px-6 py-4 align-top">
                              <div className="font-medium text-gray-900">
                                {formatTimeRange(appointment.startTimeMin, appointment.endTimeMin)}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">{formatDateDisplay(appointment.date)}</div>
                            </td>
                            <td className="px-6 py-4 align-top">
                              <div className="font-medium text-gray-900">{appointment.patient.name}</div>
                              <div className="mt-1 text-xs text-gray-500">{t('ID: {id}', { id: appointment.patient.patientId })}</div>
                            </td>
                            <td className="px-6 py-4 align-top">
                              <div className="font-medium text-gray-900">{appointment.doctor.name}</div>
                              <div className="mt-1 text-xs text-gray-500">{t('ID: {id}', { id: appointment.doctor.doctorId })}</div>
                            </td>
                            <td className="px-6 py-4 align-top text-gray-700">{appointment.department}</td>
                            <td className="px-6 py-4 align-top">
                              <span
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${visuals.chipClass}`}
                              >
                                <span className={`h-2 w-2 rounded-full ${visuals.dotClass}`} aria-hidden="true" />
                                {t(visuals.label)}
                              </span>
                            </td>
                            <td className="px-6 py-4 align-top text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                {visibleActionConfigs.map((action) => {
                                  const allowed = allowedTransitions[appointment.status]?.includes(action.targetStatus) ?? false;
                                  const enabled = allowed && !busy;
                                  const tone = toneStyles[action.tone];
                                  const className = `inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                    enabled ? tone.enabled : tone.disabled
                                  }`;
                                  return (
                                    <button
                                      key={action.key}
                                      type="button"
                                      disabled={!enabled}
                                      onClick={() =>
                                        handleStatusChange(appointment, action.targetStatus, action.confirm)
                                      }
                                      className={className}
                                    >
                                      {t(action.label)}
                                    </button>
                                  );
                                })}
                              </div>
                              {busy && (
                                <div className="mt-2 text-xs font-medium text-blue-600">{t('Updating status...')}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <CalendarIcon className="h-10 w-10 text-gray-300" />
                  <div className="text-sm font-medium text-gray-700">
                    {t('No appointments match the selected filters.')}
                  </div>
                  <p className="text-xs text-gray-500">{t('Adjust the filters to explore more of the schedule.')}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </>
    </DashboardLayout>
  );
}
