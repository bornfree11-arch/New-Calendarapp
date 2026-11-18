import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getAllAppointments,
  updateAppointmentStatus,
  formatSupabaseError,
  normalizeAppointmentStatus,
  formatAppointmentStatusLabel,
} from '@/lib/store';
import { useAuth } from '@/context/AuthContext';
import { Appointment, AppointmentStatus, Company, Profile } from '@/types';
import { formatDateMMDDYYYY, formatTime12, isEmbedded } from '@/lib/dateUtils';
import {
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  CalendarClock,
  Plus,
  Building2,
  Phone,
  Mail,
  Clock,
  Calendar,
  AlertCircle,
  X,
  History,
} from 'lucide-react';

interface AllAppointmentsViewProps {
  profiles: Profile[];
  companies: Company[];
  dataVersion: number;
  onOpenAppointment: (appointment: Appointment) => void;
  onNewAppointment: () => void;
  onStatusUpdated: () => void;
}

type StatusFilter = 'all' | 'scheduled' | 'completed' | 'cancelled' | 'rescheduled' | 'past';

interface ToastState {
  type: 'success' | 'error';
  message: string;
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  'no-show': 'bg-amber-50 text-amber-700 border-amber-200',
  rescheduled: 'bg-purple-50 text-purple-700 border-purple-200',
};

function getAppointmentDateTimeMs(appt: Appointment): number {
  const dateStr = (appt.appointment_date || '').trim();
  const timeStr = (appt.start_time || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    let hh = 0;
    let mm = 0;
    let ss = 0;
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (timeMatch) {
      hh = Number(timeMatch[1]);
      mm = Number(timeMatch[2]);
      ss = Number(timeMatch[3] || 0);
    }
    return new Date(y, m - 1, d, hh, mm, ss, 0).getTime();
  }
  const parsed = Date.parse(timeStr || dateStr);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isPastAppointment(appt: Appointment, nowMs: number): boolean {
  const ts = getAppointmentDateTimeMs(appt);
  return ts > 0 && ts < nowMs;
}

function matchesStatusFilter(appt: Appointment, filter: StatusFilter, nowMs: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'past') return isPastAppointment(appt, nowMs);
  return normalizeAppointmentStatus(appt.status) === filter;
}

