import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';

const defaultSnippet = `<iframe
  src="https://patient-portal.example.com/embed"
  title="Thu Kha Patient Portal"
  data-context-key="{{contextKey}}"
  allow="clipboard-write; camera; microphone"
  style="border:0;width:100%;min-height:720px;border-radius:16px;"
></iframe>`;

export default function Integration() {
  const { t } = useTranslation();
  const [iframeCode, setIframeCode] = useState(defaultSnippet);
  const [contextKey, setContextKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [recordId, setRecordId] = useState<string | null>(null);

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
      const response = await fetch('/api/patient-portal/integration-embeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          iframeCode: iframeCode.trim(),
          contextKey: contextKey.trim(),
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
    <div className="min-h-screen bg-slate-50 py-12">
      <main className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-8 shadow-xl">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold text-slate-900">{t('Integration settings')}</h1>
          <p className="text-sm text-slate-500">{t('Manage the iframe embed code and context key below.')}</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
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
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
