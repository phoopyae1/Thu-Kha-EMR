import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarIcon, CheckIcon, MessageIcon } from '../components/icons';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';

interface PortalRequestForm {
  name: string;
  contact: string;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  notes: string;
}

const defaultForm: PortalRequestForm = {
  name: '',
  contact: '',
  preferredDate: '',
  preferredTime: '',
  reason: '',
  notes: '',
};

export default function PatientPortal() {
  const { appName, logo, widgetEnabled } = useSettings();
  const { t } = useTranslation();
  const [formValues, setFormValues] = useState<PortalRequestForm>(defaultForm);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');

  const displayName = appName || t('EMR System');
  const heroTitle = useMemo(() => t('Welcome to {name}', { name: displayName }), [displayName, t]);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormValues((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');

    await new Promise((resolve) => setTimeout(resolve, 600));

    try {
      const existingRaw = localStorage.getItem('patientPortalRequests');
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const requestRecord = {
        ...formValues,
        submittedAt: new Date().toISOString(),
      };
      const updated = Array.isArray(existing) ? [...existing, requestRecord] : [requestRecord];
      localStorage.setItem('patientPortalRequests', JSON.stringify(updated));
      setStatus('success');
      setFormValues(defaultForm);
    } catch (error) {
      console.error('Unable to store request locally', error);
      setStatus('success');
    }
  };

  const featureCards = [
    {
      icon: CalendarIcon,
      title: t('Book visits in minutes'),
      body: t('Pick a time that works for you and our staff will confirm shortly.'),
    },
    {
      icon: MessageIcon,
      title: t('Stay connected'),
      body: t('Receive reminders and helpful updates once your request is confirmed.'),
    },
    {
      icon: CheckIcon,
      title: t('Personalized care'),
      body: t('Share the reason for your visit so our care team can prepare in advance.'),
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-white">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt={`${displayName} logo`} className="h-10 w-auto rounded" />
          ) : (
            <span className="text-xl font-semibold text-blue-700">{displayName}</span>
          )}
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t('Patient Portal')}
          </span>
        </div>
        <Link
          to="/login"
          className="rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
        >
          {t('Return to staff login')}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 pb-16">
        <section className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-3xl bg-blue-700 p-10 text-white shadow-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-100">
              {t('Care that revolves around you')}
            </div>
            <h1 className="mt-6 text-4xl font-bold leading-tight sm:text-5xl">{heroTitle}</h1>
            <p className="mt-4 text-lg text-blue-100">
              {t('A simple, patient-friendly portal to check in, request visits, and stay informed.')}
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {featureCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm backdrop-blur"
                  >
                    <Icon className="h-6 w-6 text-white" />
                    <div className="mt-3 font-semibold">{card.title}</div>
                    <p className="mt-1 text-blue-100/90">{card.body}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-8 shadow-xl">
            <h2 className="text-2xl font-semibold text-gray-900">{t('Request an appointment')}</h2>
            <p className="mt-2 text-sm text-gray-500">{t("We'll confirm your request within one business day.")}</p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="name" className="text-sm font-medium text-gray-700">
                  {t('Full name')}
                </label>
                <input
                  id="name"
                  name="name"
                  value={formValues.name}
                  onChange={handleChange}
                  required
                  className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label htmlFor="contact" className="text-sm font-medium text-gray-700">
                  {t('Contact details (phone or email)')}
                </label>
                <input
                  id="contact"
                  name="contact"
                  value={formValues.contact}
                  onChange={handleChange}
                  required
                  className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="preferredDate" className="text-sm font-medium text-gray-700">
                    {t('Preferred date')}
                  </label>
                  <input
                    type="date"
                    id="preferredDate"
                    name="preferredDate"
                    value={formValues.preferredDate}
                    onChange={handleChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div>
                  <label htmlFor="preferredTime" className="text-sm font-medium text-gray-700">
                    {t('Preferred time')}
                  </label>
                  <input
                    type="time"
                    id="preferredTime"
                    name="preferredTime"
                    value={formValues.preferredTime}
                    onChange={handleChange}
                    required
                    className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="reason" className="text-sm font-medium text-gray-700">
                  {t('Reason for visit')}
                </label>
                <input
                  id="reason"
                  name="reason"
                  value={formValues.reason}
                  onChange={handleChange}
                  required
                  className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label htmlFor="notes" className="text-sm font-medium text-gray-700">
                  {t('Additional notes (optional)')}
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  value={formValues.notes}
                  onChange={handleChange}
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-400"
              >
                {status === 'submitting' ? t('Submitting...') : t('Submit request')}
              </button>
              {status === 'success' && (
                <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700" role="status" aria-live="polite">
                  <div className="font-semibold">{t('Request received!')}</div>
                  <p className="mt-1">{t('Thank you for reaching out. A coordinator will get in touch soon.')}</p>
                </div>
              )}
            </form>
          </div>
        </section>

        {widgetEnabled && (
          <section className="rounded-3xl border border-blue-100 bg-blue-50/60 p-8 shadow-inner">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-semibold text-blue-900">{t('Chat with our digital assistant')}</h2>
                <p className="mt-2 text-sm text-blue-800">
                  {t('Have a quick question? Our assistant can help anytime, and a team member will follow up when needed.')}
                </p>
              </div>
            </div>
            <div className="mt-6 overflow-hidden rounded-3xl border border-blue-100 bg-white shadow">
              <iframe
                title={t('Patient assistant chat')}
                src="https://demo.atenxion.ai/chat-widget?agentchainId=68c11a6aac23300903b7d455"
                className="h-[420px] w-full"
                frameBorder={0}
                allow="midi 'src'; geolocation 'src'; microphone 'src'; camera 'src'; display-capture 'src'; encrypted-media 'src';"
              />
            </div>
          </section>
        )}

        <section className="grid gap-8 rounded-3xl bg-white p-8 shadow-sm md:grid-cols-3">
          {featureCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={`feature-${card.title}`} className="flex flex-col gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{card.title}</h3>
                  <p className="mt-2 text-sm text-gray-600">{card.body}</p>
                </div>
              </div>
            );
          })}
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-gray-500 sm:flex-row">
          <div>© {new Date().getFullYear()} {displayName}. {t('All rights reserved.')}</div>
          <div className="flex items-center gap-4">
            <a href="mailto:hello@example.com" className="hover:text-gray-700">
              {t('Contact support')}
            </a>
            <Link to="/" className="hover:text-gray-700">
              {t('Explore services')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
