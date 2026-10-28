import { useState, useEffect, useCallback } from 'react';
import { getReminders, ReminderRow } from '@/lib/store';
import { X, Bell, AlertCircle, Loader2 } from 'lucide-react';

interface ReminderStatusProps {
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-amber-100 text-amber-700',
};

export function ReminderStatus({ onClose }: ReminderStatusProps) {
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const loadReminders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let all = await getReminders();
      if (filter !== 'all') all = all.filter(r => r.status === filter);
      setReminders(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reminders.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadReminders(); }, [loadReminders]);

  function formatDate(ts: string | null) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Reminder Status</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="mx-6 mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
          Reminders are scheduled for 8:00 AM ET on the morning of each appointment. A scheduled job checks every few minutes and sends any due reminders. "Sent" means the email provider accepted the send request — confirmed delivery is not guaranteed.
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

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
          ) : reminders.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No reminders found.</div>
          ) : (
            <div className="space-y-2">
              {reminders.map(r => (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[r.status] || 'bg-slate-100'}`}>
                        {r.status}
                      </span>
                      <span className="text-xs text-slate-500">{r.recipient_type}</span>
                      {r.retry_count > 0 && (
                        <span className="text-xs text-amber-600">retry {r.retry_count}/3</span>
                      )}
                    </div>
                    <div className="text-sm text-slate-700 mt-1 truncate">{r.recipient_address || '(no address)'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Scheduled: {formatDate(r.scheduled_send_at)} · Attempted: {formatDate(r.attempted_at)}
                    </div>
                    {r.error_details && (
                      <div className="text-xs text-red-500 mt-1 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                        {r.error_details}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
