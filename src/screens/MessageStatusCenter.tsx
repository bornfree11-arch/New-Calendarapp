import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  getDeliveryFailures,
  acknowledgeAlert,
  resolveAlert,
  retryFailedMessage,
} from '@/lib/store';
import { DeliveryFailureWithDetails } from '@/types';
import {
  X,
  AlertTriangle,
  CheckCircle,
  Phone,
  User,
  Calendar,
  MessageSquare,
  Clock,
  Bug,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';

interface MessageStatusCenterProps {
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  accepted: 'bg-blue-100 text-blue-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  read: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatApptDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

export function MessageStatusCenter({ onClose }: MessageStatusCenterProps) {
  const { profile } = useAuth();
  const [failures, setFailures] = useState<DeliveryFailureWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'outstanding' | 'all'>('outstanding');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [retryStatus, setRetryStatus] = useState<Record<string, string>>({});

  const loadFailures = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all = await getDeliveryFailures();
      const filtered = filter === 'outstanding'
        ? all.filter(f => !f.alert.acknowledged)
        : all;
      setFailures(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load delivery failures.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadFailures();
  }, [loadFailures]);

  async function handleAcknowledge(alertId: string) {
    if (!profile) return;
    setActionLoading(`ack-${alertId}`);
    try {
      await acknowledgeAlert(alertId, profile.id);
      await loadFailures();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge alert.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResolve(alertId: string) {
    if (!profile) return;
    setActionLoading(`resolve-${alertId}`);
    try {
      await resolveAlert(alertId, profile.id);
      await loadFailures();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve alert.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRetry(attemptId: string, alertId: string) {
    setActionLoading(`retry-${attemptId}`);
    setRetryStatus(prev => ({ ...prev, [attemptId]: 'Retrying...' }));
    try {
      const result = await retryFailedMessage(attemptId);
      if (result.success) {
        setRetryStatus(prev => ({ ...prev, [attemptId]: 'Retry sent successfully. A new attempt record has been created.' }));
        await loadFailures();
      } else {
        setRetryStatus(prev => ({ ...prev, [attemptId]: `Retry failed: ${result.error}` }));
      }
    } catch (err) {
      setRetryStatus(prev => ({ ...prev, [attemptId]: `Retry error: ${err instanceof Error ? err.message : 'Unknown error'}` }));
    } finally {
      setActionLoading(null);
    }
  }

  const outstandingCount = failures.filter(f => !f.alert.acknowledged && !f.alert.resolved).length;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="relative">
              <MessageSquare className="w-5 h-5 text-slate-700" />
              {outstandingCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full ring-2 ring-white" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Message Status Center</h2>
            {outstandingCount > 0 && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                {outstandingCount} unacknowledged
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Info banner */}
        <div className="mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          A red dot on the Message Status button in the header means one or more WhatsApp delivery failures need your attention. Acknowledge to clear the notification. Resolve when the issue is addressed (e.g. successful retry or alternative contact). Historical records are preserved.
        </div>

        {/* Filter */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100">
          <div className="flex gap-1">
            <button
              onClick={() => setFilter('outstanding')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                filter === 'outstanding'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Outstanding
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                filter === 'all'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All History
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading...
            </div>
          ) : failures.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
              <p className="text-sm">
                {filter === 'outstanding'
                  ? 'No outstanding delivery failures. All caught up.'
                  : 'No delivery failure records found.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {failures.map(({ attempt, alert, appointment, agent }) => {
                const isExpanded = expandedId === attempt.id;
                const showRetry = !alert.resolved && attempt.template_params && attempt.channel === 'sms';

                return (
                  <div
                    key={attempt.id}
                    className={`border rounded-xl overflow-hidden transition ${
                      alert.acknowledged
                        ? 'border-slate-200 bg-slate-50/50'
                        : 'border-red-200 bg-red-50/30'
                    }`}
                  >
                    {/* Summary row */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : attempt.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[attempt.delivery_status] || 'bg-slate-100'}`}>
                            {attempt.delivery_status}
                          </span>
                          {alert.acknowledged && (
                            <span className="text-xs px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-500">
                              Acknowledged
                            </span>
                          )}
                          {alert.resolved && (
                            <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-700">
                              Resolved
                            </span>
                          )}
                          {attempt.is_retry && (
                            <span className="text-xs px-2 py-0.5 rounded font-medium bg-blue-100 text-blue-700">
                              Retry
                            </span>
                          )}
                          <span className="text-xs text-slate-500">{attempt.channel.toUpperCase()}</span>
                        </div>
                        <div className="text-sm text-slate-700 mt-1 truncate">
                          {appointment?.client_name || 'Unknown client'}
                          {agent && ` → ${agent.full_name}`}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          To: {attempt.recipient_address} · {formatDate(attempt.status_timestamp || attempt.created_at)}
                        </div>
                        {attempt.error_description && (
                          <div className="text-xs text-red-500 mt-1 truncate">
                            {attempt.error_description}
                          </div>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          <DetailRow icon={<User className="w-3.5 h-3.5" />} label="Customer Name" value={appointment?.client_name || '—'} />
                          <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Customer Phone" value={appointment?.client_phone || '—'} />
                          <DetailRow icon={<User className="w-3.5 h-3.5" />} label="Agent Name" value={agent?.full_name || '—'} />
                          <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Agent Phone" value={agent?.phone || '—'} />
                          <DetailRow
                            icon={<Calendar className="w-3.5 h-3.5" />}
                            label="Appointment"
                            value={appointment ? `${formatApptDate(appointment.appointment_date)} at ${formatTime(appointment.start_time)}` : '—'}
                          />
                          <DetailRow icon={<Clock className="w-3.5 h-3.5" />} label="Failure Time" value={formatDate(attempt.status_timestamp || attempt.created_at)} />
                        </div>

                        <div className="mt-3 space-y-2">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Original Message</div>
                          <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100">
                            {attempt.original_message || '—'}
                          </div>
                        </div>

                        <div className="mt-2 space-y-2">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bird Message ID</div>
                          <div className="text-xs text-slate-500 font-mono bg-slate-50 rounded-lg p-2 border border-slate-100 break-all">
                            {attempt.bird_message_id || '—'}
                          </div>
                        </div>

                        {/* Diagnostic details */}
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            <Bug className="w-3 h-3" /> Diagnostic Details
                          </div>
                          <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100 space-y-1">
                            <div><span className="font-medium">Delivery Status:</span> {attempt.delivery_status}</div>
                            <div><span className="font-medium">Error Code:</span> {attempt.error_code || '—'}</div>
                            <div><span className="font-medium">Error Description:</span> {attempt.error_description || '—'}</div>
                            <div><span className="font-medium">Meta Error Code:</span> {attempt.error_meta_code || '—'}</div>
                            <div><span className="font-medium">Agent Notified:</span> {attempt.agent_notified ? `Yes (${attempt.agent_notification_status})` : 'No'}</div>
                            <div><span className="font-medium">Template:</span> {attempt.template_slug || '—'}</div>
                            <div><span className="font-medium">Created:</span> {formatDate(attempt.created_at)}</div>
                            {attempt.is_retry && <div><span className="font-medium">Retry of:</span> {attempt.parent_attempt_id}</div>}
                            {attempt.resolved_by_retry && <div className="text-green-600"><span className="font-medium">Resolved by successful retry</span></div>}
                          </div>
                        </div>

                        {/* Retry status message */}
                        {retryStatus[attempt.id] && (
                          <div className="mt-2 text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
                            {retryStatus[attempt.id]}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {!alert.acknowledged && (
                            <button
                              onClick={() => handleAcknowledge(alert.id)}
                              disabled={actionLoading === `ack-${alert.id}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50"
                            >
                              {actionLoading === `ack-${alert.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle className="w-3.5 h-3.5" />
                              )}
                              Acknowledge
                            </button>
                          )}
                          {!alert.resolved && showRetry && (
                            <button
                              onClick={() => handleRetry(attempt.id, alert.id)}
                              disabled={actionLoading === `retry-${attempt.id}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition disabled:opacity-50"
                            >
                              {actionLoading === `retry-${attempt.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              Retry Send
                            </button>
                          )}
                          {!alert.resolved && (
                            <button
                              onClick={() => handleResolve(alert.id)}
                              disabled={actionLoading === `resolve-${alert.id}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition disabled:opacity-50"
                            >
                              {actionLoading === `resolve-${alert.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle className="w-3.5 h-3.5" />
                              )}
                              Mark Resolved
                            </button>
                          )}
                        </div>
                      </div>
                    )}
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

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-400 mt-0.5">{icon}</span>
      <div>
        <div className="text-xs text-slate-400">{label}</div>
        <div className="text-sm text-slate-700">{value}</div>
      </div>
    </div>
  );
}
