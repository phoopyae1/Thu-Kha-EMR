import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { AvatarIcon, CheckIcon, PatientsIcon, SettingsIcon } from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useAuth } from '../context/AuthProvider';
import { useTranslation, type Language } from '../hooks/useTranslation';
import {
  DoctorAvailabilitySlot,
  createDoctorAvailability,
  listDoctorAvailability,
  type Role,
} from '../api/client';

type DoctorFormState = {
  name: string;
  department: string;
};

type UserDraft = {
  role: Role;
  status: 'active' | 'inactive';
  doctorId: string | null;
};

const ROLE_LABELS: Record<Role, string> = {
  Doctor: 'Doctor',
  AdminAssistant: 'Administrative Assistant',
  Cashier: 'Cashier',
  ITAdmin: 'IT Administrator',
  Pharmacist: 'Pharmacist',
  PharmacyTech: 'Pharmacy Technician',
  InventoryManager: 'Inventory Manager',
  Nurse: 'Nurse',
  LabTech: 'Laboratory Technician',
};

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'Doctor', label: ROLE_LABELS.Doctor },
  { value: 'AdminAssistant', label: ROLE_LABELS.AdminAssistant },
  { value: 'Cashier', label: ROLE_LABELS.Cashier },
  { value: 'ITAdmin', label: ROLE_LABELS.ITAdmin },
  { value: 'Pharmacist', label: ROLE_LABELS.Pharmacist },
  { value: 'PharmacyTech', label: ROLE_LABELS.PharmacyTech },
  { value: 'InventoryManager', label: ROLE_LABELS.InventoryManager },
  { value: 'Nurse', label: ROLE_LABELS.Nurse },
  { value: 'LabTech', label: ROLE_LABELS.LabTech },
];

const DAY_OPTIONS = [
  { label: 'Sunday', value: 0 },
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
];

function parseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.message === 'string') {
        return parsed.message;
      }
    } catch {
      /* ignore parse failure */
    }
    if (error.message) {
      return error.message;
    }
  }
  return fallback;
}

