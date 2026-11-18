import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { saveAppointment, getAppointmentsByDate, searchAppointments, searchCustomers, buildCompanySnapshot, findMatchingCustomer, saveCustomer, getCustomerById, logCalendarSentEmail } from '@/lib/store';
import {
  Appointment,
  Profile,
  Company,
  Customer,
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
  formatDateMMDDYYYY,
  formatTime12,
  calculateEndTime,
  formatPhoneNumber,
  isValidPhoneNumber,
  isValidEmail,
  isDummyPhoneNumber,
} from '@/lib/dateUtils';
import { X, Save, AlertTriangle, Search, Loader2, MessageCircle, Users, BookUser, Globe, CalendarClock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface AppointmentFormProps {
  appointment: Appointment | null;
  initialDate: Date;
  initialStartTime: string | null;
  profiles: Profile[];
  companies: Company[];
  typeMappings?: AppointmentTypeMapping[];
  rescheduleMode?: boolean;
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
  rescheduleMode = false,
  onClose,
  onSaved,
}: AppointmentFormProps) {
  const { profile: currentUser } = useAuth();

  const activeProfiles = profiles.filter(p => p.status === 'active');

  const fallbackPrimaryCompanyId = useMemo(() => {
    return companies.find(c => c.is_active)?.id || companies[0]?.id || null;
  }, [companies]);

  const getEmployeeDefaultCompanyId = useCallback((userId: string): string | null => {
    const emp = profiles.find(p => p.id === userId) || (currentUser?.id === userId ? currentUser : undefined);
    if (emp?.default_company_id) {
      return emp.default_company_id;
    }
    return fallbackPrimaryCompanyId;
  }, [profiles, currentUser, fallbackPrimaryCompanyId]);

  const initialAssignedTo = appointment?.assigned_to || currentUser?.id || '';
  const todayISO = formatDateISO(new Date());
  const defaultDateISO = (() => {
    if (appointment?.appointment_date) {
      if (rescheduleMode && appointment.appointment_date < todayISO) {
        return todayISO;
      }
      return formatDateISO(new Date(appointment.appointment_date + 'T00:00'));
    }
    return formatDateISO(initialDate);
  })();

  const [date, setDate] = useState(defaultDateISO);
  const [startTime, setStartTime] = useState(appointment?.start_time || initialStartTime || '09:00:00');
  const [duration, setDuration] = useState<DurationMinutes>(appointment?.duration_minutes || 30);
  const [apptType, setApptType] = useState<AppointmentType>(appointment?.appointment_type || 'Tax/Accounting');
  const [clientName, setClientName] = useState(appointment?.client_name || '');
  const [clientPhone, setClientPhone] = useState(appointment?.client_phone || '');
  const [clientEmail, setClientEmail] = useState(appointment?.client_email || '');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [assignedTo, setAssignedTo] = useState(initialAssignedTo);
  const [status, setStatus] = useState<AppointmentStatus>(rescheduleMode ? 'Rescheduled' : (appointment?.status || 'Scheduled'));
  const [companyId, setCompanyId] = useState<string | null>(() =>
    appointment ? (appointment.company_id || null) : getEmployeeDefaultCompanyId(initialAssignedTo)
  );
  const [companyManuallyChanged, setCompanyManuallyChanged] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [overlapWarnings, setOverlapWarnings] = useState<OverlapWarning[]>([]);
  const [acknowledgedOverlaps, setAcknowledgedOverlaps] = useState(false);
  const [checkingOverlaps, setCheckingOverlaps] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [clientSearchResults, setClientSearchResults] = useState<{ name: string; phone: string; email: string }[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(appointment?.send_whatsapp ?? false);
  const [whatsappManuallyUnchecked, setWhatsappManuallyUnchecked] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(appointment?.customer_id || null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [updateCustomerRecord, setUpdateCustomerRecord] = useState(true);
  const [saveToBook, setSaveToBook] = useState(true);
  const [saveAsGlobal, setSaveAsGlobal] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null);
  const [companyConflictCustomer, setCompanyConflictCustomer] = useState<Customer | null>(null);
  const [nameSuggestions, setNameSuggestions] = useState<Customer[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);

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

  useEffect(() => {
    if (!appointment && !companyManuallyChanged) {
      setCompanyId(getEmployeeDefaultCompanyId(assignedTo));
    }
  }, [appointment, assignedTo, companyManuallyChanged, getEmployeeDefaultCompanyId]);

  useEffect(() => {
    if (!appointment?.customer_id) return;
    let active = true;
    getCustomerById(appointment.customer_id)
      .then((cust) => {
        if (active && cust) {
          setLinkedCustomer(cust);
        }
      })
      .catch(() => {
        // Best-effort fetch
      });
    return () => { active = false; };
  }, [appointment?.customer_id]);

  const assignedCompany = companies.find(c => c.id === companyId);

  useEffect(() => {
    if (clientSearchQuery.length >= 2) {
      setClientSearchLoading(true);
      const timer = setTimeout(async () => {
        try {
          const results: { name: string; phone: string; email: string }[] = [];
          const seen = new Set<string>();
          if (!companyId) {
            setClientSearchResults([]);
            return;
          }
          const all = await searchAppointments(clientSearchQuery);
          for (const row of all) {
            if (row.company_id !== companyId) continue;
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
  }, [clientSearchQuery, companyId]);

  useEffect(() => {
    if (!showCustomerSearch) return;
    setCustomerSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchCustomers(customerSearchQuery, companyId);
        setCustomerSearchResults(results);
      } catch {
        setCustomerSearchResults([]);
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [customerSearchQuery, companyId, showCustomerSearch]);

  useEffect(() => {
    if (!showNameSuggestions || selectedCustomerId || clientName.trim().length < 2) {
      setNameSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await searchCustomers(clientName.trim(), companyId);
        setNameSuggestions(results.slice(0, 8));
      } catch {
        setNameSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [clientName, companyId, selectedCustomerId, showNameSuggestions]);

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
    setShowNameSuggestions(false);
  }

  function selectCustomerFromDirectory(customer: Customer) {
    setSelectedCustomerId(customer.id);
    setLinkedCustomer(customer);
    setCompanyConflictCustomer(null);
    setClientName(customer.full_name);
    setClientPhone(customer.phone || '');
    setClientEmail(customer.email || '');
    setSendWhatsapp(customer.send_whatsapp && !isDummyPhoneNumber(customer.phone || '') && !!customer.phone);
    setCustomerSearchQuery('');
    setShowCustomerSearch(false);
    setShowNameSuggestions(false);
    setNameSuggestions([]);
    setUpdateCustomerRecord(true);
  }

  function clearCustomerLink() {
    setSelectedCustomerId(null);
    setLinkedCustomer(null);
    setCompanyConflictCustomer(null);
    setClientName('');
    setClientPhone('');
    setClientEmail('');
    setSendWhatsapp(false);
  }

  const whatsappDisabled = !clientPhone || isDummyPhoneNumber(clientPhone);

  useEffect(() => {
    if (whatsappDisabled && sendWhatsapp) {
      setSendWhatsapp(false);
    }
  }, [whatsappDisabled, sendWhatsapp]);

  useEffect(() => {
    if (appointment) return;
    const digits = clientPhone.replace(/\D/g, '');
    const isValidRealPhone = digits.length === 10 && !isDummyPhoneNumber(clientPhone);
    if (isValidRealPhone && !whatsappManuallyUnchecked) {
      setSendWhatsapp(true);
    }
  }, [appointment, clientPhone, whatsappManuallyUnchecked]);

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

  async function executeSave(conflictResolution?: 'switch' | 'global' | 'keep') {
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
      if (clientPhone && !isValidPhoneNumber(clientPhone)) { setError('Please enter a valid US phone number: (555) 123-4567'); return; }
      if (clientEmail && !isValidEmail(clientEmail)) { setError('Please enter a valid email address.'); return; }
      if (!assignedTo) { setError('Please assign a coworker.'); return; }

      const endTimeCalc = calculateEndTime(startTime, duration);
      if (endTimeCalc > '19:00:00') {
        setError(`Appointment end time (${formatTime12(endTimeCalc)}) exceeds the 7:00 PM boundary.`);
        return;
      }

      if (!acknowledgedOverlaps && !conflictResolution) {
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

      // Resolve linked customer record if linked
      let resolvedCustomerId = selectedCustomerId;
      let activeLinkedCustomer = linkedCustomer;
      if (resolvedCustomerId && !activeLinkedCustomer) {
        activeLinkedCustomer = await getCustomerById(resolvedCustomerId);
        if (activeLinkedCustomer) {
          setLinkedCustomer(activeLinkedCustomer);
        }
      }

      // Guard against silent cross-company customer reassignment
      const hasCrossCompanyConflict = Boolean(
        activeLinkedCustomer &&
        !activeLinkedCustomer.is_global &&
        activeLinkedCustomer.company_id !== null &&
        activeLinkedCustomer.company_id !== companyId
      );

      if (hasCrossCompanyConflict && !conflictResolution) {
        setCompanyConflictCustomer(activeLinkedCustomer);
        return;
      }

      // If creating or editing an appointment with no customer linked, link or save to customer book
      if (!resolvedCustomerId && saveToBook && clientName.trim()) {
        const phoneDigits = (clientPhone || '').replace(/\D/g, '');
        const hasRealPhone = phoneDigits.length === 10 && !isDummyPhoneNumber(phoneDigits);
        const match = await findMatchingCustomer(
          clientName.trim(),
          hasRealPhone ? clientPhone : '',
          clientEmail || '',
          companyId,
        );
        if (match) {
          resolvedCustomerId = match.id;
        } else if (companyId || saveAsGlobal) {
          const newCust = await saveCustomer({
            full_name: clientName.trim(),
            phone: hasRealPhone ? clientPhone : '',
            email: clientEmail || '',
            notes: '',
            tags: [],
            company_id: saveAsGlobal ? null : companyId,
            assigned_user_id: assignedTo || null,
            is_global: saveAsGlobal,
            send_whatsapp: hasRealPhone && sendWhatsapp,
          }, currentUser?.id || null);
          resolvedCustomerId = newCust.id;
        }
      }

      // Update linked customer record (contact info and/or cross-company resolution)
      if (resolvedCustomerId && activeLinkedCustomer) {
        const customerUpdates: Partial<Customer> & { id: string } = { id: resolvedCustomerId };
        let hasCustomerUpdates = false;

        if (updateCustomerRecord) {
          const phoneChanged = clientPhone !== (activeLinkedCustomer.phone || '');
          const emailChanged = clientEmail !== (activeLinkedCustomer.email || '');
          if (phoneChanged || emailChanged) {
            const phoneDigits = (clientPhone || '').replace(/\D/g, '');
            const hasRealPhone = phoneDigits.length === 10 && !isDummyPhoneNumber(phoneDigits);
            customerUpdates.phone = hasRealPhone ? clientPhone : (activeLinkedCustomer.phone || '');
            customerUpdates.email = clientEmail || (activeLinkedCustomer.email || '');
            customerUpdates.send_whatsapp = hasRealPhone ? sendWhatsapp : activeLinkedCustomer.send_whatsapp;
            hasCustomerUpdates = true;
          }
        }

        if (conflictResolution === 'switch') {
          customerUpdates.company_id = companyId;
          customerUpdates.is_global = false;
          hasCustomerUpdates = true;
        } else if (conflictResolution === 'global') {
          customerUpdates.company_id = null;
          customerUpdates.is_global = true;
          hasCustomerUpdates = true;
        }
        // When conflictResolution === 'keep', do NOT modify company_id or is_global.

        if (hasCustomerUpdates) {
          const updatedCustomer = await saveCustomer(customerUpdates, currentUser?.id || null);
          setLinkedCustomer(updatedCustomer);
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
        send_whatsapp: sendWhatsapp,
        customer_id: resolvedCustomerId,
        created_by: appointment?.created_by || currentUser?.id || null,
      }, currentUser?.id || null);

      setCompanyConflictCustomer(null);

      if (!appointment) {
        const assignedProfile = profiles.find(p => p.id === assignedTo);
        const compLabel = assignedComp?.name || savedAppt.company_snapshot?.name || 'Our Office';

        // Send confirmation email if client email is on file
        if (clientEmail && date !== formatDateISO(new Date())) {
          try {
            const { data: emailRes } = await supabase.functions.invoke('send-reminder', {
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
                  customer_id: savedAppt.customer_id ?? null,
                  company_id: savedAppt.company_id ?? null,
                  company_snapshot: savedAppt.company_snapshot,
                },
                profile: assignedProfile
                  ? { full_name: assignedProfile.full_name, email: assignedProfile.email }
                  : null,
              }),
            });
            if (emailRes?.status === 'sent' && !emailRes?.sent_email_logged) {
              await logCalendarSentEmail({
                customer_id: savedAppt.customer_id ?? null,
                appointment_id: savedAppt.id,
                channel: 'email',
                recipient_email: clientEmail,
                recipient_phone: clientPhone || null,
                recipient_name: savedAppt.client_name,
                subject: `Appointment Confirmation – ${compLabel}`,
                body: `Appointment confirmation email sent to ${savedAppt.client_name} (${clientEmail}) for ${formatDateMMDDYYYY(savedAppt.appointment_date)} at ${formatTime12(savedAppt.start_time)}.`,
                status: 'sent',
              });
            }
          } catch {
            // Email failure must not block the save — fail silently
          }
        }

        // Automatically send SMS confirmation to client via Bird API
        if (sendWhatsapp && clientPhone && !isDummyPhoneNumber(clientPhone)) {
          try {
            const { data: smsRes } = await supabase.functions.invoke('send-reminder', {
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
                  customer_id: savedAppt.customer_id ?? null,
                  company_id: savedAppt.company_id ?? null,
                  company_snapshot: savedAppt.company_snapshot,
                },
                profile: assignedProfile
                  ? { full_name: assignedProfile.full_name, email: assignedProfile.email, phone: assignedProfile.phone }
                  : null,
              }),
            });
            if (smsRes?.status === 'sent' && !smsRes?.sent_email_logged) {
              await logCalendarSentEmail({
                customer_id: savedAppt.customer_id ?? null,
                appointment_id: savedAppt.id,
                channel: 'whatsapp',
                recipient_email: clientEmail || '',
                recipient_phone: clientPhone,
                recipient_name: savedAppt.client_name,
                subject: `WhatsApp Appointment Confirmation – ${compLabel}`,
                body: `WhatsApp confirmation sent to ${savedAppt.client_name} (${clientPhone}) for ${formatDateMMDDYYYY(savedAppt.appointment_date)} at ${formatTime12(savedAppt.start_time)}.`,
                status: 'sent',
              });
            }
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await executeSave();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            {rescheduleMode && <CalendarClock className="w-5 h-5 text-purple-600" />}
            {rescheduleMode ? 'Reschedule Appointment' : appointment ? 'Edit Appointment' : 'New Appointment'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSave}
           onKeyDown={(e) => {
           if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
    }
  }}
  className="px-6 py-4 space-y-4"
>
          {rescheduleMode && appointment && (
            <div className="bg-purple-50 border border-purple-200 text-purple-900 rounded-xl px-4 py-3 text-xs leading-relaxed">
              Pick a new date and time for <strong>{appointment.client_name}</strong>. Customer, company, category, and notes are pre-filled, and the status will update to <strong>Rescheduled</strong>.
            </div>
          )}
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
              onChange={(e) => setApptType(e.target.value as AppointmentType)}
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setShowCustomerSearch(!showCustomerSearch); setShowClientSearch(false); }}
                  className={`flex items-center gap-1 text-xs font-medium ${showCustomerSearch ? 'text-teal-700' : 'text-teal-600'} hover:text-teal-700`}
                >
                  <Users className="w-3.5 h-3.5" />
                  From Directory
                </button>
                <button
                  type="button"
                  onClick={() => { setShowClientSearch(!showClientSearch); setShowCustomerSearch(false); }}
                  className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium"
                >
                  <Search className="w-3.5 h-3.5" />
                  Search existing
                </button>
              </div>
            </div>

            {showCustomerSearch && (
              <div className="relative mb-2">
                <input
                  type="text"
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                  placeholder={
                    assignedCompany
                      ? `Search ${assignedCompany.name} + Global customers...`
                      : 'Search Global customers...'
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                />
                {customerSearchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  </div>
                )}
                {customerSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                    {customerSearchResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomerFromDirectory(c)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-700">{c.full_name}</span>
                          {(c.is_global || c.company_id === null) && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                              <Globe className="w-2.5 h-2.5" /> Global
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          {c.phone && `${c.phone}`}
                          {c.phone && c.email && ' · '}
                          {c.email && c.email}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!customerSearchLoading && customerSearchResults.length === 0 && (
                  <div className="text-xs text-slate-400 mt-1.5 px-1">
                    No matching customers in {assignedCompany ? `${assignedCompany.name} or Global` : 'Global customers'}.
                  </div>
                )}
              </div>
            )}

            {selectedCustomerId && linkedCustomer && (() => {
              const phoneChanged = clientPhone !== (linkedCustomer.phone || '');
              const emailChanged = clientEmail !== (linkedCustomer.email || '');
              const showUpdateCheckbox = phoneChanged || emailChanged;
              return (
                <>
                  <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-teal-700 font-medium">Linked to customer directory</span>
                      {(linkedCustomer.is_global || linkedCustomer.company_id === null) ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                          <Globe className="w-2.5 h-2.5" /> Global
                        </span>
                      ) : linkedCustomer.company_id !== companyId ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full font-medium">
                          {companies.find(c => c.id === linkedCustomer.company_id)?.name || 'Different Company'}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={clearCustomerLink}
                      className="text-xs text-teal-600 hover:text-teal-800 font-medium"
                    >
                      Unlink
                    </button>
                  </div>
                  {showUpdateCheckbox && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={updateCustomerRecord}
                        onChange={(e) => setUpdateCustomerRecord(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-xs text-slate-600">Update customer record with new contact info</span>
                    </label>
                  )}
                </>
              );
            })()}

            {!selectedCustomerId && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveToBook}
                    onChange={(e) => setSaveToBook(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-xs text-slate-600 flex items-center gap-1.5">
                    <BookUser className="w-3.5 h-3.5 text-teal-600" />
                    Save customer to Book of Business
                  </span>
                </label>
                {saveToBook && (
                  <div className="ml-6 space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={saveAsGlobal}
                        onChange={(e) => setSaveAsGlobal(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-xs text-slate-600 flex items-center gap-1">
                        <Globe className="w-3 h-3 text-blue-600" />
                        Global Customer (visible across all companies)
                      </span>
                    </label>
                    {!companyId && !saveAsGlobal && (
                      <div className="text-[11px] text-amber-600">
                        Select an Associated Company or enable Global Customer to save to the directory.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {showClientSearch && (
              <div className="relative mb-2">
                <input
                  type="text"
                  value={clientSearchQuery}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  placeholder="Search past appointments by name or phone..."
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
              <div className="relative">
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    setShowNameSuggestions(true);
                  }}
                  onFocus={() => setShowNameSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="John Doe"
                />
                {showNameSuggestions && !selectedCustomerId && nameSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-44 overflow-y-auto">
                    {nameSuggestions.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectCustomerFromDirectory(c);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-700">{c.full_name}</span>
                          {(c.is_global || c.company_id === null) && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                              <Globe className="w-2.5 h-2.5" /> Global
                            </span>
                          )}
                        </div>
                        {(c.phone || c.email) && (
                          <div className="text-xs text-slate-400">
                            {c.phone && c.phone}
                            {c.phone && c.email && ' · '}
                            {c.email && c.email}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatPhoneNumber(e.target.value))}
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
            <label className={`flex items-center gap-2.5 select-none mt-1 ${whatsappDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
              <button
                type="button"
                role="switch"
                aria-checked={sendWhatsapp}
                disabled={whatsappDisabled}
                onClick={() => {
                  const next = !sendWhatsapp;
                  setSendWhatsapp(next);
                  if (!appointment) {
                    setWhatsappManuallyUnchecked(!next);
                  }
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${sendWhatsapp ? 'bg-green-500' : 'bg-slate-300'} ${whatsappDisabled ? 'cursor-not-allowed' : ''}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${sendWhatsapp ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-slate-700 flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-green-600" />
                Send WhatsApp confirmation
                {whatsappDisabled && <span className="text-xs text-slate-400">(requires valid phone)</span>}
              </span>
            </label>
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
              onChange={(e) => {
                setCompanyId(e.target.value || null);
                setCompanyManuallyChanged(true);
                setCompanyConflictCustomer(null);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
            >
              <option value="">No company assigned</option>
              {companies.filter(c => c.is_active || c.id === companyId).map(c => (
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
                No company assigned to this appointment. Reminders will not be sent until a company is selected.
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

          {companyConflictCustomer && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <div className="font-semibold text-amber-900">Cross-Company Customer Notice</div>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    This customer currently belongs to{' '}
                    <strong>
                      {companies.find(c => c.id === companyConflictCustomer.company_id)?.name || 'another company'}
                    </strong>
                    . How would you like to proceed?
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {companyId && assignedCompany && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => executeSave('switch')}
                    className="w-full text-left px-3.5 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg transition"
                  >
                    Switch Customer to {assignedCompany.name}
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => executeSave('global')}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition"
                >
                  Mark Customer as Global (Shared)
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => executeSave('keep')}
                  className="w-full text-left px-3.5 py-2 text-xs font-medium bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-300 rounded-lg transition"
                >
                  Keep Original Company (Appointment Only)
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setCompanyConflictCustomer(null)}
                  className="self-end px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Cancel
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
