import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import {
  getAppointment,
  getAvailability,
  patchStatus,
  updateAppointment,
  deleteAppointment,
  type Appointment,
  type AppointmentStatus,
  type AppointmentStatusPatch,
  type AvailabilityResponse,
} from '../api/appointments';
import { useAuth } from '../context/AuthProvider';
import {
  getPatient,
  listDoctors,
  listPatientVisits,
  type Doctor,
  type Patient,
  type Visit,
} from '../api/client';

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

type ActionConfig = {
  key: string;
  label: string;
  targetStatus: AppointmentStatusPatch;
  tone: Tone;
  confirm?: boolean;
};

const actionConfigs: ActionConfig[] = [
  { key: 'check-in', label: 'Check-in', targetStatus: 'CheckedIn', tone: 'neutral' },
  { key: 'start', label: 'Start', targetStatus: 'InProgress', tone: 'primary' },
  { key: 'complete', label: 'Complete', targetStatus: 'Completed', tone: 'success' },
  { key: 'cancel', label: 'Cancel', targetStatus: 'Cancelled', tone: 'danger', confirm: true },
];

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

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const message = (parsed as { error?: { message?: string } }).error?.message;
        if (message) return message;
      }
    } catch (err) {
      // ignore JSON parse errors
    }
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong. Please try again.';
}