function timeStringToMinutes(value: string): number | null {
  if (!value) return null;
  const [hoursStr, minutesStr] = value.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatTime(minutes: number): string {
  const clampedMinutes = Math.max(0, Math.min(24 * 60, minutes));
  const hours = Math.floor(clampedMinutes / 60);
  const mins = clampedMinutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function formatTimeRange(startMin: number, endMin: number): string {
  return `${formatTime(startMin)} – ${formatTime(endMin)}`;
}

export default function Settings() {
  const { adminId } = useParams<{ adminId: string }>();
  const { user } = useAuth();
  const {
    appName,
    logo,
    users,
    doctors,
    updateSettings,
    addUser,
    updateUser,
    addDoctor,
    deleteDoctor,
    widgetEnabled,
    setWidgetEnabled,
  } = useSettings();
  const { t, language, setLanguage } = useTranslation();
  const canDeleteDoctor = user && (user.role === 'ITAdmin' || user.role === 'AdminAssistant');

  const [name, setName] = useState(appName);
  const [userForm, setUserForm] = useState<{ email: string; password: string; role: Role; doctorId: string }>(
    { email: '', password: '', role: 'AdminAssistant', doctorId: '' },
  );
  const [userError, setUserError] = useState<string | null>(null);
  const [userSuccess, setUserSuccess] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});
  const [userSavingId, setUserSavingId] = useState<string | null>(null);
  const [doctorForm, setDoctorForm] = useState<DoctorFormState>({ name: '', department: '' });
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [availabilitySlots, setAvailabilitySlots] = useState<DoctorAvailabilitySlot[]>([]);
  const [defaultAvailability, setDefaultAvailability] = useState<{ startMin: number; endMin: number }[]>([]);
  const [availabilityForm, setAvailabilityForm] = useState({ dayOfWeek: '1', start: '09:00', end: '17:00' });
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilitySuccess, setAvailabilitySuccess] = useState<string | null>(null);
  const [addingAvailability, setAddingAvailability] = useState(false);
  const [deletingDoctor, setDeletingDoctor] = useState<Record<string, boolean>>({});
  const [doctorDeleteError, setDoctorDeleteError] = useState<string | null>(null);

  const totalUsers = users.length;
  const totalDoctors = doctors.length;
  const latestDoctor = totalDoctors > 0 ? doctors[totalDoctors - 1] : undefined;
  const latestUser = totalUsers > 0 ? users[totalUsers - 1] : undefined;

  useEffect(() => {
    if (!doctors.length) {
      setSelectedDoctorId('');
      setAvailabilitySlots([]);
      setDefaultAvailability([]);
      return;
    }

    setSelectedDoctorId((previous) => {
      if (previous && doctors.some((doctor) => doctor.doctorId === previous)) {
        return previous;
      }
      return doctors[0].doctorId;
    });
  }, [doctors]);

  useEffect(() => {
    const drafts: Record<string, UserDraft> = {};
    users.forEach((user) => {
      drafts[user.userId] = {
        role: user.role,
        status: user.status,
        doctorId: user.doctorId ?? null,
      };
    });
    setUserDrafts(drafts);
  }, [users]);

  const assignedDoctorIds = useMemo(() => {
    const ids = new Set<string>();
    users.forEach((user) => {
      if (user.doctorId) ids.add(user.doctorId);
    });
    return ids;
  }, [users]);

  const unassignedDoctors = useMemo(
    () => doctors.filter((doctor) => !assignedDoctorIds.has(doctor.doctorId)),
    [doctors, assignedDoctorIds],
  );

  useEffect(() => {
    if (!selectedDoctorId) {
      setAvailabilitySlots([]);
      setAvailabilityLoading(false);
      setAvailabilityError(null);
      setAvailabilitySuccess(null);
      return;
    }

    let active = true;
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    setAvailabilitySuccess(null);

    listDoctorAvailability(selectedDoctorId)
      .then((response) => {
        if (!active) return;
        setAvailabilitySlots(response.availability);
        setDefaultAvailability(response.defaultAvailability);
      })
      .catch((error) => {
        if (!active) return;
        setAvailabilitySlots([]);
        setAvailabilityError(parseErrorMessage(error, 'Unable to load availability.'));
      })
      .finally(() => {
        if (!active) return;
        setAvailabilityLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedDoctorId]);

  const groupedAvailability = useMemo(() => {
    return DAY_OPTIONS.map((option) => ({
      ...option,
      slots: availabilitySlots
        .filter((slot) => slot.dayOfWeek === option.value)
        .sort((a, b) => a.startMin - b.startMin),
    }));
  }, [availabilitySlots]);

  const defaultAvailabilityLabel = useMemo(() => {
    if (defaultAvailability.length > 0) {
      return defaultAvailability.map((window) => formatTimeRange(window.startMin, window.endMin)).join(', ');
    }
    return formatTimeRange(9 * 60, 17 * 60);
  }, [defaultAvailability]);

  function handleLanguageChange(event: ChangeEvent<HTMLSelectElement>) {
    setLanguage(event.target.value as Language);
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      updateSettings({ logo: reader.result as string });
    };
    reader.readAsDataURL(file);
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateSettings({ appName: name.trim() || '' });
  }

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = userForm.email.trim();
    const password = userForm.password;
    if (!email || !password) {
      setUserError('Email and password are required.');
      return;
    }

    if (userForm.role === 'Doctor' && !userForm.doctorId) {
      setUserError('Select a doctor for doctor accounts.');
      return;
    }

    setAddingUser(true);
    setUserError(null);
    setUserSuccess(null);

    try {
      await addUser({
        email,
        password,
        role: userForm.role,
        doctorId: userForm.role === 'Doctor' ? userForm.doctorId : undefined,
      });
      setUserSuccess('User account created.');
      setUserForm({ email: '', password: '', role: 'AdminAssistant', doctorId: '' });
    } catch (error) {
      setUserError(parseErrorMessage(error, 'Unable to create user.'));
    } finally {
      setAddingUser(false);
    }
  }

  function handleUserFormChange(field: keyof typeof userForm, value: string) {
    setUserForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'role' && value !== 'Doctor') {
        next.doctorId = '';
      }
      return next;
    });
  }

  function handleUserDraftChange(userId: string, patch: Partial<UserDraft>) {
    setUserDrafts((prev) => {
      const base: UserDraft = prev[userId] ?? { role: 'AdminAssistant', status: 'active', doctorId: null };
      const next = { ...base, ...patch };
      if (patch.role && patch.role !== 'Doctor') {
        next.doctorId = null;
      }
      return { ...prev, [userId]: next };
    });
  }

  async function handleSaveUser(userId: string) {
    const draft = userDrafts[userId];
    if (!draft) return;
    if (draft.role === 'Doctor' && !draft.doctorId) {
      setUserError('Select a doctor for doctor accounts.');
      return;
    }
    setUserSavingId(userId);
    setUserError(null);
    setUserSuccess(null);
    try {
      await updateUser(userId, {
        role: draft.role,
        status: draft.status,
        doctorId: draft.role === 'Doctor' ? draft.doctorId : null,
      });
      setUserSuccess('User details updated.');
    } catch (error) {
      setUserError(parseErrorMessage(error, 'Unable to update user.'));
    } finally {
      setUserSavingId(null);
    }
  }

  async function handleAddDoctor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = doctorForm.name.trim();
    const trimmedDepartment = doctorForm.department.trim();
    if (!trimmedName || !trimmedDepartment) return;

    const created = await addDoctor({ name: trimmedName, department: trimmedDepartment });
    setDoctorForm({ name: '', department: '' });
    setSelectedDoctorId(created.doctorId);
    setAvailabilityForm({ dayOfWeek: '1', start: '09:00', end: '17:00' });
  }

  async function handleDeleteDoctor(doctorId: string, doctorName: string) {
    const confirmed = window.confirm(
      `Are you sure you want to delete ${doctorName}? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingDoctor((prev) => ({ ...prev, [doctorId]: true }));
    setDoctorDeleteError(null);
    try {
      await deleteDoctor(doctorId);
      // If the deleted doctor was selected, clear the selection
      if (selectedDoctorId === doctorId) {
        setSelectedDoctorId('');
        setAvailabilitySlots([]);
        setDefaultAvailability([]);
      }
    } catch (error) {
      setDoctorDeleteError(parseErrorMessage(error, 'Unable to delete doctor.'));
    } finally {
      setDeletingDoctor((prev) => {
        const next = { ...prev };
        delete next[doctorId];
        return next;
      });
    }
  }

  async function handleAddAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDoctorId) {
      setAvailabilityError('Select a doctor to add availability.');
      return;
    }

    const dayOfWeek = Number(availabilityForm.dayOfWeek);
    const startMin = timeStringToMinutes(availabilityForm.start);
    const endMin = timeStringToMinutes(availabilityForm.end);

    if (startMin === null || endMin === null) {
      setAvailabilityError('Provide valid start and end times.');
      return;
    }

    if (endMin <= startMin) {
      setAvailabilityError('End time must be later than start time.');
      return;
    }

    setAddingAvailability(true);
    setAvailabilityError(null);
    setAvailabilitySuccess(null);

    try {
      const created = await createDoctorAvailability(selectedDoctorId, {
        dayOfWeek,
        startMin,
        endMin,
      });

      setAvailabilitySlots((previous) => {
        const next = [...previous, created];
        next.sort((a, b) =>
          a.dayOfWeek === b.dayOfWeek ? a.startMin - b.startMin : a.dayOfWeek - b.dayOfWeek
        );
        return next;
      });
      setAvailabilitySuccess('Availability window added.');
    } catch (error) {
      setAvailabilityError(parseErrorMessage(error, 'Unable to add availability window.'));
    } finally {
      setAddingAvailability(false);
    }
  }

  const headerStatus = (
    <div className="flex flex-col gap-3 text-sm text-gray-600 md:flex-row md:items-center md:gap-4">
      <span
        className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
          widgetEnabled
            ? 'bg-green-50 text-green-600'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {t('Widget {status}', { status: widgetEnabled ? t('Enabled') : t('Disabled') })}
      </span>
      <span>
        {t('Portal name synced as {name}', { name: appName })}
      </span>
    </div>
  );

  return (
    <DashboardLayout
      title={t('Organization Settings')}
      subtitle={t('Manage branding, staff accounts, and patient-facing tools.')}
      activeItem="settings"
      headerChildren={headerStatus}
    >
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <SettingsIcon className="h-6 w-6" />
              </span>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Application</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{appName}</div>
                <p className="text-xs text-gray-500">Visible across staff dashboard and patient portal.</p>
              </div>
            </div>
            {logo && (
              <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Logo Preview</div>
                <img src={logo} alt="Application logo" className="mt-2 h-12 w-auto" />
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <AvatarIcon className="h-6 w-6" />
              </span>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active Users</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{totalUsers}</div>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              {latestUser ? `Most recent invite: ${latestUser.email}` : 'Invite teammates to collaborate securely.'}
            </p>
          </div>

          <div className="flex flex-col justify-between rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <PatientsIcon className="h-6 w-6" />
              </span>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Doctors</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{totalDoctors}</div>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              {latestDoctor
                ? `${latestDoctor.name} • ${latestDoctor.department}`
                : 'Add clinicians to keep schedules and visits organized.'}
            </p>
          </div>

          <div
            className={`flex flex-col justify-between rounded-2xl border p-5 shadow-sm ${
              widgetEnabled ? 'border-green-100 bg-green-50/60' : 'border-gray-100 bg-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  widgetEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                }`}
              >
                <CheckIcon className="h-6 w-6" />
              </span>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Patient Widget</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {widgetEnabled ? 'Active' : 'Turned Off'}
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              {widgetEnabled
                ? 'Patients can request appointments directly from your portal.'
                : 'Enable the widget to let patients self-schedule and engage.'}
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1.1fr]">
          <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Branding & Portal Settings</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Update your organization name, upload a logo, and manage the patient widget visibility.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-blue-900">{t('Integration Settings')}</h3>
                    <p className="mt-1 text-xs text-blue-700">
                      {t('Configure the iframe embed code and context key for the patient portal widget.')}
                    </p>
                  </div>
                  <Link
                    to="/admin/integration"
                    className="ml-4 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    {t('Manage Integration')}
                  </Link>
                </div>
              </div>

              <form onSubmit={handleSave} className="mt-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="app-name">
                      {t('Application Name')}
                    </label>
                    <input
                      id="app-name"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="logo-upload">
                      {t('Logo')}
                    </label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:rounded-full file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-600 hover:file:bg-blue-100"
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('PNG, JPG or SVG up to 1MB.')}</p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="language-select">
                      {t('Interface Language')}
                    </label>
                    <select
                      id="language-select"
                      value={language}
                      onChange={handleLanguageChange}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="en">{t('English')}</option>
                      <option value="my">မြန်မာ</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      {t('Choose the language used across the staff experience.')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4">
                  <div>
                    <div className="text-sm font-medium text-gray-800">Patient Self-Service Widget</div>
                    <p className="text-xs text-gray-500">Control visibility of the scheduling widget on your public pages.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={widgetEnabled}
                    onClick={() => setWidgetEnabled(!widgetEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${
                      widgetEnabled ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                        widgetEnabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                    <span className="sr-only">Toggle patient widget</span>
                  </button>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Clinical Directory</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Add providers to keep appointment availability and assignments organized.
                  </p>
                </div>
              </div>

              <form onSubmit={handleAddDoctor} className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="doctor-name">
                    Doctor Name
                  </label>
                  <input
                    id="doctor-name"
                    type="text"
                    placeholder="Dr. Jane Smith"
                    value={doctorForm.name}
                    onChange={(event) =>
                      setDoctorForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="doctor-department">
                    Department
                  </label>
                  <input
                    id="doctor-department"
                    type="text"
                    placeholder="Cardiology"
                    value={doctorForm.department}
                    onChange={(event) =>
                      setDoctorForm((prev) => ({ ...prev, department: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    Add Doctor
                  </button>
                </div>
              </form>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-900">Active Doctors</h3>
                {doctorDeleteError && (
                  <p className="mt-2 text-sm text-red-600">{doctorDeleteError}</p>
                )}
                {totalDoctors > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {doctors.map((doctor) => {
                      const isDeleting = deletingDoctor[doctor.doctorId] ?? false;
                      return (
                        <li
                          key={doctor.doctorId}
                          className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900">{doctor.name}</span>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-600 shadow-sm">
                              {doctor.department}
                            </span>
                          </div>
                          {canDeleteDoctor && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDoctor(doctor.doctorId, doctor.name)}
                              disabled={isDeleting}
                              className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold text-white transition ${
                                isDeleting
                                  ? 'cursor-not-allowed bg-gray-400'
                                  : 'bg-red-600 hover:bg-red-700'
                              }`}
                            >
                              {isDeleting ? 'Deleting…' : 'Delete'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">
                    No doctors added yet. Create your first provider above to start scheduling visits.
                  </p>
                )}
              </div>

              <div className="mt-8 border-t border-gray-100 pt-6">
                <h3 className="text-sm font-semibold text-gray-900">Doctor Availability</h3>
                {totalDoctors === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">
                    Add a doctor above to configure custom availability. Providers without custom slots follow the
                    default schedule of {defaultAvailabilityLabel}.
                  </p>
                ) : (
                  <div className="mt-4 space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="availability-doctor">
                          Select Doctor
                        </label>
                        <select
                          id="availability-doctor"
                          value={selectedDoctorId}
                          onChange={(event) => {
                            setSelectedDoctorId(event.target.value);
                            setAvailabilityForm({ dayOfWeek: '1', start: '09:00', end: '17:00' });
                            setAvailabilityError(null);
                            setAvailabilitySuccess(null);
                          }}
                          className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        >
                          {doctors.map((doctor) => (
                            <option key={doctor.doctorId} value={doctor.doctorId}>
                              {doctor.name} • {doctor.department}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-700">
                        Configure specific windows for days you need to override the default {defaultAvailabilityLabel}{' '}
                        schedule.
                      </div>
                    </div>

                    <form onSubmit={handleAddAvailability} className="grid gap-4 md:grid-cols-4">
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="availability-day">
                          Day of Week
                        </label>
                        <select
                          id="availability-day"
                          value={availabilityForm.dayOfWeek}
                          onChange={(event) => {
                            setAvailabilityForm((prev) => ({ ...prev, dayOfWeek: event.target.value }));
                            setAvailabilityError(null);
                            setAvailabilitySuccess(null);
                          }}
                          className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        >
                          {DAY_OPTIONS.map((option) => (
                            <option key={option.value} value={String(option.value)}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="availability-start">
                          Start Time
                        </label>
                        <input
                          id="availability-start"
                          type="time"
                          value={availabilityForm.start}
                          onChange={(event) => {
                            setAvailabilityForm((prev) => ({ ...prev, start: event.target.value }));
                            setAvailabilityError(null);
                            setAvailabilitySuccess(null);
                          }}
                          className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="availability-end">
                          End Time
                        </label>
                        <input
                          id="availability-end"
                          type="time"
                          value={availabilityForm.end}
                          onChange={(event) => {
                            setAvailabilityForm((prev) => ({ ...prev, end: event.target.value }));
                            setAvailabilityError(null);
                            setAvailabilitySuccess(null);
                          }}
                          className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="submit"
                          disabled={addingAvailability}
                          className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition ${
                            addingAvailability ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                        >
                          {addingAvailability ? 'Saving…' : 'Add Availability'}
                        </button>
                      </div>
                    </form>

                    {availabilityError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {availabilityError}
                      </div>
                    )}
                    {availabilitySuccess && (
                      <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                        {availabilitySuccess}
                      </div>
                    )}

                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      {availabilityLoading ? (
                        <p className="text-sm text-gray-500">Loading availability…</p>
                      ) : (
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {groupedAvailability.map((group) => (
                            <div key={group.value} className="rounded-xl bg-white p-4 shadow-sm">
                              <dt className="text-sm font-semibold text-gray-900">{group.label}</dt>
                              <dd className="mt-2 space-y-2 text-sm text-gray-600">
                                {group.slots.length > 0 ? (
                                  group.slots.map((slot) => (
                                    <div
                                      key={slot.availabilityId}
                                      className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-blue-700"
                                    >
                                      <span>{formatTimeRange(slot.startMin, slot.endMin)}</span>
                                      <span className="text-xs font-medium uppercase tracking-wide text-blue-500">Custom</span>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-gray-500">Default hours {defaultAvailabilityLabel}</p>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Invite Team Members</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Create accounts for administrators, front desk staff, and billers.
                </p>
              </div>

              {userError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {userError}
                </div>
              )}
              {userSuccess && (
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {userSuccess}
                </div>
              )}

              <form onSubmit={handleAddUser} className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="user-email">
                    Email Address
                  </label>
                  <input
                    id="user-email"
                    type="email"
                    placeholder="team@clinic.org"
                    value={userForm.email}
                    onChange={(event) => handleUserFormChange('email', event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="user-password">
                    Temporary Password
                  </label>
                  <input
                    id="user-password"
                    type="password"
                    placeholder="Create a secure password"
                    value={userForm.password}
                    onChange={(event) => handleUserFormChange('password', event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="user-role">
                      Role
                    </label>
                    <select
                      id="user-role"
                      value={userForm.role}
                      onChange={(event) => handleUserFormChange('role', event.target.value as Role)}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {userForm.role === 'Doctor' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700" htmlFor="user-doctor">
                        Linked Doctor
                      </label>
                      <select
                        id="user-doctor"
                        value={userForm.doctorId}
                        onChange={(event) => handleUserFormChange('doctorId', event.target.value)}
                        className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      >
                        <option value="">Select doctor</option>
                        {unassignedDoctors.map((doctor) => (
                          <option key={doctor.doctorId} value={doctor.doctorId}>
                            {doctor.name}
                          </option>
                        ))}
                      </select>
                      {unassignedDoctors.length === 0 && (
                        <p className="mt-1 text-xs text-gray-500">All doctors are currently linked to an account.</p>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={addingUser}
                  className={`w-full rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition ${
                    addingUser ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {addingUser ? 'Creating...' : 'Send Invite'}
                </button>
              </form>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-900">Current Users</h3>
                {totalUsers > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {users.map((user) => {
                      const draft = userDrafts[user.userId] ?? {
                        role: user.role,
                        status: user.status,
                        doctorId: user.doctorId ?? null,
                      };
                      const doctorOptions = doctors.filter((doctor) => {
                        if (draft.role !== 'Doctor') return false;
                        // For IT admin, show all doctors to allow reassignment
                        return true;
                      });
                      const isDirty =
                        draft.role !== user.role ||
                        draft.status !== user.status ||
                        (draft.doctorId ?? null) !== (user.doctorId ?? null);
                      const saving = userSavingId === user.userId;

                      return (
                        <li key={user.userId} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                          <div className="flex flex-col gap-1">
                            <div className="text-sm font-semibold text-gray-900">{user.email}</div>
                            <div className="text-xs text-gray-500">
                              {ROLE_LABELS[user.role]}
                              {user.status !== 'active' ? ' • Inactive' : ''}
                            </div>
                            {user.doctor && (
                              <div className="text-xs text-gray-500">Linked to {user.doctor.name}</div>
                            )}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="text-xs font-medium text-gray-600" htmlFor={`role-${user.userId}`}>
                                Role
                              </label>
                              <select
                                id={`role-${user.userId}`}
                                value={draft.role}
                                onChange={(event) =>
                                  handleUserDraftChange(user.userId, {
                                    role: event.target.value as Role,
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                              >
                                {ROLE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600" htmlFor={`status-${user.userId}`}>
                                Status
                              </label>
                              <select
                                id={`status-${user.userId}`}
                                value={draft.status}
                                onChange={(event) =>
                                  handleUserDraftChange(user.userId, {
                                    status: event.target.value as 'active' | 'inactive',
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </div>
                            {draft.role === 'Doctor' && (
                              <div>
                                <label className="text-xs font-medium text-gray-600" htmlFor={`doctor-${user.userId}`}>
                                  Linked Doctor
                                </label>
                                <select
                                  id={`doctor-${user.userId}`}
                                  value={draft.doctorId ?? ''}
                                  onChange={(event) =>
                                    handleUserDraftChange(user.userId, {
                                      doctorId: event.target.value ? event.target.value : null,
                                    })
                                  }
                                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                >
                                  <option value="">Select doctor</option>
                                  {doctorOptions.map((doctor) => (
                                    <option key={doctor.doctorId} value={doctor.doctorId}>
                                      {doctor.name}
                                    </option>
                                  ))}
                                </select>
                                {doctorOptions.length === 0 && (
                                  <p className="mt-1 text-xs text-gray-500">No available doctors to assign.</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="mt-4 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleSaveUser(user.userId)}
                              disabled={!isDirty || saving}
                              className={`rounded-full px-4 py-2 text-sm font-semibold text-white shadow transition ${
                                !isDirty || saving
                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                  : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">No team members yet. Invite your first collaborator above.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-6">
              <h2 className="text-lg font-semibold text-blue-700">Need onboarding tips?</h2>
              <p className="mt-2 text-sm text-blue-700/80">
                Share a welcome kit with new users so they know how to chart visits, message patients, and review lab
                results. Keep this space updated as your workflows evolve.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
