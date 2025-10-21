
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { PatientsIcon, SearchIcon } from '../components/icons';
import PrescribeDrawer from '../components/PrescribeDrawer';
import { useAuth } from '../context/AuthProvider';
import {
  addObservation,
  getPatient,
  getVisit,
  type Observation,
  type Patient,
  type VisitDetail as VisitDetailType,
} from '../api/client';

function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function calculateAge(dob: string) {
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

function buildObservationVitals(observation: Observation) {
  const vitals: string[] = [];
  const hasBloodPressure =
    observation.bpSystolic !== undefined || observation.bpDiastolic !== undefined;
  if (hasBloodPressure) {
    const systolic = observation.bpSystolic ?? '—';
    const diastolic = observation.bpDiastolic ?? '—';
    vitals.push(`BP ${systolic}/${diastolic} mmHg`);
  }
  if (observation.heartRate !== undefined) {
    vitals.push(`HR ${observation.heartRate} bpm`);
  }
  if (observation.temperatureC !== undefined) {
    vitals.push(`Temp ${observation.temperatureC} °C`);
  }
  if (observation.spo2 !== undefined) {
    vitals.push(`SpO₂ ${observation.spo2}%`);
  }
  if (observation.bmi !== undefined) {
    vitals.push(`BMI ${observation.bmi}`);
  }
  return vitals;
}

export default function VisitDetail() {
  const { id } = useParams<{ id: string }>();
  const [visit, setVisit] = useState<VisitDetailType | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const visitId = id;
    if (!visitId) {
      setError('Visit identifier is missing.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisit(null);
    setPatient(null);

    async function load(targetVisitId: string) {
      try {
        const v = await getVisit(targetVisitId);
        if (cancelled) return;
        setVisit(v);
        const p = await getPatient(v.patientId);
        if (!cancelled) {
          setPatient(p as Patient);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Unable to load visit details right now.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load(visitId);

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleAddObservation() {
    const visitId = id;
    if (!visitId) return;
    const note = window.prompt('Enter observation note');
    if (!note) return;
    try {
      const obs = await addObservation(visitId, { noteText: note });
      setVisit((current) => (current ? { ...current, observations: [obs, ...current.observations] } : current));
    } catch (err) {
      console.error(err);
      window.alert('Unable to add an observation at this time.');
    }
  }

  const headerActions = visit ? (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <Link
        to={`/patients/${visit.patientId}`}
        className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
      >
        Patient Profile
      </Link>
    </div>
  ) : undefined;

  const subtitle = visit
    ? `Visit on ${formatDate(visit.visitDate)} with ${visit.doctor.name}`
    : loading
      ? 'Loading visit details...'
      : error ?? 'Visit details unavailable.';

  const coverage = patient?.insurance?.trim() || 'Self-pay';
  const gender = formatGender(patient?.gender);
  const contact = patient?.contact?.trim() || 'Not provided';
  const age = patient ? calculateAge(patient.dob) : null;
  const allergies = patient?.drugAllergies?.trim() || 'No known allergies';

  const vitalsSource = visit?.observations.find(
    (observation) =>
      observation.bpSystolic !== undefined ||
      observation.bpDiastolic !== undefined ||
      observation.heartRate !== undefined ||
      observation.temperatureC !== undefined ||
      observation.spo2 !== undefined ||
      observation.bmi !== undefined,
  );

  const vitalMetrics = [
    {
      label: 'Blood Pressure',
      value:
        vitalsSource && (vitalsSource.bpSystolic !== undefined || vitalsSource.bpDiastolic !== undefined)
          ? `${vitalsSource.bpSystolic ?? '—'}/${vitalsSource.bpDiastolic ?? '—'} mmHg`
          : 'N/A',
    },
    {
      label: 'Heart Rate',
      value:
        vitalsSource?.heartRate !== undefined ? `${vitalsSource.heartRate} bpm` : 'N/A',
    },
    {
      label: 'Temperature',
      value:
        vitalsSource?.temperatureC !== undefined ? `${vitalsSource.temperatureC} °C` : 'N/A',
    },
    {
      label: 'SpO₂',
      value: vitalsSource?.spo2 !== undefined ? `${vitalsSource.spo2}%` : 'N/A',
    },
    {
      label: 'BMI',
      value: vitalsSource?.bmi !== undefined ? `${vitalsSource.bmi}` : 'N/A',
    },
  ];

  return (
    <DashboardLayout
      title={patient ? patient.name : 'Visit Detail'}
      subtitle={subtitle}
      activeItem="patients"
      headerChildren={headerActions}
    >
      {loading ? (
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 shadow-sm">
            <SearchIcon className="h-10 w-10 animate-spin text-blue-500" />
            <p className="text-sm font-medium text-gray-600">Loading visit record...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
          <p className="text-sm font-semibold">{error}</p>
          <Link
            to="/patients"
            className="mt-4 inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100"
          >
            Back to patient directory
          </Link>
        </div>
      ) : visit && patient ? (
        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div>
                <p className="text-sm font-medium text-blue-600">Visit Overview</p>
                <h2 className="mt-1 text-2xl font-semibold text-gray-900">{formatDate(visit.visitDate)}</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {visit.reason || 'No visit reason documented.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-blue-600">
                    {visit.department}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-gray-600">
                    Dr. {visit.doctor.name}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-gray-600">
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1">
                    Patient ID: {patient.patientId}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1">
                    Visit ID: {visit.visitId}
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-sm font-semibold text-gray-900">Patient Snapshot</div>
                <dl className="mt-3 space-y-3 text-sm text-gray-600">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-500">Date of Birth</dt>
                    <dd className="font-semibold text-gray-900">{formatDate(patient.dob)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-500">Age</dt>
                    <dd className="font-semibold text-gray-900">{age !== null ? `${age} yrs` : '—'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-500">Gender</dt>
                    <dd className="font-semibold text-gray-900">{gender}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-500">Insurance</dt>
                    <dd className="font-semibold text-gray-900">{coverage}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-500">Drug allergies</dt>
                    <dd className="text-right font-semibold text-gray-900">{allergies}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-gray-500">Contact</dt>
                    <dd className="text-right font-semibold text-gray-900">{contact}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          {(user?.role === 'Doctor' || user?.role === 'Pharmacist' || user?.role === 'ITAdmin') && (
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <PrescribeDrawer
                visitId={visit.visitId}
                patientId={patient.patientId}
                doctorOrders={visit.medications}
              />
            </section>
          )}

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Diagnoses</h3>
                <p className="mt-1 text-sm text-gray-600">Conditions assessed during this visit.</p>
              </div>
            </div>
            {visit.diagnoses.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {visit.diagnoses.map((diagnosis, index) => (
                  <span
                    key={`${diagnosis.diagnosis}-${index}`}
                    className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700"
                  >
                    {diagnosis.diagnosis}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No diagnoses captured for this visit.</p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Medications</h3>
                <p className="mt-1 text-sm text-gray-600">Therapies prescribed during the encounter.</p>
              </div>
            </div>
            {visit.medications.length > 0 ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {visit.medications.map((medication, index) => (
                  <div
                    key={`${medication.drugName}-${index}`}
                    className="rounded-xl border border-green-100 bg-green-50 p-4"
                  >
                    <div className="text-sm font-semibold text-green-700">{medication.drugName}</div>
                    {medication.dosage && (
                      <div className="mt-1 text-sm text-green-700">{medication.dosage}</div>
                    )}
                    {medication.instructions && (
                      <div className="mt-2 text-xs text-green-600">{medication.instructions}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No medications recorded for this visit.</p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Lab Results</h3>
                <p className="mt-1 text-sm text-gray-600">Key diagnostic tests captured during this visit.</p>
              </div>
            </div>
            {visit.labResults.length > 0 ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {visit.labResults.map((lab, index) => {
                  const value =
                    lab.resultValue !== null && lab.resultValue !== undefined
                      ? `${lab.resultValue}${lab.unit ? ` ${lab.unit}` : ''}`
                      : 'Pending';
                  return (
                    <div
                      key={`${lab.testName}-${lab.testDate ?? index}`}
                      className="rounded-xl border border-blue-100 bg-blue-50 p-4"
                    >
                      <div className="text-sm font-semibold text-blue-700">{lab.testName}</div>
                      <div className="mt-1 text-lg font-semibold text-blue-900">{value}</div>
                      {lab.testDate && (
                        <div className="mt-2 text-xs text-blue-600">Collected {formatDate(lab.testDate)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No lab results recorded for this visit.</p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Observations</h3>
                <p className="mt-1 text-sm text-gray-600">Clinician notes and vitals captured during the visit.</p>
              </div>
              <button
                type="button"
                onClick={handleAddObservation}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                Add Observation
              </button>
            </div>
            {visit.observations.length > 0 ? (
              <div className="mt-4 space-y-3">
                {visit.observations.map((observation) => {
                  const vitals = buildObservationVitals(observation);
                  return (
                    <div
                      key={observation.obsId}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                    >
                      <div className="text-sm font-medium text-gray-900">{observation.noteText}</div>
                      <div className="mt-1 text-xs text-gray-500">{formatDateTime(observation.createdAt)}</div>
                      {vitals.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {vitals.map((item) => (
                            <span
                              key={item}
                              className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
                <PatientsIcon className="h-12 w-12 text-gray-300" />
                <p className="text-sm font-medium text-gray-600">No observations recorded for this visit.</p>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Key Vitals</h3>
                <p className="mt-1 text-sm text-gray-600">Latest vitals captured during the visit.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {vitalMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {metric.label}
                  </div>
                  <div className="mt-2 text-base font-semibold text-gray-900">{metric.value}</div>
                </div>
              ))}
            </div>
            {!vitalsSource && (
              <p className="mt-3 text-xs text-gray-500">Vitals will appear here once recorded for this visit.</p>
            )}
          </section>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
          Visit not found.
        </div>
      )}
    </DashboardLayout>
  );
}
