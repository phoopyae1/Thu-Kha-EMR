import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import {
  AdjustStockItemPayload,
  InventoryDrug,
  ReceiveStockItemPayload,
  StockItem,
  InvoiceScanResult,
  InvoiceScanLineItem,
  adjustStockLevels,
  listStockItems,
  receiveStockItems,
  searchInventoryDrugs,
  scanInvoiceForInventory,
} from '../api/client';
import useAdminBasePath from '../hooks/useAdminBasePath';

interface ReceiveFormState {
  batchNo: string;
  expiryDate: string;
  location: string;
  qtyOnHand: string;
  unitCost: string;
}

const EMPTY_RECEIVE_FORM: ReceiveFormState = {
  batchNo: '',
  expiryDate: '',
  location: '',
  qtyOnHand: '',
  unitCost: '',
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '—';
  }
}

export default function PharmacyInventory() {
  const adminBasePath = useAdminBasePath();
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<InventoryDrug[]>([]);
  const [selectedDrug, setSelectedDrug] = useState<InventoryDrug | null>(null);
  const [receiveForm, setReceiveForm] = useState<ReceiveFormState>(EMPTY_RECEIVE_FORM);
  const [receiveStatus, setReceiveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [invoiceResult, setInvoiceResult] = useState<InvoiceScanResult | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustStatus, setAdjustStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!searchTerm.trim()) {
      setSuggestions([]);
      return () => {
        cancelled = true;
      };
    }

    const timeout = window.setTimeout(async () => {
      try {
        const results = await searchInventoryDrugs(searchTerm, 10, { includeAll: true });
        if (!cancelled) {
          setSuggestions(results);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (!selectedDrug) {
      setStockItems([]);
      setAdjustments({});
      return;
    }

    let cancelled = false;
    const drugId = selectedDrug.drugId;
    async function loadStock() {
      setStockLoading(true);
      setStockError(null);
      try {
        const data = await listStockItems(drugId);
        if (!cancelled) {
          setStockItems(data);
          const initial: Record<string, string> = {};
          data.forEach((item) => {
            initial[item.stockItemId] = String(item.qtyOnHand);
          });
          setAdjustments(initial);
        }
      } catch (error) {
        if (!cancelled) {
          setStockError(error instanceof Error ? error.message : 'Unable to load stock');
        }
      } finally {
        if (!cancelled) {
          setStockLoading(false);
        }
      }
    }

    loadStock();
    return () => {
      cancelled = true;
    };
  }, [selectedDrug]);

  const totalOnHand = useMemo(() => stockItems.reduce((sum, item) => sum + item.qtyOnHand, 0), [stockItems]);

  async function handleReceive(event: FormEvent) {
    event.preventDefault();
    if (!selectedDrug) {
      setReceiveError('Select a medication before recording stock.');
      setReceiveStatus('error');
      return;
    }

    const drugId = selectedDrug.drugId;
    const qty = Number.parseInt(receiveForm.qtyOnHand, 10);
    if (Number.isNaN(qty) || qty < 0) {
      setReceiveError('Quantity on hand must be zero or greater.');
      setReceiveStatus('error');
      return;
    }

    const payload: ReceiveStockItemPayload = {
      drugId,
      location: receiveForm.location.trim(),
      qtyOnHand: qty,
    };

    if (!payload.location) {
      setReceiveError('Location is required.');
      setReceiveStatus('error');
      return;
    }

    if (receiveForm.batchNo.trim()) {
      payload.batchNo = receiveForm.batchNo.trim();
    }
    if (receiveForm.expiryDate) {
      const expiry = new Date(`${receiveForm.expiryDate}T00:00:00Z`);
      if (!Number.isNaN(expiry.getTime())) {
        payload.expiryDate = expiry.toISOString();
      }
    }
    if (receiveForm.unitCost) {
      const cost = Number.parseFloat(receiveForm.unitCost);
      if (!Number.isNaN(cost) && cost >= 0) {
        payload.unitCost = cost;
      }
    }

    setReceiveStatus('saving');
    setReceiveError(null);

    try {
      await receiveStockItems([payload]);
      setReceiveStatus('success');
      setReceiveForm(EMPTY_RECEIVE_FORM);
      setScanNotice('Select another line item or upload a new invoice to continue.');
      // refresh stock list
      const data = await listStockItems(drugId);
      setStockItems(data);
      const initial: Record<string, string> = {};
      data.forEach((item) => {
        initial[item.stockItemId] = String(item.qtyOnHand);
      });
      setAdjustments(initial);
    } catch (error) {
      setReceiveStatus('error');
      setReceiveError(error instanceof Error ? error.message : 'Unable to record stock');
    }
  }

  async function handleAdjust(event: FormEvent) {
    event.preventDefault();
    if (!selectedDrug) {
      setAdjustError('Select a medication to adjust inventory.');
      setAdjustStatus('error');
      return;
    }

    const drugId = selectedDrug.drugId;
    const changes: AdjustStockItemPayload[] = [];
    stockItems.forEach((item) => {
      const value = adjustments[item.stockItemId];
      if (value === undefined) return;
      const qty = Number.parseInt(value, 10);
      if (Number.isNaN(qty) || qty < 0) {
        return;
      }
      if (qty !== item.qtyOnHand) {
        const change: AdjustStockItemPayload = {
          stockItemId: item.stockItemId,
          qtyOnHand: qty,
        };
        if (adjustReason.trim()) {
          change.reason = adjustReason.trim();
        }
        changes.push(change);
      }
    });

    if (!changes.length) {
      setAdjustError('No adjustments detected. Update a quantity before submitting.');
      setAdjustStatus('error');
      return;
    }

    setAdjustStatus('saving');
    setAdjustError(null);

    try {
      await adjustStockLevels(changes);
      setAdjustStatus('success');
      setAdjustReason('');
      const data = await listStockItems(drugId);
      setStockItems(data);
      const initial: Record<string, string> = {};
      data.forEach((item) => {
        initial[item.stockItemId] = String(item.qtyOnHand);
      });
      setAdjustments(initial);
    } catch (error) {
      setAdjustStatus('error');
      setAdjustError(error instanceof Error ? error.message : 'Unable to adjust stock');
    }
  }

  async function handleInvoiceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanStatus('scanning');
    setScanError(null);
    setScanNotice(null);
    try {
      const result = await scanInvoiceForInventory(file);
      setInvoiceResult(result);
      setScanStatus('success');
      if (result.metadata?.destination) {
        setReceiveForm((prev) => ({
          ...prev,
          location: prev.location || result.metadata?.destination || '',
        }));
      }
      if (result.lineItems.length) {
        setScanNotice('Select an invoice line to apply its details to the stock form.');
      } else {
        setScanNotice('No medication lines were detected. Enter the stock details manually.');
      }
    } catch (error) {
      setInvoiceResult(null);
      setScanStatus('error');
      setScanError(error instanceof Error ? error.message : 'Unable to scan the invoice. Try again.');
    } finally {
      event.target.value = '';
    }
  }

  function applyInvoiceLine(line: InvoiceScanLineItem) {
    let appliedForm: ReceiveFormState | null = null;
    setReceiveForm((prev) => {
      const updated: ReceiveFormState = {
        ...prev,
        qtyOnHand: line.quantity != null ? String(line.quantity) : prev.qtyOnHand,
        unitCost: line.unitCost != null ? String(line.unitCost) : prev.unitCost,
        batchNo: line.batchNumber ?? prev.batchNo,
        expiryDate: line.expiryDate ?? prev.expiryDate,
        location: line.suggestedLocation ?? prev.location,
      };
      appliedForm = updated;
      return updated;
    });

    if (!selectedDrug) {
      const searchCandidate = [line.brandName, line.genericName].filter(Boolean).join(' ');
      if (searchCandidate) {
        setSearchTerm(searchCandidate);
      }
    }

    const resolved = appliedForm ?? receiveForm;
    const missing: string[] = [];
    if (!selectedDrug) {
      missing.push('select a medication');
    }
    if (!resolved.qtyOnHand.trim()) {
      missing.push('quantity');
    }
    if (!resolved.location.trim()) {
      missing.push('location');
    }

    setScanNotice(
      missing.length
        ? `Complete the following before recording stock: ${missing.join(', ')}.`
        : 'Verify the prefilled details and record the stock.',
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

  function selectDrug(drug: InventoryDrug) {
    setSelectedDrug(drug);
    setSearchTerm(`${drug.name} ${drug.strength}`.trim());
    setSuggestions([]);
  }

  function resetSelection() {
    setSelectedDrug(null);
    setSearchTerm('');
    setSuggestions([]);
    setStockItems([]);
    setAdjustments({});
  }

  const subtitle = selectedDrug
    ? `Managing inventory for ${selectedDrug.name} ${selectedDrug.strength}`
    : 'Search for a medication to manage inventory levels.';

  return (
    <DashboardLayout title="Pharmacy Inventory" subtitle={subtitle} activeItem="pharmacy">
      <div className="space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Inventory Workspace</h1>
              <p className="text-sm text-gray-600">
                Search for a drug to receive new stock or adjust current quantities.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`${adminBasePath}/pharmacy/drugs/new`}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Add new medication
              </Link>
              {selectedDrug ? (
                <button
                  type="button"
                  onClick={resetSelection}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  Clear selection
                </button>
              ) : null}
            </div>
          </header>

          <div className="relative mt-6 max-w-xl">
            <label className="text-sm font-medium text-gray-700" htmlFor="inventory-search">
              Find a medication
            </label>
            <input
              id="inventory-search"
              type="search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSelectedDrug(null);
              }}
              placeholder="Start typing a medication name or strength"
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
                {suggestions.map((item) => (
                  <li key={item.drugId}>
                    <button
                      type="button"
                      onClick={() => selectDrug(item)}
                      className="flex w-full flex-col items-start gap-1 px-4 py-2 text-left hover:bg-blue-50"
                    >
                      <span className="text-sm font-medium text-gray-900">{item.name}</span>
                      <span className="text-xs text-gray-500">
                        {item.strength} • {item.form}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {selectedDrug ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Receive Stock</h2>
              <p className="mt-1 text-sm text-gray-600">
                Capture new inventory lots as they arrive in the pharmacy.
              </p>

              <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-blue-900">Scan invoice for stock</h3>
                    <p className="mt-1 text-xs text-blue-900/80">
                      Upload an invoice to prefill quantities, batch numbers, and pricing automatically.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-blue-500 bg-white px-4 py-2 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="sr-only"
                      onChange={handleInvoiceUpload}
                    />
                    {scanStatus === 'scanning' ? 'Scanning…' : 'Upload invoice'}
                  </label>
                </div>

                {scanStatus === 'scanning' ? (
                  <p className="mt-3 text-xs font-medium text-blue-900">Scanning invoice with AI…</p>
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
                          {invoiceMetadata.vendor ? <span className="font-semibold">{invoiceMetadata.vendor}</span> : null}
                          {invoiceMetadata.invoiceNumber ? (
                            <span className="text-blue-900/70">Invoice #{invoiceMetadata.invoiceNumber}</span>
                          ) : null}
                          {invoiceMetadata.invoiceDate ? (
                            <span className="text-blue-900/70">Dated {invoiceMetadata.invoiceDate}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {scanWarnings.length ? (
                      <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 shadow-sm">
                        <p className="font-semibold">Review required</p>
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
                          const label = line.brandName || line.genericName || `Line ${index + 1}`;
                          const secondary = [line.strength, line.form].filter(Boolean).join(' • ');
                          const details = [
                            line.packageDescription,
                            line.quantity != null ? `${line.quantity} units` : null,
                            line.unitCost != null
                              ? `Unit cost ${formatCurrency(line.unitCost)}`
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
                                {details.length ? <p className="mt-1 text-xs text-gray-500">{details.join(' • ')}</p> : null}
                                {line.batchNumber || line.expiryDate ? (
                                  <p className="mt-1 text-xs text-gray-500">
                                    {[
                                      line.batchNumber ? `Batch ${line.batchNumber}` : null,
                                      line.expiryDate ? `Expiry ${line.expiryDate}` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' • ')}
                                  </p>
                                ) : null}
                                {line.suggestedLocation ? (
                                  <p className="mt-1 text-xs text-gray-500">Suggested location: {line.suggestedLocation}</p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => applyInvoiceLine(line)}
                                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                              >
                                Use details
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : scanStatus === 'success' ? (
                      <p className="text-xs text-blue-900/80">
                        No medication lines were detected. Enter the stock details manually.
                      </p>
                    ) : null}

                    {scanNotice ? (
                      <div className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs text-blue-900 shadow-sm">
                        {scanNotice}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <form className="mt-4 space-y-4" onSubmit={handleReceive}>
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="receive-location">
                    Storage location
                  </label>
                  <input
                    id="receive-location"
                    type="text"
                    value={receiveForm.location}
                    onChange={(event) => setReceiveForm((prev) => ({ ...prev, location: event.target.value }))}
                    placeholder="e.g., Main Pharmacy - Shelf A"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="receive-qty">
                      Quantity on hand
                    </label>
                    <input
                      id="receive-qty"
                      type="number"
                      min={0}
                      value={receiveForm.qtyOnHand}
                      onChange={(event) => setReceiveForm((prev) => ({ ...prev, qtyOnHand: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="receive-batch">
                      Batch number
                    </label>
                    <input
                      id="receive-batch"
                      type="text"
                      value={receiveForm.batchNo}
                      onChange={(event) => setReceiveForm((prev) => ({ ...prev, batchNo: event.target.value }))}
                      placeholder="Optional"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="receive-expiry">
                      Expiry date
                    </label>
                    <input
                      id="receive-expiry"
                      type="date"
                      value={receiveForm.expiryDate}
                      onChange={(event) => setReceiveForm((prev) => ({ ...prev, expiryDate: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="receive-cost">
                      Unit cost
                    </label>
                    <input
                      id="receive-cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={receiveForm.unitCost}
                      onChange={(event) => setReceiveForm((prev) => ({ ...prev, unitCost: event.target.value }))}
                      placeholder="Optional"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                {receiveStatus === 'success' ? (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                    Stock recorded successfully.
                  </div>
                ) : null}
                {receiveStatus === 'error' && receiveError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{receiveError}</div>
                ) : null}

                <button
                  type="submit"
                  className="w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  disabled={receiveStatus === 'saving'}
                >
                  {receiveStatus === 'saving' ? 'Saving…' : 'Record stock'}
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Adjust Inventory</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Update quantities for existing batches after cycle counts or corrections.
                  </p>
                </div>
                <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                  Total on hand: {totalOnHand}
                </div>
              </div>

              {stockLoading ? (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  Loading stock details…
                </div>
              ) : stockError ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{stockError}</div>
              ) : stockItems.length === 0 ? (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  No stock entries found for this medication yet.
                </div>
              ) : (
                <form className="mt-4 space-y-4" onSubmit={handleAdjust}>
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Location</th>
                          <th className="px-4 py-3">Batch</th>
                          <th className="px-4 py-3">Expiry</th>
                          <th className="px-4 py-3">Current qty</th>
                          <th className="px-4 py-3">New qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {stockItems.map((item) => (
                          <tr key={item.stockItemId}>
                            <td className="px-4 py-3 font-medium text-gray-900">{item.location}</td>
                            <td className="px-4 py-3 text-gray-600">{item.batchNo || '—'}</td>
                            <td className="px-4 py-3 text-gray-600">{formatDate(item.expiryDate)}</td>
                            <td className="px-4 py-3 text-gray-600">{item.qtyOnHand}</td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min={0}
                                value={adjustments[item.stockItemId] ?? ''}
                                onChange={(event) =>
                                  setAdjustments((prev) => ({
                                    ...prev,
                                    [item.stockItemId]: event.target.value,
                                  }))
                                }
                                className="w-28 rounded-lg border border-gray-200 px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="adjust-reason">
                      Adjustment reason (optional)
                    </label>
                    <textarea
                      id="adjust-reason"
                      value={adjustReason}
                      onChange={(event) => setAdjustReason(event.target.value)}
                      rows={3}
                      placeholder="Document why this change is being made"
                      className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>

                  {adjustStatus === 'success' ? (
                    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                      Inventory updated.
                    </div>
                  ) : null}
                  {adjustStatus === 'error' && adjustError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{adjustError}</div>
                  ) : null}

                  <button
                    type="submit"
                    className="w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    disabled={adjustStatus === 'saving'}
                  >
                    {adjustStatus === 'saving' ? 'Updating…' : 'Apply adjustments'}
                  </button>
                </form>
              )}
            </section>
          </div>
        ) : (
          <section className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-10 text-center text-sm text-blue-700">
            Select a medication to begin managing inventory.
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
