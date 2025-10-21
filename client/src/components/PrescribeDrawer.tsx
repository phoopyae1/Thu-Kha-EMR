import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from '../api/http';
import { InventoryDrug, Medication, searchInventoryDrugs } from '../api/client';

interface PrescribeDrawerProps {
  visitId: string;
  patientId: string;
  doctorOrders: Medication[];
}

interface DraftItem {
  orderName: string | null;
  orderDetails: string | null;
  drugId: string | null;
  selectedLabel: string;
  selectedOnHand: number | null;
  searchTerm: string;
  dose: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantityPrescribed: number;
}

const DEFAULT_ROUTE = 'PO';
const DEFAULT_FREQUENCY = 'TID';
const DEFAULT_DURATION = 5;
const DEFAULT_QUANTITY = 10;
const SUGGESTION_MIN_CHARS = 2;

function createDraftItem(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    orderName: null,
    orderDetails: null,
    drugId: null,
    selectedLabel: '',
    selectedOnHand: null,
    searchTerm: '',
    dose: '',
    route: DEFAULT_ROUTE,
    frequency: DEFAULT_FREQUENCY,
    durationDays: DEFAULT_DURATION,
    quantityPrescribed: DEFAULT_QUANTITY,
    ...overrides,
  };
}

function createDraftItemFromOrder(order: Medication): DraftItem {
  return createDraftItem({
    orderName: order.drugName,
    orderDetails: order.instructions ?? order.dosage ?? null,
    dose: order.dosage ?? order.drugName,
    searchTerm: order.drugName,
  });
}

function formatInventoryLabel(drug: InventoryDrug) {
  const primary = [drug.name, drug.strength].filter(Boolean).join(' ');
  const details = [drug.form, drug.genericName].filter(Boolean).join(' • ');
  return details ? `${primary} • ${details}` : primary;
}

