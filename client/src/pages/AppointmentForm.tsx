import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { listDoctors, searchPatients, type Doctor } from '../api/client';
import {
  createAppointment,
  getAppointment,
  getAvailability,
  updateAppointment,
  type Appointment,
  type AvailabilitySlot,
} from '../api/appointments';

const MINUTES_IN_DAY = 24 * 60;
const APPOINTMENT_SLOT_MINUTES = 15;

type PatientOption = {
  patientId: string;
  name: string;
  dob?: string;
};

type AppointmentFormParams = {
  adminId: string;
  id?: string;
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
      // ignore JSON parse errors and fall back to raw message
    }
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Something went wrong. Please try again.';
}

function formatTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY, minutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = ((hours + 11) % 12) + 1;
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

function formatDateDisplay(date: string | undefined): string {
  if (!date) return 'Select a date';
  const safeDate = `${date}T00:00:00`;
  const parsed = new Date(safeDate);
  if (Number.isNaN(parsed.getTime())) {
    return 'Select a valid date';
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function parseMinuteParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(MINUTES_IN_DAY, parsed));
}

function deriveDefaultEnd(start: number): number | null {
  const preferred = start + APPOINTMENT_SLOT_MINUTES;
  if (preferred < MINUTES_IN_DAY) {
    return preferred;
  }
  return null;
}

function expandAvailabilityToSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const expanded: AvailabilitySlot[] = [];

  for (const slot of slots) {
    const safeStart = Math.max(0, Math.min(slot.startMin, MINUTES_IN_DAY));
    const safeEnd = Math.max(0, Math.min(slot.endMin, MINUTES_IN_DAY));

    if (safeEnd - safeStart < APPOINTMENT_SLOT_MINUTES) {
      continue;
    }

    const alignedStart = Math.ceil(safeStart / APPOINTMENT_SLOT_MINUTES) * APPOINTMENT_SLOT_MINUTES;

    for (
      let current = alignedStart;
      current + APPOINTMENT_SLOT_MINUTES <= safeEnd && current + APPOINTMENT_SLOT_MINUTES < MINUTES_IN_DAY;
      current += APPOINTMENT_SLOT_MINUTES
    ) {
      expanded.push({ startMin: current, endMin: current + APPOINTMENT_SLOT_MINUTES });
    }
  }

  return expanded.sort((a, b) =>
    a.startMin === b.startMin ? a.endMin - b.endMin : a.startMin - b.startMin,
  );
}

