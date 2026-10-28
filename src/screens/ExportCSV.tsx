import { useState } from 'react';
import { getAppointments } from '@/lib/store';
import { Appointment, Profile, Company } from '@/types';
import { X, Download, FileText, Loader2 } from 'lucide-react';

interface ExportCSVProps {
  profiles: Profile[];
  companies: Company[];
  onClose: () => void;
}

function escapeCSVCell(value: string): string {
  if (!value) return '';
  const sanitized = value.replace(/^[=+\-@]/, (match) => `'${match}`);
  if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

export function ExportCSV({ profiles, companies, onClose }: ExportCSVProps) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exported, setExported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleExport() {
    setLoading(true);
    setError('');
    try {
      let appointments = await getAppointments();
      appointments = appointments.sort((a, b) => a.appointment_date.localeCompare(b.appointment_date));
      if (startDate) appointments = appointments.filter(a => a.appointment_date >= startDate);
      if (endDate) appointments = appointments.filter(a => a.appointment_date <= endDate);

      const profileMap = new Map(profiles.map(p => [p.id, p]));
      const companyMap = new Map(companies.map(c => [c.id, c]));

      const headers = [
        'Date', 'Start Time', 'End Time', 'Type', 'Client Name',
        'Client Phone', 'Client Email', 'Assigned Coworker',
        'Company', 'Status', 'Notes',
      ];

      const rows = appointments.map(appt => {
        const prof = profileMap.get(appt.assigned_to);
        const comp = companyMap.get(appt.company_id || '');
        return [
          appt.appointment_date,
          appt.start_time,
          appt.end_time,
          appt.appointment_type,
          appt.client_name,
          appt.client_phone,
          appt.client_email,
          prof?.full_name || '',
          comp?.name || appt.company_snapshot?.name || '',
          appt.status,
          appt.notes,
        ].map(escapeCSVCell).join(',');
      });

      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `appointments_${startDate || 'all'}_${endDate || 'all'}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export appointments.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Export Appointments (CSV)</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="text-sm text-slate-500">
            Export all appointments or filter by date range. The CSV file includes date, times, type, client info, assigned coworker, company, status, and notes.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {exported && !error && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              CSV file downloaded successfully.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleExport}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {loading ? 'Exporting...' : 'Download CSV'}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