export default function PrescribeDrawer({ visitId, patientId, doctorOrders }: PrescribeDrawerProps) {
  const [items, setItems] = useState<DraftItem[]>([createDraftItem()]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<number, InventoryDrug[]>>({});
  const fetchRefs = useRef<Record<number, number>>({});

  useEffect(() => {
    if (initialized) return;
    if (doctorOrders.length) {
      setItems(doctorOrders.map((order) => createDraftItemFromOrder(order)));
    } else {
      setItems([createDraftItem()]);
    }
    setInitialized(true);
  }, [doctorOrders, initialized]);

  function updateItem(index: number, changes: Partial<DraftItem>) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  }

  function addItem() {
    setItems((current) => [...current, createDraftItem()]);
  }

  function removeItem(index: number) {
    setItems((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
    setSuggestions({});
    fetchRefs.current = {};
  }

  async function loadSuggestions(index: number, term: string) {
    const trimmed = term.trim();
    if (trimmed.length < SUGGESTION_MIN_CHARS) {
      setSuggestions((current) => ({ ...current, [index]: [] }));
      return;
    }
    const requestId = (fetchRefs.current[index] ?? 0) + 1;
    fetchRefs.current[index] = requestId;
    try {
      const results = await searchInventoryDrugs(trimmed);
      if (fetchRefs.current[index] === requestId) {
        setSuggestions((current) => ({ ...current, [index]: results }));
      }
    } catch {
      if (fetchRefs.current[index] === requestId) {
        setSuggestions((current) => ({ ...current, [index]: [] }));
      }
    }
  }

  function handleSearchChange(index: number, value: string) {
    updateItem(index, { searchTerm: value, drugId: null, selectedLabel: '', selectedOnHand: null });
    void loadSuggestions(index, value);
  }

  function selectSuggestion(index: number, suggestion: InventoryDrug) {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        const label = formatInventoryLabel(suggestion);
        const updatedRoute =
          suggestion.routeDefault && (!item.route || item.route === DEFAULT_ROUTE)
            ? suggestion.routeDefault
            : item.route || DEFAULT_ROUTE;
        return {
          ...item,
          drugId: suggestion.drugId,
          selectedLabel: label,
          selectedOnHand: suggestion.qtyOnHand,
          route: updatedRoute,
          searchTerm: suggestion.name,
        };
      }),
    );
    setSuggestions((current) => ({ ...current, [index]: [] }));
  }

  async function handleSave() {
    if (items.some((item) => !item.drugId)) {
      window.alert('Please match every line to an in-stock medicine or remove unused lines.');
      return;
    }

    if (items.some((item) => !item.dose || !item.route || !item.frequency)) {
      window.alert('Please complete dose, route, and frequency details for each line.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetchJSON(`/visits/${visitId}/prescriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          notes,
          items: items.map((item) => ({
            drugId: item.drugId!,
            dose: item.dose,
            route: item.route,
            frequency: item.frequency,
            durationDays: Number(item.durationDays) || 1,
            quantityPrescribed: Number(item.quantityPrescribed) || 1,
          })),
        }),
      });
      const allergyHits = (response as { allergyHits?: string[] }).allergyHits ?? [];
      if (allergyHits.length) {
        window.alert(`Allergy warning: ${allergyHits.join(', ')}`);
      } else {
        window.alert('Prescription queued for pharmacy disbursement.');
      }
      setNotes('');
      setInitialized(false);
      setSuggestions({});
      fetchRefs.current = {};
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Unable to save prescription');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Prescribe (MVP)</h2>
          <p className="text-xs text-gray-500">
            Match the physician&rsquo;s prescriptions with in-stock medicines to queue medication orders for hospital or client delivery.
          </p>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center justify-center rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
        >
          + Add custom line
        </button>
      </div>
      {doctorOrders.length === 0 && (
        <p className="mt-3 text-xs text-gray-500">
          No physician prescriptions were recorded for this visit. Add custom lines below to queue a prescription order.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {items.map((item, index) => {
          const matches = suggestions[index] ?? [];
          const showEmptyState =
            item.searchTerm.trim().length >= SUGGESTION_MIN_CHARS && matches.length === 0 && !item.drugId;
          return (
            <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line #{index + 1}</span>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              {item.orderName && (
                <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">Physician Order</div>
                  <div className="mt-1 text-sm font-semibold text-blue-800">{item.orderName}</div>
                  {item.orderDetails && (
                    <div className="mt-1 text-xs text-blue-700">{item.orderDetails}</div>
                  )}
                </div>
              )}
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-medium text-gray-600">
                  <span className="mb-1 block">Search in-stock medicine</span>
                  <input
                    value={item.searchTerm}
                    onChange={(event) => handleSearchChange(index, event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Type at least two characters"
                  />
                </label>
                {matches.length > 0 && (
                  <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm text-gray-700 shadow">
                    {matches.map((suggestion) => (
                      <li key={suggestion.drugId}>
                        <button
                          type="button"
                          onClick={() => selectSuggestion(index, suggestion)}
                          className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-gray-100"
                        >
                          <span className="font-medium text-gray-900">{formatInventoryLabel(suggestion)}</span>
                          <span className="text-xs text-gray-500">Qty on hand: {suggestion.qtyOnHand}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {showEmptyState && (
                  <p className="text-xs text-red-600">No in-stock medicines match that search. Try a different term.</p>
                )}
                {item.selectedLabel ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
                    <div className="font-semibold text-green-800">Selected inventory</div>
                    <div className="mt-1 text-sm text-green-900">{item.selectedLabel}</div>
                    {item.selectedOnHand !== null && (
                      <div className="mt-1 text-[11px]">Qty on hand: {item.selectedOnHand}</div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No inventory item selected yet.</p>
                )}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-gray-600">
                  <span>Dose</span>
                  <input
                    value={item.dose}
                    onChange={(event) => updateItem(index, { dose: event.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="500 mg"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-gray-600">
                  <span>Route</span>
                  <input
                    value={item.route}
                    onChange={(event) => updateItem(index, { route: event.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="PO"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-gray-600">
                  <span>Frequency</span>
                  <input
                    value={item.frequency}
                    onChange={(event) => updateItem(index, { frequency: event.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="TID"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-gray-600">
                  <span>Duration (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={item.durationDays}
                    onChange={(event) => updateItem(index, { durationDays: Number(event.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-gray-600">
                  <span>Quantity</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={item.quantityPrescribed}
                    onChange={(event) => updateItem(index, { quantityPrescribed: Number(event.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <label className="mt-4 block text-xs font-medium text-gray-600">
        <span className="mb-1 block">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Provide any counselling notes for the patient"
        />
      </label>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-4 inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        {saving ? 'Saving…' : 'Queue for Dispensing'}
      </button>
    </aside>
  );
}