export default function AppointmentForm() {
  const navigate = useNavigate();
  const { adminId, id: appointmentId } = useParams<AppointmentFormParams>();
  const [searchParams] = useSearchParams();
  const isEditing = Boolean(appointmentId);

  const searchParamsKey = searchParams.toString();
  const slotDateParam = searchParams.get('date');
  const slotStartParam = parseMinuteParam(searchParams.get('start'));
  const slotEndParam = parseMinuteParam(searchParams.get('end'));
  const initialDateValue = slotDateParam || new Date().toISOString().slice(0, 10);
  const initialStartValue = slotStartParam ?? null;
  const initialEndValue =
    slotEndParam !== null
      ? slotEndParam
      : initialStartValue !== null
        ? deriveDefaultEnd(initialStartValue)
        : null;

  const [patientInput, setPatientInput] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState<string | null>(null);
  const [patientTouched, setPatientTouched] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState('');

  const [department, setDepartment] = useState('');
  const [date, setDate] = useState(() => initialDateValue);
  const [startTimeMin, setStartTimeMin] = useState<number | ''>(() =>
    initialStartValue !== null ? initialStartValue : '',
  );
  const [endTimeMin, setEndTimeMin] = useState<number | ''>(() =>
    initialEndValue !== null ? initialEndValue : '',
  );
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');

  const [freeSlots, setFreeSlots] = useState<AvailabilitySlot[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(isEditing);

  useEffect(() => {
    let cancelled = false;

    async function loadDoctors() {
      setDoctorsLoading(true);
      setDoctorError(null);
      try {
        const doctorList = await listDoctors();
        if (!cancelled) {
          setDoctors(doctorList);
        }
      } catch (error) {
        if (!cancelled) {
          setDoctorError(parseErrorMessage(error));
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
    if (!isEditing || !appointmentId) return;

    let cancelled = false;

    async function loadAppointment(targetId: string) {
      setInitializing(true);
      try {
        const appointment = await getAppointment(targetId);
        if (cancelled) return;

        hydrateForm(appointment);
      } catch (error) {
        if (!cancelled) {
          setSubmitError(parseErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    loadAppointment(appointmentId);

    return () => {
      cancelled = true;
    };
  }, [appointmentId, isEditing]);

  useEffect(() => {
    if (!patientQuery) {
      setPatientResults([]);
      setPatientError(null);
      return;
    }

    if (selectedPatient && patientQuery === selectedPatient.name) {
      setPatientResults([]);
      setPatientError(null);
      return;
    }

    if (patientQuery.length < 2) {
      setPatientResults([]);
      setPatientError(null);
      return;
    }

    let cancelled = false;

    async function search() {
      setPatientLoading(true);
      setPatientError(null);
      try {
        const matches = await searchPatients(patientQuery);
        if (!cancelled) {
          const options = matches.map((patient) => ({
            patientId: patient.patientId,
            name: patient.name,
            dob: patient.dob,
          }));
          setPatientResults(options);
        }
      } catch (error) {
        if (!cancelled) {
          setPatientResults([]);
          setPatientError(parseErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setPatientLoading(false);
        }
      }
    }

    const handle = setTimeout(search, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [patientQuery, selectedPatient]);

  useEffect(() => {
    if (!doctorId || !date) {
      setFreeSlots([]);
      setAvailabilityError(null);
      return;
    }

    let cancelled = false;

    async function fetchAvailability() {
      setAvailabilityLoading(true);
      setAvailabilityError(null);
      try {
        const availability = await getAvailability(doctorId, date);
        if (!cancelled) {
          setFreeSlots(expandAvailabilityToSlots(availability.freeSlots));
        }
      } catch (error) {
        if (!cancelled) {
          setFreeSlots([]);
          setAvailabilityError(parseErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setAvailabilityLoading(false);
        }
      }
    }

    fetchAvailability();

    return () => {
      cancelled = true;
    };
  }, [doctorId, date]);

  useEffect(() => {
    if (isEditing) return;

    const params = new URLSearchParams(searchParamsKey);
    const nextDate = params.get('date');
    const nextStart = parseMinuteParam(params.get('start'));
    const nextEnd = parseMinuteParam(params.get('end'));

    if (nextDate) {
      setDate(nextDate);
    }

    if (nextStart !== null) {
      setStartTimeMin(nextStart);
    }

    if (nextEnd !== null) {
      setEndTimeMin(nextEnd);
    } else if (nextStart !== null) {
      const derivedEnd = deriveDefaultEnd(nextStart);
      setEndTimeMin(derivedEnd !== null ? derivedEnd : '');
    }
  }, [isEditing, searchParamsKey]);

  function hydrateForm(appointment: Appointment) {
    const appointmentDate = appointment.date.includes('T')
      ? appointment.date.split('T')[0]
      : appointment.date;

    setSelectedPatient({
      patientId: appointment.patient.patientId,
      name: appointment.patient.name,
    });
    setPatientInput(appointment.patient.name);
    setDoctorId(appointment.doctor.doctorId);
    setDepartment(appointment.department || appointment.doctor.department);
    setDate(appointmentDate);
    setStartTimeMin(appointment.startTimeMin);
    setEndTimeMin(appointment.endTimeMin);
    setReason(appointment.reason ?? '');
    setLocation(appointment.location ?? '');
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setPatientQuery(patientInput.trim());
    }, 200);

    return () => clearTimeout(handle);
  }, [patientInput]);

  const timeOptions = useMemo(() => {
    const options: Array<{ label: string; value: number }> = [];
    for (let minutes = 0; minutes < MINUTES_IN_DAY; minutes += APPOINTMENT_SLOT_MINUTES) {
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

  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => doctor.doctorId === doctorId) || null,
    [doctorId, doctors]
  );

  const timeValidationError = useMemo(() => {
    if (typeof startTimeMin === 'number' && typeof endTimeMin === 'number') {
      if (endTimeMin <= startTimeMin) {
        return 'End time must be after the start time.';
      }
    }
    return null;
  }, [startTimeMin, endTimeMin]);

  const durationLabel = useMemo(() => {
    if (typeof startTimeMin === 'number' && typeof endTimeMin === 'number' && endTimeMin > startTimeMin) {
      const totalMinutes = endTimeMin - startTimeMin;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
      if (minutes > 0) parts.push(`${minutes} min`);
      return parts.join(' ');
    }
    return null;
  }, [startTimeMin, endTimeMin]);

  function resetSelection() {
    setSelectedPatient(null);
    setPatientInput('');
    setPatientResults([]);
  }

  function handleSelectPatient(patient: PatientOption) {
    setSelectedPatient(patient);
    setPatientInput(patient.name);
    setPatientTouched(true);
    setPatientResults([]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSubmitError(null);
    setPatientTouched(true);

    if (!selectedPatient) {
      setSubmitError('Please select a patient for this appointment.');
      return;
    }

    if (!doctorId) {
      setSubmitError('Choose an attending doctor.');
      return;
    }

    if (!department.trim()) {
      setSubmitError('Department is required.');
      return;
    }

    if (!date) {
      setSubmitError('Select an appointment date.');
      return;
    }

    if (typeof startTimeMin !== 'number' || typeof endTimeMin !== 'number') {
      setSubmitError('Select both a start and end time.');
      return;
    }

    if (timeValidationError) {
      setSubmitError(timeValidationError);
      return;
    }

    const payload = {
      patientId: selectedPatient.patientId,
      doctorId,
      department: department.trim(),
      date,
      startTimeMin,
      endTimeMin,
      reason: reason.trim() || undefined,
      location: location.trim() || undefined,
    } as const;

    setSaving(true);

    try {
      const appointment = isEditing
        ? await updateAppointment(appointmentId!, payload)
        : await createAppointment(payload);

      navigate(`/admin/${adminId}/appointments/${appointment.appointmentId}`);
    } catch (error) {
      setSubmitError(parseErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const headerActions = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <Link
        to={`/admin/${adminId}/appointments`}
        className="inline-flex items-center justify-center rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-100"
      >
        Back to schedule
      </Link>
      <span className="text-xs text-gray-500">
        All updates instantly sync with the care coordination dashboard.
      </span>
    </div>
  );

  return (
    <DashboardLayout
      title={isEditing ? 'Update appointment' : 'Schedule appointment'}
      subtitle="Coordinate patient care with a clear overview of provider availability."
      activeItem="appointments"
      headerChildren={headerActions}
    >
      {initializing ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
          <span className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          Loading appointment details...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Patient selection</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Search the patient directory to attach the correct chart to this visit.
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                    selectedPatient ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                  }`}
                >
                  {selectedPatient ? 'Patient selected' : 'Required'}
                </span>
              </div>

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700" htmlFor="patient-search">
                  Search patients
                </label>
                <input
                  id="patient-search"
                  type="search"
                  value={patientInput}
                  onChange={(event) => {
                    setPatientInput(event.target.value);
                    setSelectedPatient(null);
                  }}
                  placeholder="Start typing a patient name..."
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                    !selectedPatient && patientTouched ? 'border-red-300 focus:border-red-400 focus:ring-red-400/30' : 'border-gray-200'
                  }`}
                />
                <p className="mt-1 text-xs text-gray-500">Type at least two characters to find a patient record.</p>
              </div>

              {selectedPatient ? (
                <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-blue-700">{selectedPatient.name}</div>
                      {selectedPatient.dob && (
                        <div className="text-xs text-blue-600">DOB: {new Date(selectedPatient.dob).toLocaleDateString()}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={resetSelection}
                      className="inline-flex items-center justify-center rounded-full border border-blue-200 px-3 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-100"
                    >
                      Change patient
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200">
                  {patientLoading ? (
                    <div className="flex items-center justify-center gap-3 bg-white px-4 py-6 text-sm text-gray-600">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                      Searching directory...
                    </div>
                  ) : patientError ? (
                    <div className="bg-red-50 px-4 py-6 text-sm text-red-600">{patientError}</div>
                  ) : patientQuery ? (
                    patientResults.length > 0 ? (
                      <ul className="divide-y divide-gray-100 bg-white">
                        {patientResults.map((patient) => (
                          <li key={patient.patientId}>
                            <button
                              type="button"
                              onClick={() => handleSelectPatient(patient)}
                              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-blue-50"
                            >
                              <div>
                                <div className="font-medium text-gray-900">{patient.name}</div>
                                {patient.dob && (
                                  <div className="text-xs text-gray-500">DOB: {new Date(patient.dob).toLocaleDateString()}</div>
                                )}
                              </div>
                              <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">Select</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="bg-white px-4 py-6 text-sm text-gray-500">No patients match that search.</div>
                    )
                  ) : (
                    <div className="bg-white px-4 py-6 text-sm text-gray-500">Start searching to see patient matches.</div>
                  )}
                </div>
              )}

              {!selectedPatient && patientTouched && !patientLoading && !patientError && (
                <p className="mt-3 text-sm text-red-600">A patient selection is required before scheduling.</p>
              )}
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Scheduling details</h2>
                  <p className="mt-1 text-sm text-gray-600">Assign the provider, date, and time for this visit.</p>
                </div>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                  15 min increments
                </span>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
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
                    placeholder="e.g. Cardiology"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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

                <div className="grid grid-cols-2 gap-3 md:col-span-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="start-time">
                      Start time
                    </label>
                    <select
                      id="start-time"
                      value={typeof startTimeMin === 'number' ? startTimeMin : ''}
                      onChange={(event) => {
                        const rawValue = event.target.value;
                        const value = rawValue ? Number(rawValue) : '';
                        setStartTimeMin(value);

                        if (value === '') {
                          setEndTimeMin('');
                          return;
                        }

                        if (typeof value === 'number') {
                          if (typeof endTimeMin !== 'number' || endTimeMin <= value) {
                            const nextEnd = deriveDefaultEnd(value);
                            setEndTimeMin(nextEnd !== null && nextEnd > value ? nextEnd : '');
                          }
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
              </div>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Visit context</h2>
                  <p className="mt-1 text-sm text-gray-600">Capture any details that will help the care team prepare.</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
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
                  <p className="mt-1 text-xs text-gray-500">Optional but useful for front desk and nursing staff.</p>
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
            </section>

            <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {isEditing ? 'Save your updates' : 'Ready to schedule this appointment?'}
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  The care coordination team will be notified immediately after saving.
                </p>
                {submitError && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {submitError}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to={`/admin/${adminId}/appointments`}
                  className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? 'Saving...' : isEditing ? 'Update appointment' : 'Create appointment'}
                </button>
              </div>
            </div>
          </form>

          <aside className="space-y-6">
            <section className="rounded-2xl bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
              <div className="text-sm font-medium uppercase tracking-wide text-blue-600">Patient overview</div>
              <div className="mt-3 text-lg font-semibold text-gray-900">
                {selectedPatient ? selectedPatient.name : 'No patient selected yet'}
              </div>
              <dl className="mt-4 space-y-3 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Date</dt>
                  <dd className="text-right text-gray-900">{formatDateDisplay(date)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Doctor</dt>
                  <dd className="text-right text-gray-900">
                    {selectedDoctor ? `${selectedDoctor.name}` : 'Choose a doctor'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Department</dt>
                  <dd className="text-right text-gray-900">{department || '—'}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Time</dt>
                  <dd className="text-right text-gray-900">
                    {typeof startTimeMin === 'number' && typeof endTimeMin === 'number'
                      ? `${formatTime(startTimeMin)} – ${formatTime(endTimeMin)}`
                      : 'Select start & end'}
                  </dd>
                </div>
                {durationLabel && (
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Duration</dt>
                    <dd className="text-right text-gray-900">{durationLabel}</dd>
                  </div>
                )}
                {location && (
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Location</dt>
                    <dd className="text-right text-gray-900">{location}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Availability preview</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Free windows for {selectedDoctor ? selectedDoctor.name : 'the selected doctor'} on {date}.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {!doctorId || !date ? (
                  <p className="text-sm text-gray-500">Select a doctor and date to check open slots.</p>
                ) : availabilityLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                    Checking availability…
                  </div>
                ) : availabilityError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {availabilityError}
                  </div>
                ) : freeSlots.length > 0 ? (
                  <ul className="space-y-2 text-sm text-blue-700">
                    {freeSlots.map((slot, index) => {
                      const key = `${slot.startMin}-${slot.endMin}-${index}`;
                      return (
                        <li key={key} className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                          <span>{formatTime(slot.startMin)} – {formatTime(slot.endMin)}</span>
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

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Notes</h3>
              <ul className="mt-3 space-y-2 text-sm text-gray-600">
                <li>• Make sure the selected times fall within provider availability.</li>
                <li>• Conflicts will display here if the server reports an overlap.</li>
                <li>• Departments can be customized if routing differs from provider default.</li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </DashboardLayout>
  );
}
