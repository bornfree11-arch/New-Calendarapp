import { useState, useEffect } from 'react';
import { getAuditLogs, AuditEntry } from '@/lib/store';
import { X, ScrollText, Loader2 } from 'lucide-react';

interface AuditLogProps {
  onClose: () => void;
}

export function AuditLog({ onClose }: AuditLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const logs = await getAuditLogs(100);
        setEntries(logs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit logs.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function formatDate(ts: string) {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Audit Log</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}
          {loading ? (
            <div className="text-center py-12 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No audit entries yet.</div>
          ) : (
            <div className="space-y-1">
              {entries.map(entry => (
                <div key={entry.id} className="px-4 py-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{entry.action_type}</span>
                      <span className="text-sm text-slate-700">{entry.change_summary}</span>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{formatDate(entry.created_at)}</span>
                  </div>
                  {(entry.previous_values || entry.new_values) && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      {entry.previous_values && Object.keys(entry.previous_values).length > 0 && (
                        <div className="bg-red-50 rounded p-2">
                          <div className="font-medium text-red-700 mb-1">Before:</div>
                          <pre className="text-red-600 whitespace-pre-wrap break-words">{JSON.stringify(entry.previous_values, null, 1)}</pre>
                        </div>
                      )}
                      {entry.new_values && Object.keys(entry.new_values).length > 0 && (
                        <div className="bg-green-50 rounded p-2">
                          <div className="font-medium text-green-700 mb-1">After:</div>
                          <pre className="text-green-600 whitespace-pre-wrap break-words">{JSON.stringify(entry.new_values, null, 1)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
