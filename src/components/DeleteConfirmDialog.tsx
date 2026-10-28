import { Appointment, Profile } from '@/types';
import { formatTime12, formatDateLong, parseDateISO } from '@/lib/dateUtils';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

interface DeleteConfirmProps {
  appointment: Appointment;
  profile?: Profile;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DeleteConfirmDialog({ appointment, profile, onConfirm, onCancel, loading = false }: DeleteConfirmProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-semibold text-slate-800">Delete Appointment</h2>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-slate-600 mb-3">
            Are you sure you want to delete this appointment? This action cannot be undone.
          </p>
          <div className="bg-slate-50 rounded-lg px-4 py-3 space-y-1 text-sm">
            <div className="font-medium text-slate-800">{appointment.client_name}</div>
            <div className="text-slate-500">{appointment.appointment_type}</div>
            <div className="text-slate-500">
              {formatDateLong(parseDateISO(appointment.appointment_date))}
            </div>
            <div className="text-slate-500">
              {formatTime12(appointment.start_time)} – {formatTime12(appointment.end_time)}
            </div>
            {profile && <div className="text-slate-500">Assigned to: {profile.full_name}</div>}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Deleting...' : 'Delete'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