function toDateInputValue(value: string): string {
  return value.includes('T') ? value.split('T')[0] : value;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
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

function formatDuration(startMin: number, endMin: number) {
  const diff = Math.max(0, endMin - startMin);
  if (diff === 0) return '—';
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
}

function calculateAge(dob: string | undefined) {
  if (!dob) return null;
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

function formatGender(gender?: string | null) {
  if (!gender) return 'Not recorded';
  const normalized = gender.toLowerCase();
  if (normalized === 'm') return 'Male';
  if (normalized === 'f') return 'Female';
  return gender;
}

function findMatchingVisit(appointment: Appointment, visits: Visit[]): string | null {
  const dateKey = toDateInputValue(appointment.date);
  const match = visits.find(
    (visit) =>
      toDateInputValue(visit.visitDate) === dateKey &&
      visit.doctor.doctorId === appointment.doctor.doctorId,
  );
  return match?.visitId ?? null;
}

export default function AppointmentDetail() {
  const { id, adminId } = useParams<{ id: string; adminId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState<string | null>(null);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [doctorId, setDoctorId] = useState('');
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState('');
  const [startTimeMin, setStartTimeMin] = useState<number | ''>('');
  const [endTimeMin, setEndTimeMin] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState<AppointmentStatusPatch | null>(null);

  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [visitId, setVisitId] = useState<string | null>(null);
  const [visitLookupStatus, setVisitLookupStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>(
    'idle',
  );
  const [visitLookupError, setVisitLookupError] = useState<string | null>(null);

  const hydrateForm = useCallback((data: Appointment) => {
    const appointmentDate = toDateInputValue(data.date);
    setDoctorId(data.doctor.doctorId);
    setDepartment(data.department);
    setDate(appointmentDate);
    setStartTimeMin(data.startTimeMin);
    setEndTimeMin(data.endTimeMin);
    setReason(data.reason ?? '');
    setLocation(data.location ?? '');
  }, []);

  useEffect(() => {
    const appointmentId = id;
    if (!appointmentId) {
      setError('Appointment identifier is missing.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAppointment(null);

    async function load(targetId: string) {
      try {
        const data = await getAppointment(targetId);
        if (cancelled) return;
        setAppointment(data);
        hydrateForm(data);
        setSaveSuccess(null);
        setSubmitError(null);
      } catch (err) {
        if (!cancelled) {
          setError(parseErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load(appointmentId);

    return () => {
      cancelled = true;
    };
  }, [hydrateForm, id]);

  useEffect(() => {
    let cancelled = false;
    setDoctorsLoading(true);
    setDoctorError(null);

    async function loadDoctors() {
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
    if (!appointment) {
      setPatient(null);
      setVisitId(null);
      setVisitLookupStatus('idle');
      setVisitLookupError(null);
      return;
    }

    let cancelled = false;
    setPatientLoading(true);
    setPatientError(null);
    setPatient(null);

    async function loadPatient(targetId: string) {
      try {
        const data = await getPatient(targetId);
        if (!cancelled) {
          setPatient(data as Patient);
        }
      } catch (err) {
        if (!cancelled) {
          setPatientError(parseErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setPatientLoading(false);
        }
      }
    }

    loadPatient(appointment.patient.patientId);

    return () => {
      cancelled = true;
    };
  }, [appointment]);

  useEffect(() => {
    if (!editing || !doctorId || !date) {
      setAvailability(null);
      setAvailabilityError(null);
      setAvailabilityLoading(false);
      return;
    }

    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError(null);

    async function loadAvailability(targetDoctorId: string, targetDate: string) {
      try {
        const result = await getAvailability(targetDoctorId, targetDate);
        if (!cancelled) {
          setAvailability(result);
        }
      } catch (err) {
        if (!cancelled) {
          setAvailability(null);
          setAvailabilityError(parseErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setAvailabilityLoading(false);
        }
      }
    }

    loadAvailability(doctorId, date);

    return () => {
      cancelled = true;
    };
  }, [date, doctorId, editing]);

  useEffect(() => {
    if (!appointment || appointment.status !== 'Completed') {
      setVisitLookupStatus('idle');
      setVisitLookupError(null);
      if (!appointment || appointment.status !== 'Completed') {
        setVisitId(null);
      }
      return;
    }

    const completedAppointment = appointment;

    if (visitId) {
      setVisitLookupStatus('ready');
      setVisitLookupError(null);
      return;
    }

    let cancelled = false;
    setVisitLookupStatus('loading');
    setVisitLookupError(null);

    async function locateVisit() {
      try {
        const visits = await listPatientVisits(completedAppointment.patient.patientId);
        if (cancelled) return;
        const match = findMatchingVisit(completedAppointment, visits);
        if (match) {
          setVisitId(match);
          setVisitLookupStatus('ready');
        } else {
          setVisitLookupStatus('missing');
        }
      } catch (err) {
        if (!cancelled) {
          setVisitLookupStatus('error');
          setVisitLookupError(parseErrorMessage(err));
        }
      }
    }

    locateVisit();

    return () => {
      cancelled = true;
    };
  }, [appointment, visitId]);

  const timeOptions = useMemo(() => {
    const options: Array<{ value: number; label: string }> = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      options.push({ value: minutes, label: formatTime(minutes) });
    }
    return options;
  }, []);

  const endTimeOptions = useMemo(() => {
    if (typeof startTimeMin !== 'number') {
      return timeOptions;
    }
    return timeOptions.filter((option) => option.value > startTimeMin);
  }, [startTimeMin, timeOptions]);

  const timeValidationError = useMemo(() => {
    if (typeof startTimeMin === 'number' && typeof endTimeMin === 'number') {
      if (endTimeMin <= startTimeMin) {
        return 'End time must be after the start time.';
      }
    }
    return null;
  }, [endTimeMin, startTimeMin]);

  const selectedDoctor = useMemo(
    () => doctors.find((item) => item.doctorId === doctorId) ?? null,
    [doctorId, doctors],
  );

  const appointmentDateKey = appointment ? toDateInputValue(appointment.date) : '';

  const hasChanges = useMemo(() => {
    if (!appointment) return false;
    if (!doctorId || !date || typeof startTimeMin !== 'number' || typeof endTimeMin !== 'number') {
      return false;
    }
    const reasonValue = reason.trim();
    const locationValue = location.trim();
    return (
      doctorId !== appointment.doctor.doctorId ||
      department.trim() !== appointment.department ||
      date !== appointmentDateKey ||
      startTimeMin !== appointment.startTimeMin ||
      endTimeMin !== appointment.endTimeMin ||
      reasonValue !== (appointment.reason ?? '') ||
      locationValue !== (appointment.location ?? '')
    );
  }, [appointment, appointmentDateKey, date, department, doctorId, endTimeMin, location, reason, startTimeMin]);

  const conflictWarning = useMemo(() => {
    if (!editing) return null;
    if (!appointment) return null;
    if (!availability) return null;
    if (typeof startTimeMin !== 'number' || typeof endTimeMin !== 'number') return null;
    if (!doctorId || !date) return null;
    if (endTimeMin <= startTimeMin) return null;
    const doctorChanged = doctorId !== appointment.doctor.doctorId;
    const dateChanged = date !== appointmentDateKey;
    const startChanged = startTimeMin !== appointment.startTimeMin;
    const endChanged = endTimeMin !== appointment.endTimeMin;
    if (!doctorChanged && !dateChanged && !startChanged && !endChanged) {
      return null;
    }
    const fits = availability.freeSlots.some(
      (slot) => slot.startMin <= startTimeMin && slot.endMin >= endTimeMin,
    );
    if (fits) return null;
    return 'The selected time conflicts with another booking or blackout period for this provider.';
  }, [appointment, appointmentDateKey, availability, date, doctorId, editing, endTimeMin, startTimeMin]);

  const statusActions = useMemo(() => {
    if (!appointment) return [] as ActionConfig[];
    const allowed = allowedTransitions[appointment.status] ?? [];
    return actionConfigs.filter((action) => allowed.includes(action.targetStatus));
  }, [appointment]);

  const patientAge = patient ? calculateAge(patient.dob) : null;

  async function handleStatusChange(targetStatus: AppointmentStatusPatch, confirm?: boolean) {
    if (!appointment) return;
    if (confirm) {
      const confirmed = window.confirm('Cancel this appointment?');
      if (!confirmed) return;
    }

    setStatusError(null);
    setStatusLoading(targetStatus);

    try {
      const result = await patchStatus(appointment.appointmentId, { status: targetStatus });
      if ('visitId' in result) {
        const updated: Appointment = {
          ...appointment,
          status: 'Completed',
          cancelReason: null,
        };
        setAppointment(updated);
        hydrateForm(updated);
        setVisitId(result.visitId);
        setVisitLookupStatus('ready');
        setVisitLookupError(null);
      } else {
        setAppointment(result);
        hydrateForm(result);
        setVisitId(null);
        setVisitLookupStatus(result.status === 'Completed' ? 'loading' : 'idle');
        setVisitLookupError(null);
      }
      setEditing(false);
    } catch (err) {
      setStatusError(parseErrorMessage(err));
    } finally {
      setStatusLoading(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appointment) return;

    setSubmitError(null);
    setSaveSuccess(null);

    if (!doctorId) {
      setSubmitError('Select an attending doctor.');
      return;
    }

    if (!department.trim()) {
      setSubmitError('Department is required.');
      return;
    }

    if (!date) {
      setSubmitError('Choose an appointment date.');
      return;
    }

    if (typeof startTimeMin !== 'number' || typeof endTimeMin !== 'number') {
      setSubmitError('Select both start and end times.');
      return;
    }

    if (timeValidationError) {
      setSubmitError(timeValidationError);
      return;
    }

    const payload: Record<string, unknown> = {};
    if (doctorId !== appointment.doctor.doctorId) {
      payload.doctorId = doctorId;
    }
    const trimmedDepartment = department.trim();
    if (trimmedDepartment !== appointment.department) {
      payload.department = trimmedDepartment;
    }
    if (date !== appointmentDateKey) {
      payload.date = date;
    }
    if (startTimeMin !== appointment.startTimeMin) {
      payload.startTimeMin = startTimeMin;
    }
    if (endTimeMin !== appointment.endTimeMin) {
      payload.endTimeMin = endTimeMin;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason !== (appointment.reason ?? '')) {
      if (trimmedReason) {
        payload.reason = trimmedReason;
      }
    }
    const trimmedLocation = location.trim();
    if (trimmedLocation !== (appointment.location ?? '')) {
      if (trimmedLocation) {
        payload.location = trimmedLocation;
      }
    }

    if (Object.keys(payload).length === 0) {
      setSaveSuccess('No changes to save.');
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const updated = await updateAppointment(appointment.appointmentId, payload);
      setAppointment(updated);
      hydrateForm(updated);
      setEditing(false);
      setSaveSuccess('Appointment updated successfully.');
      setAvailability(null);
      setAvailabilityError(null);
    } catch (err) {
      setSubmitError(parseErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    if (!appointment) return;
    hydrateForm(appointment);
    setSubmitError(null);
    setSaveSuccess(null);
    setEditing(false);
    setAvailability(null);
    setAvailabilityError(null);
  }

  async function handleDelete() {
    if (!appointment) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to delete this appointment for ${appointment.patient.name}? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAppointment(appointment.appointmentId);
      navigate(`/admin/${adminId}/appointments`);
    } catch (err) {
      setDeleteError(parseErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const canDelete = user && ['ITAdmin', 'AdminAssistant'].includes(user.role);

  const headerActions = (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <Link
        to={`/admin/${adminId}/appointments`}
        className="inline-flex items-center justify-center rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-100"
      >
        Back to schedule
      </Link>
    </div>
  );

  const subtitle = appointment
    ? `${formatDate(appointment.date)} · ${formatTimeRange(appointment.startTimeMin, appointment.endTimeMin)}`
    : loading
      ? 'Loading appointment details…'
      : error ?? 'Appointment details unavailable.';

  return (
    <DashboardLayout
      title={appointment ? appointment.patient.name : 'Appointment detail'}
      subtitle={subtitle}
      activeItem="appointments"
      headerChildren={headerActions}
    >
      {loading ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
          <span className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          Loading appointment details...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-600 shadow-sm">
          {error}
        </div>
      ) : appointment ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${
                      statusVisuals[appointment.status].chipClass
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${statusVisuals[appointment.status].dotClass}`}
                      aria-hidden="true"
                    />
                    {statusVisuals[appointment.status].label}
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-gray-900">{appointment.patient.name}</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Appointment ID: {appointment.appointmentId}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Doctor: {appointment.doctor.name} · {appointment.doctor.department}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Location: {appointment.location ? appointment.location : 'Not recorded'}
                  </p>
                  {appointment.status === 'Cancelled' && appointment.cancelReason && (
                    <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      Cancellation reason: {appointment.cancelReason}
                    </p>
                  )}
                  {appointment.status === 'Completed' && (
                    <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {visitId ? (
                        <span>
                          Visit record linked:{' '}
                          <Link
                            className="font-semibold underline"
                            to={`/admin/${adminId}/visits/${visitId}`}
                          >
                            Visit {visitId}
                          </Link>
                        </span>
                      ) : visitLookupStatus === 'loading' ? (
                        <span className="flex items-center gap-2">
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-green-200 border-t-green-600" />
                          Locating visit record...
                        </span>
                      ) : visitLookupStatus === 'missing' ? (
                        <span>No visit record found for this appointment yet.</span>
                      ) : visitLookupStatus === 'error' ? (
                        <span>{visitLookupError}</span>
                      ) : (
                        <span>Visit record details will appear once generated.</span>
                      )}
                    </div>
                  )}
                  {saveSuccess && !editing && (
                    <p className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {saveSuccess}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-stretch gap-3">
                  {statusActions.length > 0 && (
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">Status actions</h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {statusActions.map((action) => {
                          const styles = toneStyles[action.tone];
                          const isLoading = statusLoading === action.targetStatus;
                          const disabled = Boolean(statusLoading) || editing;
                          return (
                            <button
                              key={action.key}
                              type="button"
                              onClick={() => handleStatusChange(action.targetStatus, action.confirm)}
                              disabled={disabled}
                              className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                disabled ? styles.disabled : styles.enabled
                              }`}
                            >
                              {isLoading ? 'Updating…' : action.label}
                            </button>
                          );
                        })}
                      </div>
                      {statusError && (
                        <p className="mt-3 text-sm text-red-600">{statusError}</p>
                      )}
                      {editing && (
                        <p className="mt-3 text-xs text-gray-500">
                          Status updates are disabled while editing appointment details.
                        </p>
                      )}
                    </div>
                  )}
                  {!editing && appointment?.status !== 'Completed' ? (
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(true);
                          setSaveSuccess(null);
                          setSubmitError(null);
                        }}
                        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                      >
                        Edit details
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={deleting}
                          className={`inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold text-white shadow transition ${
                            deleting
                              ? 'cursor-not-allowed bg-gray-400'
                              : 'bg-red-600 hover:bg-red-700'
                          }`}
                        >
                          {deleting ? 'Deleting…' : 'Delete appointment'}
                        </button>
                      )}
                      {deleteError && (
                        <p className="mt-2 text-sm text-red-600">{deleteError}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Scheduling details</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Manage the appointment date, time, and provider assignment.
                  </p>
                </div>
              </div>

              {editing ? (
                <form onSubmit={handleSubmit} className="mt-6 space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="doctor-select">
                        Doctor
                      </label>
                      <select
                        id="doctor-select"
                        value={doctorId}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDoctorId(value);
                          setStartTimeMin('');
                          setEndTimeMin('');
                          const doctor = doctors.find((item) => item.doctorId === value);
                          if (doctor) {
                            setDepartment(doctor.department);
                          }
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      >
                        <option value="">Select a doctor</option>
                        {doctors.map((doctor) => (
                          <option key={doctor.doctorId} value={doctor.doctorId}>
                            {doctor.name} · {doctor.department}
                          </option>
                        ))}
                      </select>
                      {doctorsLoading && (
                        <p className="mt-1 text-xs text-gray-500">Loading doctors…</p>
                      )}
                      {doctorError && <p className="mt-1 text-sm text-red-600">{doctorError}</p>}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="department-input">
                        Department
                      </label>
                      <input
                        id="department-input"
                        type="text"
                        value={department}
                        onChange={(event) => setDepartment(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        placeholder="e.g. Cardiology"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="appointment-date">
                        Date
                      </label>
                      <input
                        id="appointment-date"
                        type="date"
                        value={date}
                        onChange={(event) => {
                          setDate(event.target.value);
                          setStartTimeMin('');
                          setEndTimeMin('');
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700" htmlFor="start-time">
                          Start time
                        </label>
                        <select
                          id="start-time"
                          value={typeof startTimeMin === 'number' ? startTimeMin : ''}
                          onChange={(event) => {
                            const value = event.target.value ? Number(event.target.value) : '';
                            setStartTimeMin(value);
                            if (typeof endTimeMin === 'number' && value !== '' && endTimeMin <= Number(value)) {
                              setEndTimeMin('');
                            }
                          }}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                          <option value="">Select start</option>
                          {timeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700" htmlFor="end-time">
                          End time
                        </label>
                        <select
                          id="end-time"
                          value={typeof endTimeMin === 'number' ? endTimeMin : ''}
                          onChange={(event) => {
                            const value = event.target.value ? Number(event.target.value) : '';
                            setEndTimeMin(value);
                          }}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                          <option value="">Select end</option>
                          {endTimeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {timeValidationError && (
                      <p className="md:col-span-2 text-sm text-red-600">{timeValidationError}</p>
                    )}
                    {conflictWarning && (
                      <p className="md:col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {conflictWarning}
                      </p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="reason-input">
                        Reason for visit
                      </label>
                      <textarea
                        id="reason-input"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        rows={3}
                        placeholder="e.g. Annual physical, follow-up on lab results"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="location-input">
                        Location or room
                      </label>
                      <input
                        id="location-input"
                        type="text"
                        value={location}
                        onChange={(event) => setLocation(event.target.value)}
                        placeholder="e.g. Clinic A · Room 204"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                    </div>
                  </div>

                  {submitError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {submitError}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="inline-flex items-center justify-center rounded-full border border-gray-200 px-5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                      disabled={saving || !hasChanges}
                    >
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="mt-6 grid gap-x-6 gap-y-4 text-sm text-gray-700 md:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Doctor</dt>
                    <dd className="mt-1 font-medium text-gray-900">{appointment.doctor.name}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Department</dt>
                    <dd className="mt-1 font-medium text-gray-900">{appointment.department}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Date</dt>
                    <dd className="mt-1 font-medium text-gray-900">{formatDate(appointment.date)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Time</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {formatTimeRange(appointment.startTimeMin, appointment.endTimeMin)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Duration</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {formatDuration(appointment.startTimeMin, appointment.endTimeMin)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Reason</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {appointment.reason ? appointment.reason : 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Location</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {appointment.location ? appointment.location : 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Created</dt>
                    <dd className="mt-1 font-medium text-gray-900">{formatDateTime(appointment.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Last updated</dt>
                    <dd className="mt-1 font-medium text-gray-900">{formatDateTime(appointment.updatedAt)}</dd>
                  </div>
                </dl>
              )}
            </section>

            {editing ? (
              <section className="rounded-2xl bg-white p-6 shadow-sm">
                <h3 className="text-base font-semibold text-gray-900">Availability preview</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Suggested free windows for {selectedDoctor ? selectedDoctor.name : 'the selected doctor'} on {date || 'the chosen date'}.
                </p>
                <div className="mt-4 space-y-3">
                  {!doctorId || !date ? (
                    <p className="text-sm text-gray-500">Select a doctor and date to check open slots.</p>
                  ) : availabilityLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                      Checking availability…
                    </div>
                  ) : availabilityError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{availabilityError}</div>
                  ) : availability && availability.freeSlots.length > 0 ? (
                    <ul className="space-y-2 text-sm text-blue-700">
                      {availability.freeSlots.map((slot, index) => {
                        const key = `${slot.startMin}-${slot.endMin}-${index}`;
                        return (
                          <li
                            key={key}
                            className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-3 py-2"
                          >
                            <span>
                              {formatTime(slot.startMin)} – {formatTime(slot.endMin)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setStartTimeMin(slot.startMin);
                                setEndTimeMin(slot.endMin);
                                setSubmitError(null);
                              }}
                              className="text-xs font-semibold uppercase tracking-wide text-blue-700 hover:text-blue-900"
                            >
                              Use slot
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">No open slots remain for this day. Consider another time.</p>
                  )}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Patient</h3>
              {patientLoading ? (
                <p className="mt-3 text-sm text-gray-500">Loading patient information…</p>
              ) : patientError ? (
                <p className="mt-3 text-sm text-red-600">{patientError}</p>
              ) : patient ? (
                <dl className="mt-4 space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Patient ID</dt>
                    <dd className="font-medium text-gray-900">{patient.patientId}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Date of birth</dt>
                    <dd className="font-medium text-gray-900">
                      {formatDate(patient.dob)}
                      {patientAge !== null ? ` · ${patientAge} yrs` : ''}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Gender</dt>
                    <dd className="font-medium text-gray-900">{formatGender(patient.gender)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Contact</dt>
                    <dd className="text-right font-medium text-gray-900">
                      {patient.contact ? patient.contact : 'Not provided'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Coverage</dt>
                    <dd className="font-medium text-gray-900">
                      {patient.insurance ? patient.insurance : 'Self-pay'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Profile</dt>
                    <dd>
                      <Link
                        to={`/admin/${adminId}/patients/${patient.patientId}`}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                      >
                        View full record
                      </Link>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-gray-500">Patient details unavailable.</p>
              )}
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Doctor</h3>
              <dl className="mt-4 space-y-3 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Doctor ID</dt>
                  <dd className="font-medium text-gray-900">{appointment.doctor.doctorId}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Department</dt>
                  <dd className="font-medium text-gray-900">{appointment.doctor.department}</dd>
                </div>
              </dl>
            </section>

            {!editing && (
              <section className="rounded-2xl bg-white p-6 shadow-sm">
                <h3 className="text-base font-semibold text-gray-900">Summary</h3>
                <dl className="mt-4 space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Status</dt>
                    <dd className="font-medium text-gray-900">{statusVisuals[appointment.status].label}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Last updated</dt>
                    <dd className="text-right font-medium text-gray-900">{formatDateTime(appointment.updatedAt)}</dd>
                  </div>
                </dl>
              </section>
            )}
          </aside>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