export function AllAppointmentsView({
  profiles,
  companies,
  dataVersion,
  onOpenAppointment,
  onNewAppointment,
  onStatusUpdated,
}: AllAppointmentsViewProps) {
  const { profile: currentUser } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const embedded = isEmbedded();

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => setToast(null),
      toast.type === 'error' ? 8000 : 3500,
    );
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAllAppointments();
      setAppointments(data);
      setNowMs(Date.now());
    } catch (err) {
      setError(formatSupabaseError(err, 'Failed to load appointments.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll, dataVersion]);

  async function handleQuickStatus(
    e: React.MouseEvent,
    appt: Appointment,
    newStatus: AppointmentStatus,
  ) {
    e.stopPropagation();
    if (normalizeAppointmentStatus(appt.status) === normalizeAppointmentStatus(newStatus) || updatingId) {
      return;
    }
    setUpdatingId(appt.id);
    setError('');
    try {
      const updated = await updateAppointmentStatus(appt.id, newStatus, currentUser?.id || null);
      setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setToast({
        type: 'success',
        message: `${appt.client_name} marked as ${formatAppointmentStatusLabel(updated.status)}.`,
      });
      onStatusUpdated();
    } catch (err) {
      const msg = formatSupabaseError(err, 'Failed to update appointment status.');
      setError(msg);
      setToast({
        type: 'error',
        message: msg,
      });
    } finally {
      setUpdatingId(null);
    }
  }

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return appointments;
    const digits = q.replace(/\D/g, '');
    return appointments.filter((appt) => {
      const compName = (
        (appt.company_id && companyMap.get(appt.company_id)?.name) ||
        appt.company_snapshot?.name ||
        ''
      ).toLowerCase();
      const coworkerName = (profileMap.get(appt.assigned_to)?.full_name || '').toLowerCase();
      const phoneDigits = (appt.client_phone || '').replace(/\D/g, '');
      return (
        (appt.client_name || '').toLowerCase().includes(q) ||
        (appt.client_email || '').toLowerCase().includes(q) ||
        (appt.client_phone || '').toLowerCase().includes(q) ||
        (digits.length >= 2 && phoneDigits.includes(digits)) ||
        compName.includes(q) ||
        coworkerName.includes(q) ||
        (appt.appointment_type || '').toLowerCase().includes(q)
      );
    });
  }, [appointments, searchQuery, companyMap, profileMap]);

  const counts = useMemo(() => {
    return {
      all: searchFiltered.length,
      scheduled: searchFiltered.filter((a) => matchesStatusFilter(a, 'scheduled', nowMs)).length,
      completed: searchFiltered.filter((a) => matchesStatusFilter(a, 'completed', nowMs)).length,
      cancelled: searchFiltered.filter((a) => matchesStatusFilter(a, 'cancelled', nowMs)).length,
      rescheduled: searchFiltered.filter((a) => matchesStatusFilter(a, 'rescheduled', nowMs)).length,
      past: searchFiltered.filter((a) => matchesStatusFilter(a, 'past', nowMs)).length,
    };
  }, [searchFiltered, nowMs]);

    const visibleAppointments = useMemo(() => {
    const filtered = searchFiltered.filter((a) => matchesStatusFilter(a, statusFilter, nowMs));
    return [...filtered].sort((a, b) =>
      statusFilter === 'past'
        ? getAppointmentDateTimeMs(b) - getAppointmentDateTimeMs(a)
        : getAppointmentDateTimeMs(a) - getAppointmentDateTimeMs(b)
    );
  }, [searchFiltered, statusFilter, nowMs]);


  return (
    <div className="min-h-screen bg-slate-50">
      {toast && (
        <div
          role="alert"
          className={`fixed bottom-5 right-5 z-50 max-w-md w-[calc(100vw-2.5rem)] sm:w-auto rounded-xl shadow-lg border px-4 py-3 flex items-start gap-3 transition-all ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          )}
          <div className="text-xs sm:text-sm font-medium flex-1 break-words">{toast.message}</div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-0.5 rounded hover:bg-black/5 transition shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className={`max-w-[1400px] mx-auto ${embedded ? 'px-2 lg:px-3 py-3' : 'px-4 lg:px-6 py-5'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">All Appointments</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Search by customer or company, filter by status or past appointments, or update statuses directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onNewAppointment}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Appointment
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, phone, email, company, or coworker..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: 'all', label: 'All', count: counts.all },
                { key: 'scheduled', label: 'Pending / Scheduled', count: counts.scheduled },
                { key: 'completed', label: 'Completed', count: counts.completed },
                { key: 'cancelled', label: 'Cancelled', count: counts.cancelled },
                { key: 'rescheduled', label: 'Rescheduled', count: counts.rescheduled },
                { key: 'past', label: 'Past Appointments', count: counts.past },
              ] as const
            ).map((pill) => (
              <button
                key={pill.key}
                type="button"
                onClick={() => {
                  setNowMs(Date.now());
                  setStatusFilter(pill.key);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border flex items-center gap-1.5 ${
                  statusFilter === pill.key
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {pill.key === 'past' && <History className="w-3.5 h-3.5" />}
                <span>{pill.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[11px] font-semibold ${
                    statusFilter === pill.key
                      ? 'bg-teal-700 text-white'
                      : 'bg-white text-slate-500 border border-slate-200'
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="text-red-500 hover:text-red-700 p-0.5 rounded"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-slate-400 flex items-center justify-center gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading appointments...
            </div>
          ) : visibleAppointments.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              {searchQuery || statusFilter !== 'all'
                ? 'No appointments match your current filters.'
                : 'No appointments recorded yet.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleAppointments.map((appt) => {
                const prof = profileMap.get(appt.assigned_to);
                const compName =
                  (appt.company_id && companyMap.get(appt.company_id)?.name) ||
                  appt.company_snapshot?.name ||
                  'No company';
                const normStatus = normalizeAppointmentStatus(appt.status);
                const statusBadge =
                  STATUS_BADGE[normStatus] || 'bg-slate-100 text-slate-700 border-slate-200';
                const statusLabel = formatAppointmentStatusLabel(appt.status);
                const isUpdating = updatingId === appt.id;
                const isCompleted = normStatus === 'completed';
                const isCancelled = normStatus === 'cancelled';
                const isRescheduled = normStatus === 'rescheduled';

                return (
                  <div
                    key={appt.id}
                    onClick={() => onOpenAppointment(appt)}
                    className="px-4 py-3.5 hover:bg-slate-50/80 transition cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                        style={{ backgroundColor: prof?.calendar_color || '#6B7B8D' }}
                        title={prof?.full_name || 'Unassigned'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-slate-800">
                            {appt.client_name}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-medium">
                            {appt.appointment_type}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${statusBadge}`}>
                            {statusLabel}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-600">
                          <span className="flex items-center gap-1 font-medium text-slate-700">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {formatDateMMDDYYYY(appt.appointment_date)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {formatTime12(appt.start_time)} – {formatTime12(appt.end_time)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-slate-400" />
                            {compName}
                          </span>
                          {prof && (
                            <span className="text-slate-500">
                              Coworker: <strong className="font-medium text-slate-700">{prof.full_name}</strong>
                            </span>
                          )}
                        </div>

                        {(appt.client_phone || appt.client_email) && (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-xs text-slate-500">
                            {appt.client_phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {appt.client_phone}
                              </span>
                            )}
                            {appt.client_email && (
                              <span className="flex items-center gap-1">
                                <Mail className="w-3 h-3 text-slate-400" />
                                {appt.client_email}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className="flex flex-wrap items-center gap-1.5 shrink-0 pl-6 lg:pl-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={isUpdating || isCompleted}
                        onClick={(e) => handleQuickStatus(e, appt, 'Completed')}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                          isCompleted
                            ? 'bg-green-100 text-green-800 border-green-300 cursor-default'
                            : 'bg-white hover:bg-green-50 text-green-700 border-slate-200 hover:border-green-300 disabled:opacity-50'
                        }`}
                        title="Mark Completed"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Completed
                      </button>

                      <button
                        type="button"
                        disabled={isUpdating || isCancelled}
                        onClick={(e) => handleQuickStatus(e, appt, 'Cancelled')}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                          isCancelled
                            ? 'bg-red-100 text-red-800 border-red-300 cursor-default'
                            : 'bg-white hover:bg-red-50 text-red-600 border-slate-200 hover:border-red-300 disabled:opacity-50'
                        }`}
                        title="Mark Cancelled"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Cancelled
                      </button>

                      <button
                        type="button"
                        disabled={isUpdating || isRescheduled}
                        onClick={(e) => handleQuickStatus(e, appt, 'Rescheduled')}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                          isRescheduled
                            ? 'bg-purple-100 text-purple-800 border-purple-300 cursor-default'
                            : 'bg-white hover:bg-purple-50 text-purple-700 border-slate-200 hover:border-purple-300 disabled:opacity-50'
                        }`}
                        title="Mark Rescheduled"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CalendarClock className="w-3.5 h-3.5" />
                        )}
                        Rescheduled
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
