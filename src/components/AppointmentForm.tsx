import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { saveAppointment, getAppointmentsByDate, searchAppointments, buildCompanySnapshot } from '@/lib/store';
import {
  Appointment,
  Profile,
  Company,
  AppointmentTypeMapping,
  AppointmentType,
  AppointmentStatus,
  DurationMinutes,
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
  DURATIONS,
} from '@/types';
import {
  formatDateISO,
  formatTime12,
  calculateEndTime,
  formatPhoneNumber,
  isValidPhoneNumber,
  isValidEmail,
} from '@/lib/dateUtils';
import { X, Save, AlertTriangle, Search, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface AppointmentFormProps {
  appointment: Appointment | null;
  initialDate: Date;
  initialStartTime: string | null;
  profiles: Profile[];
  companies: Company[];
  typeMappings: AppointmentTypeMapping[];
  onClose: () => void;
  onSaved: () => void;
}

interface OverlapWarning {
  coworker_name: string;
  client_name: string;
  start_time: string;
  end_time: string;
  overlap_start: string;
  overlap_end: string;
}

export function AppointmentForm({
  appointment,
  initialDate,
  initialStartTime,
  profiles,
  companies,
  typeMappings,
  onClose,
  onSaved,
}: AppointmentFormProps) {
  const { profile: currentUser } = useAuth();

  const activeProfiles = profiles.filter(p => p.status === 'active');

  const [date, setDate] = useState(formatDateISO(appointment?.appointment_date ? new Date(appointment.appointment_date + 'T00:00') : initialDate));
  const [startTime, setStartTime] = useState(appointment?.start_time || initialStartTime || '09:00:00');
  const [duration, setDuration] = useState<DurationMinutes>(appointment?.duration_minutes || 30);
  const [apptType, setApptType] = useState<AppointmentType>(appointment?.appointment_type || 'Tax/Accounting');
  const [clientName, setClientName] = useState(appointment?.client_name || '');
  const [clientPhone, setClientPhone] = useState(appointment?.client_phone || '');
  const [clientEmail, setClientEmail] = useState(appointment?.client_email || '');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [assignedTo, setAssignedTo] = useState(appointment?.assigned_to || currentUser?.id || '');
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status || 'Scheduled');
  const [companyId, setCompanyId] = useState<string | null>(appointment?.company_id || null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [overlapWarnings, setOverlapWarnings] = useState<OverlapWarning[]>([]);
  const [acknowledgedOverlaps, setAcknowledgedOverlaps] = useState(false);
  const [checkingOverlaps, setCheckingOverlaps] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [clientSearchResults, setClientSearchResults] = useState<{ name: string; phone: string; email: string }[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);

  const timeSlotOptions = useMemo(() => {
    const slots: string[] = [];
    for (let h = 7; h <= 18; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 19 && m > 0) break;
        if (h === 18 && m > 30) break;
        slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
      }
    }
    return slots;
  }, []);

  const endTime = useMemo(() => calculateEndTime(startTime, duration), [startTime, duration]);

  const defaultCompanyId = useMemo(() => {
    const mapping = typeMappings.find(m => m.appointment_type === apptType);
    return mapping?.company_id || null;
  }, [apptType, typeMappings]);

  useEffect(() => {
    if (!appointment) {
      setCompanyId(defaultCompanyId);
    }
  }, [defaultCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignedCompany = companies.find(c => c.id === companyId);

  useEffect(() => {
    if (clientSearchQuery.length >= 2) {
      setClientSearchLoading(true);
      const timer = setTimeout(async () => {
        try {
          const results: { name: string; phone: string; email: string }[] = [];
          const seen = new Set<string>();
          const all = await searchAppointments(clientSearchQuery);
          for (const row of all) {
            const key = `${row.client_name}-${row.client_phone}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                name: row.client_name,
                phone: row.client_phone,
                email: row.client_email || '',
              });
            }
          }
          setClientSearchResults(results);
        } catch {
          setClientSearchResults([]);
        } finally {
          setClientSearchLoading(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setClientSearchResults([]);
    }
  }, [clientSearchQuery]);

  function handleClientSearch(query: string) {
    setClientSearchQuery(query);
    setShowClientSearch(true);
  }

  function selectClient(client: { name: string; phone: string; email: string }) {
    setClientName(client.name);
    setClientPhone(client.phone);
    setClientEmail(client.email);
    setClientSearchQuery('');
    setShowClientSearch(false);
  }

  const sameDayAppts: Appointment[] = [];

  async function checkOverlaps(excludeId?: string): Promise<OverlapWarning[]> {
    const overlaps: OverlapWarning[] = [];
    const newStart = startTime;
    const newEnd = endTime;

    let sameDay: Appointment[];
    try {
      sameDay = await getAppointmentsByDate(date);
    } catch {
      return [];
    }
    sameDayAppts.length = 0;
    sameDayAppts.push(...sameDay);

    const filtered = sameDay.filter(a => a.id !== excludeId && a.status !== 'Cancelled');

    for (const other of filtered) {
      if (other.start_time < newEnd && other.end_time > newStart) {
        const otherProfile = profiles.find(p => p.id === other.assigned_to);
        const overlapStart = other.start_time > newStart ? other.start_time : newStart;
        const overlapEnd = other.end_time < newEnd ? other.end_time : newEnd;
        overlaps.push({
          coworker_name: otherProfile?.full_name || 'Unknown',
          client_name: other.client_name,
          start_time: other.start_time,
          end_time: other.end_time,
          overlap_start: overlapStart,
          overlap_end: overlapEnd,
        });
      }
    }
    return overlaps;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      if (!date) { setError('Please select a date.'); return; }
      const todayISO = formatDateISO(new Date());
      if (date < todayISO) {
        setError('Cannot create appointments in the past. Please select today or a future date.');
        return;
      }
      if (!clientName.trim()) { setError('Client name is required.'); return; }
      if (!isValidPhoneNumber(clientPhone)) { setError('Please enter a valid US phone number: (555) 123-4567'); return; }
      if (clientEmail && !isValidEmail(clientEmail)) { setError('Please enter a valid email address.'); return; }
      if (!assignedTo) { setError('Please assign a coworker.'); return; }

      const endTimeCalc = calculateEndTime(startTime, duration);
      if (endTimeCalc > '19:00:00') {
        setError(`Appointment end time (${formatTime12(endTimeCalc)}) exceeds the 7:00 PM boundary.`);
        return;
      }

      if (!acknowledgedOverlaps) {
        setCheckingOverlaps(true);
        const overlaps = await checkOverlaps(appointment?.id);
        setCheckingOverlaps(false);

        const sameUserOverlaps = overlaps.filter(w => {
          const otherAppt = sameDayAppts.find(a => a.client_name === w.client_name && a.start_time === w.start_time);
          return otherAppt?.assigned_to === assignedTo;
        });

        if (sameUserOverlaps.length > 0) {
          setError('Error: This user already has an appointment scheduled at this time. Appointments can not overlap for same user.');
          return;
        }

        const otherUserOverlaps = overlaps.filter(w => !sameUserOverlaps.includes(w));
        if (otherUserOverlaps.length > 0) {
          setOverlapWarnings(otherUserOverlaps);
          return;
        }
      }

      const assignedComp = companies.find(c => c.id === companyId);
      const savedAppt = await saveAppointment({
        ...(appointment?.id ? { id: appointment.id } : {}),
        appointment_date: date,
        start_time: startTime,
        duration_minutes: duration,
        end_time: endTimeCalc,
        appointment_type: apptType,
        client_name: clientName.trim(),
        client_phone: clientPhone,
        client_email: clientEmail,
        notes: notes,
        assigned_to: assignedTo,
        company_id: companyId,
        company_snapshot: buildCompanySnapshot(assignedComp || null) || appointment?.company_snapshot || null,
        status: status,
        created_by: appointment?.created_by || currentUser?.id || null,
      }, currentUser?.id || null);

      if (!appointment) {
        const assignedProfile = profiles.find(p => p.id === assignedTo);

        // Send confirmation email if client email is on file
       if (clientEmail && date !== formatDateISO(new Date())) {
          try {
            await supabase.functions.invoke('send-reminder', {
              method: 'POST',
              body: JSON.stringify({
                manual: true,
                recipient_type: 'client',
                recipient_address: clientEmail,
                appointment: {
                  id: savedAppt.id,
                  appointment_date: savedAppt.appointment_date,
                  start_time: savedAppt.start_time,
                  end_time: savedAppt.end_time,
                  appointment_type: savedAppt.appointment_type,
                  client_name: savedAppt.client_name,
                  client_phone: savedAppt.client_phone,
                  client_email: savedAppt.client_email,
                  notes: savedAppt.notes,
                  assigned_to: savedAppt.assigned_to,
                  company_snapshot: savedAppt.company_snapshot,
                },
                profile: assignedProfile
                  ? { full_name: assignedProfile.full_name, email: assignedProfile.email }
                  : null,
              }),
            });
          } catch {
            // Email failure must not block the save — fail silently
          }
        }

        // Automatically send SMS confirmation to client via Bird API
        if (clientPhone) {
          try {
            await supabase.functions.invoke('send-reminder', {
              method: 'POST',
              body: JSON.stringify({
                manual: true,
                channel: 'sms',
                recipient_type: 'client',
                recipient_address: clientPhone,
                appointment: {
                  id: savedAppt.id,
                  appointment_date: savedAppt.appointment_date,
                  start_time: savedAppt.start_time,
                  end_time: savedAppt.end_time,
                  appointment_type: savedAppt.appointment_type,
                  client_name: savedAppt.client_name,
                  client_phone: savedAppt.client_phone,
                  client_email: savedAppt.client_email,
                  notes: savedAppt.notes,
                  assigned_to: savedAppt.assigned_to,
                  company_snapshot: savedAppt.company_snapshot,
                },
                profile: assignedProfile
                  ? { full_name: assignedProfile.full_name, email: assignedProfile.email, phone: assignedProfile.phone }
                  : null,
              }),
            });
          } catch {
            // SMS failure must not block the save — fail silently
          }
        }
      }

      onSaved();
       
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save appointment.');
    } finally {
      setSaving(false);
      setCheckingOverlaps(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-lg font-semibold text-slate-800">
            {appointment ? 'Edit Appointment' : 'New Appointment'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Time *</label>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
              >
                {timeSlotOptions.map(t => (
                  <option key={t} value={t}>{formatTime12(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Duration *</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as DurationMinutes)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
              >
                {DURATIONS.map(d => (
                  <option key={d} value={d}>{d} minutes</option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            End time: <strong>{formatTime12(endTime)}</strong>
            {endTime > '19:00:00' && (
              <span className="text-red-600 ml-2">(Exceeds 7:00 PM — will be rejected)</span>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Appointment Type *</label>
            <select
              value={apptType}
              onChange={(e) => {
                const newType = e.target.value as AppointmentType;
                setApptType(newType);
                const mapping = typeMappings.find(m => m.appointment_type === newType);
                setCompanyId(mapping?.company_id || null);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
            >
              {APPOINTMENT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">Client Information</label>
              <button
                type="button"
                onClick={() => setShowClientSearch(!showClientSearch)}
                className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                <Search className="w-3.5 h-3.5" />
                Search existing
              </button>
            </div>

            {showClientSearch && (
              <div className="relative mb-2">
                <input
                  type="text"
                  value={clientSearchQuery}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  placeholder="Search by name or phone..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                />
                {clientSearchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  </div>
                )}
                {clientSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                    {clientSearchResults.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => selectClient(c)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 text-sm"
                      >
                        <div className="font-medium text-slate-700">{c.name}</div>
                        <div className="text-xs text-slate-400">{c.phone} {c.email && `· ${c.email}`}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone *</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatPhoneNumber(e.target.value))}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email (optional, required for client reminder)</label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                placeholder="client@example.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none resize-none"
              placeholder="Optional notes about this appointment..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Coworker *</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
              >
                {activeProfiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}{p.id === currentUser?.id ? ' (You)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
              >
                {APPOINTMENT_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Associated Company</label>
            <select
              value={companyId || ''}
              onChange={(e) => setCompanyId(e.target.value || null)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
            >
              <option value="">No company assigned</option>
              {companies.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {assignedCompany && (
              <div className="text-xs text-slate-500 mt-1.5 bg-slate-50 rounded-lg px-3 py-2">
                <div>{assignedCompany.address_line1}</div>
                <div>{assignedCompany.city}, {assignedCompany.state} {assignedCompany.zip_code}</div>
                {assignedCompany.phone && <div>{assignedCompany.phone}</div>}
              </div>
            )}
            {!assignedCompany && (
              <div className="text-xs text-amber-600 mt-1">
                No company mapped for this appointment type. Reminders will not be sent until configured.
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {overlapWarnings.length > 0 && !acknowledgedOverlaps && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-800 text-sm">Overlap Warning</div>
                  <div className="text-xs text-amber-700 mt-1">
                    The following appointments overlap with your proposed time. The existing appointments will not be changed. You may proceed to save this new appointment after reviewing.
                  </div>
                </div>
              </div>
              <div className="space-y-2 mt-3">
                {overlapWarnings.map((w, i) => (
                  <div key={i} className="text-xs text-amber-900 bg-amber-100/50 rounded-lg px-3 py-2">
                    <strong>{w.coworker_name}</strong> has an appointment with <strong>{w.client_name}</strong>{' '}
                    from {formatTime12(w.start_time)} to {formatTime12(w.end_time)}.
                    Your proposed appointment from {formatTime12(startTime)} to {formatTime12(endTime)}{' '}
                    overlaps from {formatTime12(w.overlap_start)} to {formatTime12(w.overlap_end)}.
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setAcknowledgedOverlaps(true)}
                  className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition"
                >
                  Acknowledge & Proceed
                </button>
                <button
                  type="button"
                  onClick={() => setOverlapWarnings([])}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel & Adjust
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || checkingOverlaps}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
            >
              {saving || checkingOverlaps ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {checkingOverlaps ? 'Checking...' : saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
