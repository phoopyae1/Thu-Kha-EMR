import { ChangeEvent, FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import {
  createDrug,
  scanInvoiceForInventory,
  type CreateDrugPayload,
  type Drug,
  type InvoiceScanLineItem,
  type InvoiceScanResult,
} from '../api/client';
import { useTranslation } from '../hooks/useTranslation';
import useAdminBasePath from '../hooks/useAdminBasePath';

interface DrugFormState {
  name: string;
  genericName: string;
  form: string;
  strength: string;
  routeDefault: string;
  isActive: boolean;
}

const EMPTY_FORM: DrugFormState = {
  name: '',
  genericName: '',
  form: '',
  strength: '',
  routeDefault: '',
  isActive: true,
};

export default function AddDrug() {
  const { t } = useTranslation();
  const adminBasePath = useAdminBasePath();
  const [form, setForm] = useState<DrugFormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [createdDrug, setCreatedDrug] = useState<Drug | null>(null);
  const [invoiceResult, setInvoiceResult] = useState<InvoiceScanResult | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setFeedback(null);
    setCreatedDrug(null);

    const trimmedName = form.name.trim();
    const trimmedForm = form.form.trim();
    const trimmedStrength = form.strength.trim();

    if (!trimmedName || !trimmedForm || !trimmedStrength) {
      setFeedback({
        type: 'error',
        message: t('Name, form, and strength are required to add a medication.'),
      });
      return;
    }

    const payload: CreateDrugPayload = {
      name: trimmedName,
      form: trimmedForm,
      strength: trimmedStrength,
      isActive: form.isActive,
    };

    const generic = form.genericName.trim();
    if (generic) {
      payload.genericName = generic;
    }

    const route = form.routeDefault.trim();
    if (route) {
      payload.routeDefault = route;
    }

    setSaving(true);
    try {
      const created = await createDrug(payload);
      setCreatedDrug(created);
      setForm(() => ({ ...EMPTY_FORM }));
      setFeedback({
        type: 'success',
        message: t('Medication added successfully.'),
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message:
          error instanceof Error ? error.message : t('Unable to add medication. Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleInvoiceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanStatus('scanning');
    setScanError(null);
    setApplyNotice(null);
    try {
      const result = await scanInvoiceForInventory(file);
      setInvoiceResult(result);
      setScanStatus('success');
      if (!result.lineItems.length) {
        setApplyNotice(t('No medication lines were detected. Enter the details manually.'));
      }
    } catch (error) {
      setInvoiceResult(null);
      setScanStatus('error');
      setScanError(
        error instanceof Error ? error.message : t('Unable to scan the invoice automatically. Please try again.'),
      );
    } finally {
      event.target.value = '';
    }
  }

  function applyInvoiceLine(line: InvoiceScanLineItem) {
    const nextForm: DrugFormState = {
      ...form,
      name: line.brandName ?? line.genericName ?? form.name,
      genericName: line.genericName ?? form.genericName,
      form: line.form ?? form.form,
      strength: line.strength ?? form.strength,
    };
    setForm(nextForm);

    const missing: string[] = [];
    if (!nextForm.name.trim()) {
      missing.push(t('Brand or trade name'));
    }
    if (!nextForm.form.trim()) {
      missing.push(t('Form'));
    }
    if (!nextForm.strength.trim()) {
      missing.push(t('Strength'));
    }

    setApplyNotice(
      missing.length
        ? t('Review the prefilled data and add the missing fields: {{fields}}.', {
            fields: missing.join(', '),
          })
        : t('Review the prefilled fields, then save the medication to finish.'),
    );
  }

  const invoiceLines = invoiceResult?.lineItems ?? [];
  const invoiceMetadata = invoiceResult?.metadata;
  const scanWarnings = invoiceResult?.warnings ?? [];

  function formatCurrency(amount: number) {
    const currency = invoiceMetadata?.currency ?? 'USD';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
    } catch {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
    }
  }

  return (
    <DashboardLayout
      title={t('Add medication to formulary')}
      subtitle={t('Capture the key details so the pharmacy team can manage stock and dispensing.')}
      activeItem="pharmacy"
      headerChildren={
        <Link
          to={`${adminBasePath}/pharmacy/inventory`}
          className="inline-flex items-center justify-center rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-100"
        >
          {t('Back to inventory')}
        </Link>
      }
    >
      <div className="space-y-6">
        {feedback ? (
          <div
            className={`rounded-2xl border p-5 text-sm shadow-sm ${
              feedback.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <p>{feedback.message}</p>
            {feedback.type === 'success' && createdDrug ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-green-700">
                  {createdDrug.name} {createdDrug.strength}
                </span>
                <Link
                  to={`${adminBasePath}/pharmacy/inventory`}
                  className="inline-flex items-center justify-center rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-green-700"
                >
                  {t('Manage inventory for this medication')}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('Medication details')}</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {t('Provide formulary information to make the drug available across the system.')}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                {t('Required fields marked with *')}
              </span>
            </div>

            <div className="mt-6 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-blue-900">{t('Scan supplier invoice')}</h3>
                  <p className="mt-1 text-xs text-blue-900/80">
                    {t('Upload an invoice to automatically capture medication details for this form.')}
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-blue-500 bg-white px-4 py-2 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="sr-only"
                    onChange={handleInvoiceUpload}
                  />
                  {scanStatus === 'scanning' ? t('Scanning…') : t('Upload invoice')}
                </label>
              </div>

              {scanStatus === 'scanning' ? (
                <p className="mt-3 text-xs font-medium text-blue-900">{t('Scanning invoice with AI…')}</p>
              ) : null}
              {scanError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-600 shadow-sm">
                  {scanError}
                </div>
              ) : null}

              {invoiceResult ? (
                <div className="mt-4 space-y-3">
                  {invoiceMetadata &&
                  (invoiceMetadata.vendor || invoiceMetadata.invoiceNumber || invoiceMetadata.invoiceDate) ? (
                    <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-blue-900 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {invoiceMetadata.vendor ? (
                          <span className="font-semibold">{invoiceMetadata.vendor}</span>
                        ) : null}
                        {invoiceMetadata.invoiceNumber ? (
                          <span className="text-blue-900/70">
                            {t('Invoice #{{number}}', { number: invoiceMetadata.invoiceNumber })}
                          </span>
                        ) : null}
                        {invoiceMetadata.invoiceDate ? (
                          <span className="text-blue-900/70">
                            {t('Dated {{date}}', { date: invoiceMetadata.invoiceDate })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {scanWarnings.length ? (
                    <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 shadow-sm">
                      <p className="font-semibold">{t('Review required')}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {scanWarnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {invoiceLines.length ? (
                    <div className="space-y-2">
                      {invoiceLines.map((line, index) => {
                        const label = line.brandName || line.genericName || t('Line {{number}}', { number: index + 1 });
                        const secondary = [line.strength, line.form].filter(Boolean).join(' • ');
                        const details = [
                          line.packageDescription,
                          line.quantity != null ? t('{{qty}} units', { qty: line.quantity }) : null,
                          line.unitCost != null
                            ? t('Unit cost {{cost}}', {
                                cost: formatCurrency(line.unitCost),
                              })
                            : null,
                        ].filter(Boolean);
                        return (
                          <div
                            key={`${label}-${index}`}
                            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-blue-100 bg-white px-4 py-3 text-left shadow-sm"
                          >
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{label}</p>
                              {secondary ? <p className="text-xs text-gray-600">{secondary}</p> : null}
                              {details.length ? (
                                <p className="mt-1 text-xs text-gray-500">{details.join(' • ')}</p>
                              ) : null}
                              {line.batchNumber || line.expiryDate ? (
                                <p className="mt-1 text-xs text-gray-500">
                                  {[
                                    line.batchNumber ? t('Batch {{batch}}', { batch: line.batchNumber }) : null,
                                    line.expiryDate ? t('Expiry {{date}}', { date: line.expiryDate }) : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => applyInvoiceLine(line)}
                              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                            >
                              {t('Use details')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : scanStatus === 'success' ? (
                    <p className="text-xs text-blue-900/80">
                      {t('No medication lines were detected. Add the formulary details manually.')}
                    </p>
                  ) : null}

                  {applyNotice ? (
                    <div className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs text-blue-900 shadow-sm">
                      {applyNotice}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="drug-name">
                    {t('Brand or trade name')}*
                  </label>
                  <input
                    id="drug-name"
                    type="text"
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={t('e.g., Lipitor')}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="drug-generic">
                    {t('Generic name')}
                  </label>
                  <input
                    id="drug-generic"
                    type="text"
                    value={form.genericName}
                    onChange={(event) => setForm((prev) => ({ ...prev, genericName: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={t('e.g., Atorvastatin')}
                  />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="drug-form">
                    {t('Form')}*
                  </label>
                  <input
                    id="drug-form"
                    type="text"
                    value={form.form}
                    onChange={(event) => setForm((prev) => ({ ...prev, form: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={t('e.g., Tablet')}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="drug-strength">
                    {t('Strength')}*
                  </label>
                  <input
                    id="drug-strength"
                    type="text"
                    value={form.strength}
                    onChange={(event) => setForm((prev) => ({ ...prev, strength: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={t('e.g., 20 mg')}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="drug-route">
                  {t('Default route of administration')}
                </label>
                <input
                  id="drug-route"
                  type="text"
                  value={form.routeDefault}
                  onChange={(event) => setForm((prev) => ({ ...prev, routeDefault: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder={t('e.g., Oral')}
                />
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  id="drug-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <label className="text-sm font-medium text-gray-900" htmlFor="drug-active">
                    {t('Active medication')}
                  </label>
                  <p className="text-xs text-gray-600">
                    {t('Inactive drugs remain in the formulary history but are hidden from new orders and inventory searches.')}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {saving ? t('Saving...') : t('Add medication')}
                </button>
                <button
                  type="button"
                  className="text-sm font-medium text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    setForm(() => ({ ...EMPTY_FORM }));
                    setFeedback(null);
                    setCreatedDrug(null);
                  }}
                >
                  {t('Clear form')}
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-blue-900">{t('Tips for complete drug entries')}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-blue-900/80">
                <li>{t('Use the strongest identifier your team recognizes as the brand name.')}</li>
                <li>{t('Include the generic to support clinical decision support and search.')}</li>
                <li>{t('If multiple strengths exist, create a separate entry for each presentation.')}</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">{t('Who can see this?')}</h3>
              <p className="mt-2 text-sm text-gray-600">
                {t(
                  'New medications become available immediately to pharmacists and clinicians when ordering or dispensing.',
                )}
              </p>
              <p className="mt-3 text-xs text-gray-500">
                {t('Only IT Admins and Inventory Managers can add or retire formulary items.')}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
