import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Doctor } from '../api/client';
import {
  createVisitFormInitialValues,
  type VisitFormInitialValues,
  type VisitFormSubmitValues,
  type VisitFormObservationValues,
} from '../utils/visitForm';
import { useTranslation } from '../hooks/useTranslation';

interface VisitFormProps {
  doctors: Doctor[];
  initialValues?: VisitFormInitialValues;
  onSubmit: (values: VisitFormSubmitValues) => Promise<void> | void;
  submitLabel?: string;
  saving?: boolean;
  disableDoctorSelection?: boolean;
  disableVisitDate?: boolean;
  submitDisabled?: boolean;
  extraActions?: ReactNode;
}

type DiagnosisEntry = string;

type MedicationEntry = {
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
};

type LabEntry = {
  testName: string;
  resultValue: string;
  unit: string;
};

type VisitFormState = {
  visitDate: string;
  doctorId: string;
  department: string;
  reason: string;
  diagnoses: DiagnosisEntry[];
  medications: MedicationEntry[];
  labs: LabEntry[];
  obsNote: string;
  bpSystolic: string;
  bpDiastolic: string;
  heartRate: string;
  temperatureC: string;
  spo2: string;
  bmi: string;
};

export default function VisitForm({
  doctors,
  initialValues,
  onSubmit,
  submitLabel = 'Save Visit',
  saving = false,
  disableDoctorSelection = false,
  disableVisitDate = false,
  submitDisabled = false,
  extraActions = null,
}: VisitFormProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<VisitFormState>(() =>
    toState(initialValues ?? createVisitFormInitialValues()),
  );

  const initialKey = useMemo(
    () => JSON.stringify(initialValues ?? {}),
    [initialValues],
  );

  const doctorLookup = useMemo(() => {
    const map = new Map<string, Doctor>();
    doctors.forEach((doctor) => {
      map.set(doctor.doctorId, doctor);
    });
    return map;
  }, [doctors]);

  useEffect(() => {
    setState(toState(initialValues ?? createVisitFormInitialValues()));
  }, [initialKey, initialValues]);

  useEffect(() => {
    setState((current) => {
      if (!current.doctorId) {
        return current;
      }
      const doc = doctorLookup.get(current.doctorId);
      if (!doc) {
        return current;
      }
      if (current.department === doc.department) {
        return current;
      }
      return { ...current, department: doc.department };
    });
  }, [doctorLookup]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const diagnoses = state.diagnoses.map((item) => item.trim()).filter(Boolean);

    const medications = state.medications
      .map(({ drugName, dosage, frequency, duration }) => {
        const name = drugName.trim();
        if (!name) {
          return null;
        }

        // Keep separate fields for API compatibility
        return {
          drugName: name,
          dosage: dosage.trim(),
          frequency: frequency.trim(),
          duration: duration.trim(),
        };
      })
      .filter((medication): medication is { drugName: string; dosage: string; frequency: string; duration: string } => medication !== null && medication.drugName.length > 0);

    const labs = state.labs
      .map(({ testName, resultValue, unit }) => {
        const name = testName.trim();
        if (!name) {
          return null;
        }

        const numericValue = resultValue.trim();
        const parsedValue = numericValue ? Number(numericValue) : undefined;

        return {
          testName: name,
          ...(parsedValue !== undefined && !Number.isNaN(parsedValue)
            ? { resultValue: parsedValue }
            : {}),
          ...(unit.trim() ? { unit: unit.trim() } : {}),
        };
      })
      .filter((lab): lab is { testName: string; resultValue?: number; unit?: string } => lab !== null);

    const observationValues = buildObservation(state);

    await onSubmit({
      visitDate: state.visitDate,
      doctorId: state.doctorId,
      department: state.department,
      reason: state.reason.trim() ? state.reason.trim() : undefined,
      diagnoses,
      medications,
      labs,
      observation: observationValues,
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label className="block text-sm font-medium text-gray-700">{t('Visit Date')}</label>
        <input
          type="date"
          value={state.visitDate}
          onChange={(event) => setState((current) => ({ ...current, visitDate: event.target.value }))}
          className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          required
          disabled={disableVisitDate}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('Doctor')}</label>
        <select
          value={state.doctorId}
          onChange={(event) => {
            const doctorId = event.target.value;
            const doctor = doctorLookup.get(doctorId);
            setState((current) => ({
              ...current,
              doctorId,
              department: doctor ? doctor.department : '',
            }));
          }}
          className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          required
          disabled={disableDoctorSelection}
        >
          <option value="" disabled>
            {t('Select Doctor')}
          </option>
          {doctors.map((doctor) => (
            <option key={doctor.doctorId} value={doctor.doctorId}>
              {`${doctor.name} - ${doctor.department}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('Department')}</label>
        <input
          type="text"
          value={state.department}
          readOnly
          className="mt-1 w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('Reason')}</label>
        <input
          type="text"
          value={state.reason}
          onChange={(event) => setState((current) => ({ ...current, reason: event.target.value }))}
          className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">{t('Diagnoses')}</label>
          <button
            type="button"
            onClick={() =>
              setState((current) => ({
                ...current,
                diagnoses: [...current.diagnoses, ''],
              }))
            }
            className="inline-flex items-center rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-100"
          >
            + {t('Add Diagnosis')}
          </button>
        </div>
        <div className="mt-2 space-y-3">
          {state.diagnoses.map((diagnosis, index) => (
            <div key={`diagnosis-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <input
                  type="text"
                  value={diagnosis}
                  onChange={(event) => {
                    const value = event.target.value;
                    setState((current) => {
                      const diagnoses = [...current.diagnoses];
                      diagnoses[index] = value;
                      return { ...current, diagnoses };
                    });
                  }}
                  className="flex-1 rounded-md border-gray-300 shadow-sm"
                  placeholder={t('Enter diagnosis')}
                />
                {state.diagnoses.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) => {
                        const diagnoses = current.diagnoses.filter((_, i) => i !== index);
                        return {
                          ...current,
                          diagnoses: diagnoses.length ? diagnoses : [''],
                        };
                      })
                    }
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    {t('Remove')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">{t('Prescriptions')}</label>
          <button
            type="button"
            onClick={() =>
              setState((current) => ({
                ...current,
                medications: [...current.medications, createEmptyMedicationEntry()],
              }))
            }
            className="inline-flex items-center rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-100"
          >
            + {t('Add Prescription')}
          </button>
        </div>
        <div className="mt-2 space-y-3">
          {state.medications.map((medication, index) => (
            <div key={`medication-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Prescription Name')}</label>
                  <input
                    type="text"
                    value={medication.drugName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const medications = [...current.medications];
                        medications[index] = { ...medications[index], drugName: value };
                        return { ...current, medications };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., Amoxicillin')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Dosage')}</label>
                  <input
                    type="text"
                    value={medication.dosage}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const medications = [...current.medications];
                        medications[index] = { ...medications[index], dosage: value };
                        return { ...current, medications };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., 500mg')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Frequency (OD/BD)')}</label>
                  <input
                    type="text"
                    value={medication.frequency}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const medications = [...current.medications];
                        medications[index] = { ...medications[index], frequency: value };
                        return { ...current, medications };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., OD')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Duration (days)')}</label>
                  <input
                    type="number"
                    min="0"
                    value={medication.duration}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const medications = [...current.medications];
                        medications[index] = { ...medications[index], duration: value };
                        return { ...current, medications };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., 5')}
                  />
                </div>
              </div>
              {state.medications.length > 1 && (
                <div className="mt-3 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) => {
                        const medications = current.medications.filter((_, i) => i !== index);
                        return {
                          ...current,
                          medications: medications.length ? medications : [createEmptyMedicationEntry()],
                        };
                      })
                    }
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    {t('Remove')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">{t('Labs')}</label>
          <button
            type="button"
            onClick={() =>
              setState((current) => ({
                ...current,
                labs: [...current.labs, createEmptyLabEntry()],
              }))
            }
            className="inline-flex items-center rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-100"
          >
            + {t('Add Lab Result')}
          </button>
        </div>
        <div className="mt-2 space-y-3">
          {state.labs.map((lab, index) => (
            <div key={`lab-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Test Name')}</label>
                  <input
                    type="text"
                    value={lab.testName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const labs = [...current.labs];
                        labs[index] = { ...labs[index], testName: value };
                        return { ...current, labs };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., Hemoglobin')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Value')}</label>
                  <input
                    type="text"
                    value={lab.resultValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const labs = [...current.labs];
                        labs[index] = { ...labs[index], resultValue: value };
                        return { ...current, labs };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., 13.5')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500">{t('Unit')}</label>
                  <input
                    type="text"
                    value={lab.unit}
                    onChange={(event) => {
                      const value = event.target.value;
                      setState((current) => {
                        const labs = [...current.labs];
                        labs[index] = { ...labs[index], unit: value };
                        return { ...current, labs };
                      });
                    }}
                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
                    placeholder={t('e.g., g/dL')}
                  />
                </div>
              </div>
              {state.labs.length > 1 && (
                <div className="mt-3 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setState((current) => {
                        const labs = current.labs.filter((_, i) => i !== index);
                        return {
                          ...current,
                          labs: labs.length ? labs : [createEmptyLabEntry()],
                        };
                      })
                    }
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    {t('Remove')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('Observation Note')}</label>
        <textarea
          value={state.obsNote}
          onChange={(event) => setState((current) => ({ ...current, obsNote: event.target.value }))}
          className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          rows={2}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">{t('BP Systolic')}</label>
          <input
            type="number"
            value={state.bpSystolic}
            onChange={(event) => setState((current) => ({ ...current, bpSystolic: event.target.value }))}
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{t('BP Diastolic')}</label>
          <input
            type="number"
            value={state.bpDiastolic}
            onChange={(event) => setState((current) => ({ ...current, bpDiastolic: event.target.value }))}
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{t('Heart Rate')}</label>
          <input
            type="number"
            value={state.heartRate}
            onChange={(event) => setState((current) => ({ ...current, heartRate: event.target.value }))}
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{t('Temp (°C)')}</label>
          <input
            type="number"
            value={state.temperatureC}
            onChange={(event) => setState((current) => ({ ...current, temperatureC: event.target.value }))}
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{t('SpO₂')}</label>
          <input
            type="number"
            value={state.spo2}
            onChange={(event) => setState((current) => ({ ...current, spo2: event.target.value }))}
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">{t('BMI')}</label>
          <input
            type="number"
            value={state.bmi}
            onChange={(event) => setState((current) => ({ ...current, bmi: event.target.value }))}
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving || submitDisabled}
          className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white shadow ${
            saving || submitDisabled ? 'cursor-not-allowed bg-gray-300 text-gray-600' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {saving ? t('Saving...') : t(submitLabel)}
        </button>
        {extraActions}
      </div>
    </form>
  );
}

function toState(values: VisitFormInitialValues): VisitFormState {
  return {
    visitDate: values.visitDate,
    doctorId: values.doctorId,
    department: values.department,
    reason: values.reason ?? '',
    diagnoses: values.diagnoses.length ? [...values.diagnoses] : [''],
    medications: values.medications.length
      ? values.medications.map((medication) =>
          createEmptyMedicationEntry({
            drugName: medication.drugName,
            dosage: medication.dosage ?? '',
          }),
        )
      : [createEmptyMedicationEntry()],
    labs: values.labs.length
      ? values.labs.map((lab) =>
          createEmptyLabEntry({
            testName: lab.testName,
            resultValue:
              lab.resultValue !== undefined && lab.resultValue !== null
                ? String(lab.resultValue)
                : '',
            unit: lab.unit ?? '',
          }),
        )
      : [createEmptyLabEntry()],
    obsNote: values.observation?.noteText ?? '',
    bpSystolic: values.observation?.bpSystolic?.toString() ?? '',
    bpDiastolic: values.observation?.bpDiastolic?.toString() ?? '',
    heartRate: values.observation?.heartRate?.toString() ?? '',
    temperatureC: values.observation?.temperatureC?.toString() ?? '',
    spo2: values.observation?.spo2?.toString() ?? '',
    bmi: values.observation?.bmi?.toString() ?? '',
  };
}

function buildObservation(
  state: VisitFormState,
): VisitFormObservationValues | undefined {
  const note = state.obsNote.trim();
  const bpSystolic = state.bpSystolic.trim();
  const bpDiastolic = state.bpDiastolic.trim();
  const heartRate = state.heartRate.trim();
  const temperatureC = state.temperatureC.trim();
  const spo2 = state.spo2.trim();
  const bmi = state.bmi.trim();

  const hasValues =
    note || bpSystolic || bpDiastolic || heartRate || temperatureC || spo2 || bmi;

  if (!hasValues) {
    return undefined;
  }

  return {
    noteText: note,
    ...(bpSystolic ? { bpSystolic: Number(bpSystolic) } : {}),
    ...(bpDiastolic ? { bpDiastolic: Number(bpDiastolic) } : {}),
    ...(heartRate ? { heartRate: Number(heartRate) } : {}),
    ...(temperatureC ? { temperatureC: Number(temperatureC) } : {}),
    ...(spo2 ? { spo2: Number(spo2) } : {}),
    ...(bmi ? { bmi: Number(bmi) } : {}),
  };
}

function createEmptyMedicationEntry(
  overrides: Partial<MedicationEntry> = {},
): MedicationEntry {
  return {
    drugName: overrides.drugName ?? '',
    dosage: overrides.dosage ?? '',
    frequency: overrides.frequency ?? '',
    duration: overrides.duration ?? '',
  };
}

function createEmptyLabEntry(overrides: Partial<LabEntry> = {}): LabEntry {
  return {
    testName: overrides.testName ?? '',
    resultValue: overrides.resultValue ?? '',
    unit: overrides.unit ?? '',
  };
}
