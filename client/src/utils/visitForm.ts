import {
  addDiagnosis,
  addLabResult,
  addMedication,
  addObservation,
  type Observation,
  type VisitDetail,
} from '../api/client';

export interface VisitFormObservationValues {
  noteText: string;
  bpSystolic?: number;
  bpDiastolic?: number;
  heartRate?: number;
  temperatureC?: number;
  spo2?: number;
  bmi?: number;
}

export interface VisitFormSubmitValues {
  visitDate: string;
  doctorId: string;
  department: string;
  reason?: string;
  diagnoses: string[];
  medications: Array<{ drugName: string; dosage?: string; frequency?: string; duration?: string }>;
  labs: Array<{ testName: string; resultValue?: number; unit?: string }>;
  observation?: VisitFormObservationValues;
}

export type VisitFormInitialValues = VisitFormSubmitValues;

export function createVisitFormInitialValues(
  overrides: Partial<VisitFormInitialValues> = {},
): VisitFormInitialValues {
  return {
    visitDate: overrides.visitDate ?? new Date().toISOString().slice(0, 10),
    doctorId: overrides.doctorId ?? '',
    department: overrides.department ?? '',
    reason: overrides.reason,
    diagnoses: overrides.diagnoses ?? [],
    medications: overrides.medications ?? [],
    labs: overrides.labs ?? [],
    observation: overrides.observation,
  };
}

export function visitDetailToInitialValues(visit: VisitDetail): VisitFormInitialValues {
  const latestObservation = visit.observations[0];
  return {
    visitDate: normalizeDateInput(visit.visitDate),
    doctorId: visit.doctorId,
    department: visit.department,
    reason: visit.reason ?? undefined,
    diagnoses: visit.diagnoses.map((diagnosis) => diagnosis.diagnosis),
    medications: visit.medications.map((medication) => ({
      drugName: medication.drugName,
      ...(medication.dosage ? { dosage: medication.dosage } : {}),
    })),
    labs: visit.labResults.map((lab) => ({
      testName: lab.testName,
      ...(lab.resultValue !== null && lab.resultValue !== undefined
        ? { resultValue: lab.resultValue }
        : {}),
      ...(lab.unit ? { unit: lab.unit } : {}),
    })),
    observation: latestObservation
      ? mapObservationToForm(latestObservation)
      : undefined,
  };
}

export async function persistVisitFormValues(
  visitId: string,
  values: VisitFormSubmitValues,
): Promise<void> {
  for (const diagnosis of values.diagnoses) {
    const trimmed = diagnosis.trim();
    if (!trimmed) continue;
    await addDiagnosis(visitId, { diagnosis: trimmed });
  }

  for (const medication of values.medications) {
    const drugName = medication.drugName.trim();
    if (!drugName) continue;
    await addMedication(visitId, {
      drugName,
      ...(medication.dosage ? { dosage: medication.dosage } : {}),
    });
  }

  for (const lab of values.labs) {
    const testName = lab.testName.trim();
    if (!testName) continue;
    await addLabResult(visitId, {
      testName,
      ...(lab.resultValue !== undefined ? { resultValue: lab.resultValue } : {}),
      ...(lab.unit ? { unit: lab.unit } : {}),
    });
  }

  if (values.observation) {
    await addObservation(visitId, values.observation);
  }
}

function normalizeDateInput(value: string): string {
  return value.includes('T') ? value.split('T')[0] : value;
}

function mapObservationToForm(observation: Observation): VisitFormObservationValues {
  return {
    noteText: observation.noteText,
    ...(observation.bpSystolic !== null && observation.bpSystolic !== undefined
      ? { bpSystolic: observation.bpSystolic }
      : {}),
    ...(observation.bpDiastolic !== null && observation.bpDiastolic !== undefined
      ? { bpDiastolic: observation.bpDiastolic }
      : {}),
    ...(observation.heartRate !== null && observation.heartRate !== undefined
      ? { heartRate: observation.heartRate }
      : {}),
    ...(observation.temperatureC !== null && observation.temperatureC !== undefined
      ? { temperatureC: observation.temperatureC }
      : {}),
    ...(observation.spo2 !== null && observation.spo2 !== undefined ? { spo2: observation.spo2 } : {}),
    ...(observation.bmi !== null && observation.bmi !== undefined ? { bmi: observation.bmi } : {}),
  };
}
