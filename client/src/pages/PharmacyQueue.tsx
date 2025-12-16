import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import {
  listPharmacyQueue,
  listMedicationOrders,
  updateMedicationOrder,
  deleteMedicationOrder,
  type PharmacyQueueItem,
  type PharmacyQueueStatus,
  type MedicationOrderSummary,
  type MedicationOrderStatus,
} from '../api/pharmacy';
import { useAuth } from '../context/AuthProvider';
import useAdminBasePath from '../hooks/useAdminBasePath';

const STATUS_OPTIONS: PharmacyQueueStatus[] = ['PENDING', 'PARTIAL', 'DISPENSED'];
const MEDICATION_ORDER_STATUS_OPTIONS: MedicationOrderStatus[] = [
  'PENDING',
  'APPROVED',
  'SHIPPING',
  'ON_THE_WAY',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

type MedicationOrderStatusFilter = 'ALL' | MedicationOrderStatus;

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function formatStatusLabel(status: MedicationOrderStatus) {
  return status.replace(/_/g, ' ');
}

export default function PharmacyQueue() {
  const { user } = useAuth();
  const adminBasePath = useAdminBasePath();
  const location = useLocation();
  const [status, setStatus] = useState<PharmacyQueueStatus>('PENDING');
  const [data, setData] = useState<PharmacyQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] =
    useState<MedicationOrderStatusFilter>('PENDING');
  const [orders, setOrders] = useState<MedicationOrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersSuccess, setOrdersSuccess] = useState<string | null>(null);
  const [statusEdits, setStatusEdits] = useState<Record<string, MedicationOrderStatus>>({});
  const [updatingOrders, setUpdatingOrders] = useState<Record<string, boolean>>({});
  const [deletingOrders, setDeletingOrders] = useState<Record<string, boolean>>({});
  const canDispense = user ? ['Pharmacist', 'PharmacyTech'].includes(user.role) : false;
  const canManageInventory = user ? ['InventoryManager', 'ITAdmin', 'Pharmacist'].includes(user.role) : false;
  const canDeleteOrders = user ? ['ITAdmin', 'AdminAssistant'].includes(user.role) : false;
  const loadQueueRef = useRef<() => Promise<void>>();

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Add a small delay to ensure any pending database transactions are committed
      await new Promise(resolve => setTimeout(resolve, 200));
      const queue = await listPharmacyQueue(status);
      setData(queue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load queue');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    loadQueueRef.current = loadQueue;
  }, [loadQueue]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Refresh data when navigating back to this page or when page becomes visible
  useEffect(() => {
    // Add a delay to ensure any pending database transactions are committed
    // Also refresh when query parameters change (e.g., refresh timestamp)
    const timeoutId = setTimeout(() => {
      if (loadQueueRef.current) {
        loadQueueRef.current();
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && loadQueueRef.current) {
        loadQueueRef.current();
      }
    };

    const handleFocus = () => {
      if (loadQueueRef.current) {
        loadQueueRef.current();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadOrders() {
      setOrdersLoading(true);
      setOrdersError(null);
      setOrdersSuccess(null);
      try {
        const fetched = await listMedicationOrders({
          status: orderStatusFilter === 'ALL' ? undefined : orderStatusFilter,
        });
        if (!cancelled) {
          setOrders(fetched);
          const next: Record<string, MedicationOrderStatus> = {};
          for (const order of fetched) {
            next[order.orderId] = order.status;
          }
          setStatusEdits(next);
        }
      } catch (err) {
        if (!cancelled) {
          setOrdersError(
            err instanceof Error ? err.message : 'Unable to load medication orders',
          );
        }
      } finally {
        if (!cancelled) {
          setOrdersLoading(false);
        }
      }
    }

    loadOrders();
    return () => {
      cancelled = true;
    };
  }, [orderStatusFilter]);

  const subtitle = useMemo(() => {
    if (loading) return 'Loading pharmacy worklist…';
    if (error) return error;
    if (!data.length) return 'No prescriptions waiting in this state.';
    return `${data.length} prescription${data.length === 1 ? '' : 's'} queued.`;
  }, [data.length, error, loading]);

  const ordersSubtitle = useMemo(() => {
    if (ordersLoading) return 'Loading medication delivery orders…';
    if (ordersError) return 'We were unable to load medication orders.';
    if (!orders.length) return 'No medication orders match this filter.';
    return `${orders.length} medication order${orders.length === 1 ? '' : 's'} in this view.`;
  }, [orders.length, ordersError, ordersLoading]);

  const isUpdating = useCallback(
    (orderId: string) => Boolean(updatingOrders[orderId]),
    [updatingOrders],
  );

  const handleSelectStatus = useCallback((orderId: string, value: MedicationOrderStatus) => {
    setStatusEdits((previous) => ({ ...previous, [orderId]: value }));
  }, []);

  const handleUpdateOrder = useCallback(
    async (orderId: string) => {
      const desiredStatus = statusEdits[orderId];
      const current = orders.find((order) => order.orderId === orderId);
      if (!desiredStatus || !current || desiredStatus === current.status) {
        return;
      }

      setUpdatingOrders((prev) => ({ ...prev, [orderId]: true }));
      setOrdersError(null);
      setOrdersSuccess(null);
      try {
        const updated = await updateMedicationOrder(orderId, { status: desiredStatus });
        setOrders((prev) => {
          if (orderStatusFilter !== 'ALL' && updated.status !== orderStatusFilter) {
            return prev.filter((order) => order.orderId !== orderId);
          }
          return prev.map((order) => (order.orderId === orderId ? updated : order));
        });
        setStatusEdits((prev) => {
          const next = { ...prev };
          if (orderStatusFilter !== 'ALL' && updated.status !== orderStatusFilter) {
            delete next[orderId];
          } else {
            next[orderId] = updated.status;
          }
          return next;
        });
        setOrdersSuccess('Medication order status updated.');
      } catch (err) {
        setOrdersError(
          err instanceof Error ? err.message : 'Unable to update medication order',
        );
      } finally {
        setUpdatingOrders((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }
    },
    [orderStatusFilter, orders, statusEdits],
  );

  const handleDeleteOrder = useCallback(
    async (orderId: string) => {
      if (!window.confirm('Are you sure you want to delete this medication order? This action cannot be undone.')) {
        return;
      }

      setDeletingOrders((prev) => ({ ...prev, [orderId]: true }));
      setOrdersError(null);
      setOrdersSuccess(null);
      try {
        await deleteMedicationOrder(orderId);
        setOrders((prev) => prev.filter((order) => order.orderId !== orderId));
        setStatusEdits((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
        setOrdersSuccess('Medication order deleted.');
      } catch (err) {
        setOrdersError(
          err instanceof Error ? err.message : 'Unable to delete medication order',
        );
      } finally {
        setDeletingOrders((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }
    },
    [],
  );

  return (
    <DashboardLayout title="Pharmacy" subtitle={subtitle} activeItem="pharmacy">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Dispensing Queue</h1>
            <p className="text-sm text-gray-600">Monitor incoming e-prescriptions and jump into dispensing.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canManageInventory ? (
              <Link
                to={`${adminBasePath}/pharmacy/inventory`}
                className="rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
              >
                Manage inventory
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => loadQueue()}
              disabled={loading}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh queue"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as PharmacyQueueStatus)}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
            Loading prescriptions…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
            Nothing in the queue for this status.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.map((item) => (
              <article
                key={item.prescriptionId}
                className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-blue-600">
                      Rx #{item.prescriptionId}
                    </div>
                    <h2 className="text-base font-semibold text-gray-900">{item.patient?.name ?? 'Patient'}</h2>
                    <p className="text-xs text-gray-500">Ordered by {item.doctor?.name ?? 'Doctor'}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                    {item.status}
                  </span>
                </div>

                <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-700">
                  {item.items.map((line) => (
                    <li key={line.itemId} className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{line.dose}</div>
                        <div className="text-xs text-gray-500">
                          {line.route} • {line.frequency} • {line.durationDays} days
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-gray-500">
                        Qty {line.quantityPrescribed}
                      </span>
                    </li>
                  ))}
                </ul>

                {canDispense ? (
                  <Link
                    to={`${adminBasePath}/pharmacy/dispense/${item.prescriptionId}`}
                    className="mt-4 inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    Start Dispense
                  </Link>
                ) : (
                  <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-400">
                    Dispensing restricted to pharmacy staff
                  </p>
                )}
              </article>
            ))}
          </div>
        )}

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Medication delivery orders</h2>
              <p className="text-sm text-gray-600">{ordersSubtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium text-gray-600" htmlFor="order-status-filter">
                Status
              </label>
              <select
                id="order-status-filter"
                value={orderStatusFilter}
                onChange={(event) =>
                  setOrderStatusFilter(event.target.value as MedicationOrderStatusFilter)
                }
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="ALL">All statuses</option>
                {MEDICATION_ORDER_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatStatusLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {ordersSuccess ? (
            <div className="border-b border-green-100 bg-green-50 px-6 py-3 text-sm text-green-800">
              {ordersSuccess}
            </div>
          ) : null}
          {ordersError ? (
            <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
              {ordersError}
            </div>
          ) : null}

          {ordersLoading ? (
            <div className="px-6 py-6 text-sm text-gray-600">Loading medication orders…</div>
          ) : orders.length === 0 ? (
            <div className="px-6 py-6 text-sm text-gray-600">
              No medication orders to show for this filter.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {orders.map((order) => {
                const selectedStatus = statusEdits[order.orderId] ?? order.status;
                const hasChanges = selectedStatus !== order.status;
                const busy = isUpdating(order.orderId);
                const deleting = deletingOrders[order.orderId] ?? false;
                return (
                  <li key={order.orderId} className="px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                          Order #{order.orderId}
                        </div>
                        <h3 className="mt-1 text-base font-semibold text-gray-900">
                          {order.patient?.name ?? 'Patient order'}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {order.drugName
                            ? `${order.drugName}${order.dosage ? ` • ${order.dosage}` : ''}`
                            : 'Custom request'}
                        </p>
                        {order.instructions ? (
                          <p className="mt-1 text-xs text-gray-500">{order.instructions}</p>
                        ) : null}
                        {order.notes ? (
                          <p className="mt-2 rounded bg-blue-50 px-3 py-2 text-xs text-blue-700">
                            {order.notes}
                          </p>
                        ) : null}
                        {order.prescription?.doctor?.name ? (
                          <p className="mt-2 text-xs text-gray-500">
                            Ordered by {order.prescription.doctor.name}
                          </p>
                        ) : null}
                        {order.patient?.contact ? (
                          <p className="mt-1 text-xs text-gray-500">
                            Contact: {order.patient.contact}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-600">
                          {formatStatusLabel(order.status)}
                        </span>
                        <div className="mt-2 text-xs text-gray-500">
                          Requested {formatDateTime(order.createdAt)}
                        </div>
                        <div className="text-xs text-gray-400">
                          Updated {formatDateTime(order.updatedAt)}
                        </div>
                        {order.updatedBy?.email ? (
                          <div className="mt-1 text-xs text-gray-400">
                            Last touch: {order.updatedBy.email}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <select
                        value={selectedStatus}
                        onChange={(event) =>
                          handleSelectStatus(order.orderId, event.target.value as MedicationOrderStatus)
                        }
                        className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        disabled={busy || deleting}
                      >
                        {MEDICATION_ORDER_STATUS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {formatStatusLabel(option)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition ${
                          busy || deleting
                            ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                            : hasChanges
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                        onClick={() => handleUpdateOrder(order.orderId)}
                        disabled={busy || deleting || !hasChanges}
                      >
                        {busy ? 'Updating…' : hasChanges ? 'Update status' : 'Up to date'}
                      </button>
                      {hasChanges ? (
                        <span className="text-xs font-medium uppercase tracking-wide text-amber-500">
                          Pending save
                        </span>
                      ) : null}
                      {canDeleteOrders ? (
                        <button
                          type="button"
                          className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-white transition ${
                            deleting
                              ? 'cursor-not-allowed bg-gray-400'
                              : 'bg-red-600 hover:bg-red-700'
                          }`}
                          onClick={() => handleDeleteOrder(order.orderId)}
                          disabled={busy || deleting}
                        >
                          {deleting ? 'Deleting…' : 'Delete'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
