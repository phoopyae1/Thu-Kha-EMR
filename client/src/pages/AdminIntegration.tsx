import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import type { Role } from '../api/client';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'Doctor', label: 'Doctor' },
  { value: 'AdminAssistant', label: 'Administrative Assistant' },
  { value: 'Cashier', label: 'Cashier' },
  { value: 'ITAdmin', label: 'IT Administrator' },
  { value: 'Pharmacist', label: 'Pharmacist' },
  { value: 'PharmacyTech', label: 'Pharmacy Technician' },
  { value: 'InventoryManager', label: 'Inventory Manager' },
  { value: 'Nurse', label: 'Nurse' },
  { value: 'LabTech', label: 'Laboratory Technician' },
];

export default function AdminIntegration() {
  const { t } = useTranslation();
  const [iframeCode, setIframeCode] = useState('');
  const [contextKey, setContextKey] = useState('');
  const [role, setRole] = useState<Role>('Doctor');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveResult, setSaveResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [recordId, setRecordId] = useState<string | null>(null);

  // Load existing admin integration embed on mount and when role changes
  useEffect(() => {
    const loadIntegration = async () => {
      setIsLoading(true);
      // Clear fields while loading new role's data
      setIframeCode('');
      setContextKey('');
      
      try {
        // Load integration for the current selected role
        const response = await fetch(`/api/patient-portal/admin-integration-embeds/latest?role=${encodeURIComponent(role)}`);
        if (response.status === 404) {
          // No admin integration embed configured yet for this role
          setIsLoading(false);
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to load admin integration embed');
        }
        const body = (await response.json()) as { embed?: { iframeCode?: string; contextKey?: string; role?: Role } | null };
        if (body.embed) {
          setIframeCode(body.embed.iframeCode || '');
          setContextKey(body.embed.contextKey || '');
          // Don't update role from response to avoid infinite loop
        }
      } catch (error) {
        console.error('Failed to load admin integration embed:', error);
        // Still show the form even if loading fails
      } finally {
        setIsLoading(false);
      }
    };

    loadIntegration();
  }, [role]);

  const isSubmitDisabled = useMemo(() => {
    const trimmedKey = contextKey.trim();
    return isSaving || trimmedKey.length === 0 || iframeCode.trim().length === 0;
  }, [contextKey, iframeCode, isSaving]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    setIsSaving(true);
    setSaveResult('idle');
    setErrorMessage('');
    setRecordId(null);

    try {
      const response = await fetch('/api/patient-portal/admin-integration-embeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          iframeCode: iframeCode.trim(),
          contextKey: contextKey.trim(),
          role: role,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error ?? t('Unable to save integration details.');
        throw new Error(message);
      }

      const body = (await response.json().catch(() => ({}))) as { id?: string | null };

      setRecordId(body.id ?? null);
      setSaveResult('success');
    } catch (error) {
      setSaveResult('error');
      setErrorMessage(error instanceof Error ? error.message : t('Unknown error occurred.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 py-12 px-4">
      <main className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-xl">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold text-slate-900">{t('Integration settings')}</h1>
          <p className="text-sm text-slate-500">{t('Manage the iframe embed code and context key below.')}</p>
        </div>

        {isLoading && (
          <div className="mt-8 py-4 text-center text-sm text-slate-500">
            {t('Loading integration settings...')}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="role">
              {t('Role')}
            </label>
            <select
              id="role"
              name="role"
              required
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="contextKey">
              {t('Context key')}
            </label>
            <input
              id="contextKey"
              name="contextKey"
              type="text"
              required
              value={contextKey}
              onChange={(event) => setContextKey(event.target.value)}
              placeholder={t('Paste the generated context key here')}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="iframeCode">
              {t('Iframe code snippet')}
            </label>
            <textarea
              id="iframeCode"
              name="iframeCode"
              required
              rows={6}
              value={iframeCode}
              onChange={(event) => setIframeCode(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSaving ? t('Saving…') : t('Save')}
            </button>

            {saveResult === 'success' && (
              <p className="text-sm font-medium text-green-600">
                {recordId
                  ? t('Integration saved. Document id: {{id}}', { id: recordId })
                  : t('Integration saved successfully.')}
              </p>
            )}

            {saveResult === 'error' && (
              <p className="text-sm font-medium text-red-600">
                {errorMessage || t('Unable to save integration details.')}
              </p>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

