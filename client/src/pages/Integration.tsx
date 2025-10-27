import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';

const defaultSnippet = `<iframe
  src="https://patient-portal.example.com/embed"
  title="Thu Kha Patient Portal"
  data-context-key="{{contextKey}}"
  allow="clipboard-write; camera; microphone"
  style="border:0;width:100%;min-height:720px;border-radius:16px;"
></iframe>`;

export default function Integration() {
  const { appName, logo } = useSettings();
  const { t } = useTranslation();

  const displayName = appName || t('Thu Kha EMR');
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
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-12 text-center">
        <div className="flex flex-col items-center gap-3">
          {logo ? (
            <img src={logo} alt={`${displayName} logo`} className="h-12 w-auto rounded-xl" />
          ) : (
            <span className="rounded-full bg-blue-100 px-4 py-1 text-sm font-semibold uppercase tracking-wide text-blue-700">
              {displayName}
            </span>
          )}
          <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">
            {t('Integrate the patient portal anywhere')}
          </h1>
          <p className="max-w-2xl text-base text-slate-600 sm:text-lg">
            {t(
              'Embed the portal into your existing website or application with a secure iframe and contextual data so patients stay signed in and see the right information.'
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/"
              className="rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              {t('Back to patient portal landing')}
            </Link>
            <Link
              to="/login"
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-700"
            >
              {t('Preview live portal')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-14 flex w-full max-w-5xl flex-col gap-12 px-6">
        <section className="rounded-3xl bg-white p-8 shadow-xl">
          <h2 className="text-2xl font-semibold text-slate-900">{t('1. Copy the embed snippet')}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {t(
              'Drop this iframe into the page where you want the portal to appear. Adjust the height, border radius, or permissions to match your host site.'
            )}
          </p>
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-slate-900 p-6 text-sm text-slate-50 shadow-inner">
            <code>{iframeCode}</code>
          </pre>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-white p-8 shadow-xl">
            <h2 className="text-2xl font-semibold text-slate-900">{t('2. Provide contextual data')}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {t(
                'Use the data-context-key attribute to pass a signed token or unique identifier. The portal exchanges the key for patient data without exposing PHI in the host page.'
              )}
            </p>
            <ul className="mt-6 space-y-4 text-sm text-slate-600">
              <li>
                <span className="font-semibold text-slate-900">{t('Generate a one-time context key')}</span>
                <p>{t('Create the key on your server using the Integration API or admin console.')}</p>
              </li>
              <li>
                <span className="font-semibold text-slate-900">{t('Attach metadata')}</span>
                <p>
                  {t(
                    'Include the patient ID, appointment reference, and locale preferences when generating the key so the embedded portal loads the correct view instantly.'
                  )}
                </p>
              </li>
              <li>
                <span className="font-semibold text-slate-900">{t('Expire keys quickly')}</span>
                <p>{t('Set a short TTL and revoke keys after first use to keep sessions secure.')}</p>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl bg-blue-700 p-8 text-white shadow-xl">
            <h2 className="text-2xl font-semibold">{t('3. Test with sandbox data')}</h2>
            <p className="mt-2 text-sm text-blue-100">
              {t(
                'Use the sandbox environment to verify the embedded experience. Swap the iframe source between sandbox and production URLs as you promote changes.'
              )}
            </p>
            <div className="mt-6 space-y-4 rounded-2xl bg-white/10 p-6 text-sm text-blue-50">
              <div>
                <p className="font-semibold uppercase tracking-wide text-blue-100">{t('Sandbox iframe URL')}</p>
                <p>https://patient-portal.sandbox.thukha.com/embed</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-blue-100">{t('Production iframe URL')}</p>
                <p>https://patient-portal.thukha.com/embed</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-blue-100">{t('Context key header')}</p>
                <p>X-ThuKha-Context-Key</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-dashed border-blue-200 bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">{t('Sample request to mint a context key')}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {t('Send this payload to the Integration API or adapt it for your preferred language or SDK.')}
          </p>
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-slate-900 p-6 text-sm text-slate-50 shadow-inner">
            <code>{`POST https://api.thukha.com/patient-portal/context-keys\nContent-Type: application/json\n\n{\n  "patientId": "PAT-123456",\n  "expiresInSeconds": 300,\n  "metadata": {\n    "appointmentId": "APT-98765",\n    "preferredLanguage": "en"\n  }\n}`}</code>
          </pre>
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-xl">
          <h2 className="text-2xl font-semibold text-slate-900">{t('4. Persist your integration settings')}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {t(
              'Store the iframe code and generated context key so you can reuse or audit the configuration later. We send this data securely to MongoDB via the integration API.'
            )}
          </p>

          <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
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
              <p className="mt-2 text-xs text-slate-500">
                {t('Update the snippet if you customize styling or attributes before saving it to MongoDB.')}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isSaving ? t('Saving to MongoDB…') : t('Save to MongoDB')}
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
        </section>
      </main>
    </div>
  );
}
