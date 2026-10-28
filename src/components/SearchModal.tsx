import { useState, useEffect } from 'react';
import { searchAppointments } from '@/lib/store';
import { Appointment, Profile } from '@/types';
import { formatTime12, formatDateMedium, parseDateISO } from '@/lib/dateUtils';
import { X, Search, Calendar, Loader2 } from 'lucide-react';

interface SearchModalProps {
  profiles: Profile[];
  onClose: () => void;
  onResultClick: (appointment: Appointment) => void;
}

export function SearchModal({ profiles, onClose, onResultClick }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Appointment[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setError('');
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const found = await searchAppointments(query.trim());
        setResults(found);
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed.');
        setSearched(true);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const profileMap = new Map(profiles.map(p => [p.id, p]));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-20">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Search Appointments</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by client name or phone number..."
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {loading && (
            <div className="text-center py-8 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Searching...
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              No appointments found for "{query}"
            </div>
          )}

          {!loading && !searched && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Type at least 2 characters to search
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-2">
              {results.map(appt => {
                const prof = profileMap.get(appt.assigned_to);
                return (
                  <button
                    key={appt.id}
                    onClick={() => onResultClick(appt)}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-slate-200 transition"
                  >
                    {prof && (
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: prof.calendar_color }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 text-sm truncate">{appt.client_name}</span>
                        <span className="text-xs text-slate-400">{appt.appointment_type}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {formatDateMedium(parseDateISO(appt.appointment_date))} · {formatTime12(appt.start_time)} – {formatTime12(appt.end_time)}
                        {' · '}{prof?.full_name || 'Unknown'}
                        {' · '}<span className={
                          appt.status === 'Cancelled' ? 'text-red-500' :
                          appt.status === 'Completed' ? 'text-green-600' :
                          appt.status === 'No-show' ? 'text-amber-600' : 'text-slate-500'
                        }>{appt.status}</span>
                      </div>
                    </div>
                    <Calendar className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
