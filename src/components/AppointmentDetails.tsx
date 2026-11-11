import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Appointment, Profile, Company, AppointmentStatus, Customer } from '@/types';
import { formatTime12, formatDateLong, getInitials, isDummyPhoneNumber } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabase';
import { findMatchingCustomer, saveCustomer, searchCustomers } from '@/lib/store';
import { X, Edit2, Trash2, MapPin, Phone, Mail, Clock, Building, Send, MessageSquare, CheckCircle2, AlertCircle, BookUser, Link2, Loader2, Search } from 'lucide-react';

interface AppointmentDetailsProps {
  appointment: Appointment;
  profile?: Profile;
  company?: Company | null;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onCustomerLinked?: (customerId: string) => void;
}

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  'Scheduled': 'bg-blue-100 text-blue-700',
  'Completed': 'bg-green-100 text-green-700',
  'Cancelled': 'bg-red-100 text-red-700',
  'No-show': 'bg-amber-100 text-amber-700',
};

export function AppointmentDetails({
  appointment,
  profile,
  company,
  onEdit,
  onDelete,
  onClose,
  onCustomerLinked,
}: AppointmentDetailsProps) {
  const { profile: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [reminderStatus, setReminderStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reminderError, setReminderError] = useState('');
  const [smsStatus, setSmsStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [smsError, setSmsError] = useState('');
  const [savingToBook, setSavingToBook] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(appointment.customer_id || null);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<Customer[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);

  async function handleSendReminder() {
    if (!appointment.client_email) {
      setReminderStatus('error');
      setReminderError('No client email address on file.');
      return;
    }
    setReminderStatus('sending');
    setReminderError('');
    try {
      const { data, error } = await supabase.functions.invoke('send-reminder', {
        method: 'POST',
        body: JSON.stringify({
          manual: true,
          recipient_type: 'client',
          recipient_address: appointment.client_email,
          appointment: {
            id: appointment.id,
            appointment_date: appointment.appointment_date,
            start_time: appointment.start_time,
            end_time: appointment.end_time,
            appointment_type: appointment.appointment_type,
            client_name: appointment.client_name,
            client_phone: appointment.client_phone,
            client_email: appointment.client_email,
            notes: appointment.notes,
            assigned_to: appointment.assigned_to,
            company_snapshot: appointment.company_snapshot,
          },
          profile: profile
            ? { full_name: profile.full_name, email: profile.email }
            : null,
        }),
      });
      if (error) throw error;
      if (data?.status === 'sent') {
        setReminderStatus('sent');
      } else {
        setReminderStatus('error');
        setReminderError(data?.error || 'The email service could not send the reminder.');
      }
    } catch (err) {
      setReminderStatus('error');
      setReminderError(err instanceof Error ? err.message : 'Failed to send reminder.');
    }
  }

  async function handleSendSMS() {
    if (!appointment.client_phone) {
      setSmsStatus('error');
      setSmsError('No client phone number on file.');
      return;
    }
    setSmsStatus('sending');
    setSmsError('');
    try {
      const { data, error } = await supabase.functions.invoke('send-reminder', {
        method: 'POST',
        body: JSON.stringify({
          manual: true,
          channel: 'sms',
          recipient_type: 'client',
          recipient_address: appointment.client_phone,
          appointment: {
            id: appointment.id,
            appointment_date: appointment.appointment_date,
            start_time: appointment.start_time,
            end_time: appointment.end_time,
            appointment_type: appointment.appointment_type,
            client_name: appointment.client_name,
            client_phone: appointment.client_phone,
            client_email: appointment.client_email,
            notes: appointment.notes,
            assigned_to: appointment.assigned_to,
            company_snapshot: appointment.company_snapshot,
          },
          profile: profile
            ? { full_name: profile.full_name, email: profile.email, phone: profile.phone }
            : null,
        }),
      });
      if (error) throw error;
      if (data?.status === 'sent') {
        setSmsStatus('sent');
      } else if (data?.status === 'skipped') {
        setSmsStatus('error');
        setSmsError(data?.error || data?.softFail ? 'SMS skipped — WhatsApp is disabled for this customer or the phone number is not a valid mobile number.' : 'SMS could not be sent (account restriction or insufficient funds).');
      } else {
        setSmsStatus('error');
        setSmsError(data?.error || 'The SMS service could not send the text.');
      }
    } catch (err) {
      setSmsStatus('error');
      setSmsError(err instanceof Error ? err.message : 'Failed to send text notification.');
    }
  }

  async function handleSaveToBook() {
    setSavingToBook(true);
    setLinkError('');
    try {
      const name = (appointment.client_name || '').trim();
      if (!name) { setLinkError('No client name on this appointment.'); return; }
      const phoneDigits = (appointment.client_phone || '').replace(/\D/g, '');
      const hasRealPhone = phoneDigits.length === 10 && !isDummyPhoneNumber(phoneDigits);
      const match = await findMatchingCustomer(name, hasRealPhone ? appointment.client_phone : '', appointment.client_email || '');
      let customerId: string;
      if (match) {
        customerId = match.id;
      } else {
        const newCust = await saveCustomer({
          full_name: name,
          phone: hasRealPhone ? appointment.client_phone : '',
          email: appointment.client_email || '',
          notes: '',
          tags: [],
          company_id: appointment.company_id || null,
          assigned_user_id: appointment.assigned_to || null,
          is_global: false,
          send_whatsapp: hasRealPhone && appointment.send_whatsapp,
        }, currentUser?.id || null);
        customerId = newCust.id;
      }
      const { error: updErr } = await supabase
        .from('appointments')
        .update({ customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('id', appointment.id);
      if (updErr) throw updErr;
      setLinkedCustomerId(customerId);
      onCustomerLinked?.(customerId);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to save to customer book.');
    } finally {
      setSavingToBook(false);
    }
  }

  async function handleLinkExisting(customer: Customer) {
    setSavingToBook(true);
    setLinkError('');
    try {
      const { error: updErr } = await supabase
        .from('appointments')
        .update({ customer_id: customer.id, updated_at: new Date().toISOString() })
        .eq('id', appointment.id);
      if (updErr) throw updErr;
      setLinkedCustomerId(customer.id);
      setShowLinkSearch(false);
      onCustomerLinked?.(customer.id);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link customer.');
    } finally {
      setSavingToBook(false);
    }
  }

  // Parse company snapshot for display
  const snapshot = appointment.company_snapshot;
  const companyName = company?.name || snapshot?.name || 'No company assigned';
  const companyAddress = [
    company?.address_line1 || snapshot?.address_line1,
    company?.address_line2 || snapshot?.address_line2,
  ].filter(Boolean).join(' ');
  const companyCityState = [
    company?.city || snapshot?.city,
    company?.state || snapshot?.state,
    company?.zip_code || snapshot?.zip_code,
  ].filter(Boolean).join(', ');
  const companyPhone = company?.phone || snapshot?.phone;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            {profile && (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: profile.calendar_color }}
              >
                {getInitials(profile.full_name)}
              </div>
            )}
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{appointment.client_name}</h2>
              <div className="text-sm text-slate-500">{appointment.appointment_type}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Status badge */}
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[appointment.status]}`}>
            {appointment.status}
          </div>

          {/* Date and time */}
          <div className="flex items-center gap-2 text-slate-700">
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-sm">
              {formatDateLong(new Date(appointment.appointment_date + 'T00:00'))} ·{' '}
              {formatTime12(appointment.start_time)} – {formatTime12(appointment.end_time)}
            </span>
          </div>

          {/* Duration */}
          <div className="text-sm text-slate-500">
            Duration: {appointment.duration_minutes} minutes
          </div>

          {/* Assigned coworker */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Assigned Coworker</div>
            <div className="text-sm text-slate-700">{profile?.full_name || 'Unknown'}</div>
          </div>

          {/* Client contact */}
          <div className="border-t border-slate-100 pt-3 space-y-1.5">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Client Contact</div>
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Phone className="w-4 h-4 text-slate-400" />
              {appointment.client_phone}
            </div>
            {appointment.client_email && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Mail className="w-4 h-4 text-slate-400" />
                {appointment.client_email}
              </div>
            )}
          </div>

          {/* Company info */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Associated Company</div>
            <div className="flex items-start gap-2 text-sm text-slate-700">
              <Building className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{companyName}</div>
                {companyAddress && (
                  <div className="flex items-start gap-1 text-slate-600 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <div>{companyAddress}</div>
                      <div>{companyCityState}</div>
                    </div>
                  </div>
                )}
                {companyPhone && (
                  <div className="flex items-center gap-1 text-slate-600 mt-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {companyPhone}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          {appointment.notes && (
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Notes</div>
              <div className="text-sm text-slate-600 whitespace-pre-wrap">{appointment.notes}</div>
            </div>
          )}

          {/* Customer book status */}
          {linkedCustomerId ? (
            <div className="border-t border-slate-100 pt-3">
              <div className="inline-flex items-center gap-1.5 text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5 font-medium">
                <BookUser className="w-4 h-4" />
                Saved in Customer Book
              </div>
            </div>
          ) : (
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleSaveToBook}
                  disabled={savingToBook}
                  className="flex items-center gap-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 font-medium py-2 px-3 rounded-lg transition text-sm disabled:opacity-50"
                >
                  {savingToBook ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookUser className="w-4 h-4" />}
                  Save to Customer Book
                </button>
                <button
                  onClick={() => setShowLinkSearch(!showLinkSearch)}
                  disabled={savingToBook}
                  className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium py-2 px-3 rounded-lg transition text-sm disabled:opacity-50"
                >
                  <Link2 className="w-4 h-4" />
                  Link Existing
                </button>
              </div>
              {linkError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{linkError}</div>
              )}
              {showLinkSearch && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={linkQuery}
                      onChange={(e) => {
                        setLinkQuery(e.target.value);
                        if (e.target.value.trim().length >= 1) {
                          setLinkLoading(true);
                          searchCustomers(e.target.value).then(r => { setLinkResults(r); setLinkLoading(false); }).catch(() => { setLinkResults([]); setLinkLoading(false); });
                        } else {
                          setLinkResults([]);
                        }
                      }}
                      placeholder="Search customers by name, phone, or email..."
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                    />
                    {linkLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                      </div>
                    )}
                  </div>
                  {linkResults.length > 0 && (
                    <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                      {linkResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => handleLinkExisting(c)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 text-sm"
                        >
                          <div className="font-medium text-slate-700">{c.full_name}</div>
                          <div className="text-xs text-slate-400">
                            {c.phone && c.phone} {c.phone && c.email && '· '} {c.email && c.email}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reminder status feedback */}
        {reminderStatus === 'sent' && (
          <div className="mx-6 mb-2 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Reminder email sent to {appointment.client_email}
          </div>
        )}
        {reminderStatus === 'error' && (
          <div className="mx-6 mb-2 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {reminderError || 'Failed to send reminder.'}
          </div>
        )}
        {smsStatus === 'sent' && (
          <div className="mx-6 mb-2 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Text notification sent to {appointment.client_phone}
          </div>
        )}
        {smsStatus === 'error' && (
          <div className="mx-6 mb-2 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {smsError || 'Failed to send text notification.'}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
          <button
            onClick={handleSendReminder}
            disabled={reminderStatus === 'sending'}
            className="flex items-center justify-center gap-2 bg-teal-50 hover:bg-teal-100 text-teal-700 font-medium py-2.5 px-4 rounded-lg transition text-sm disabled:opacity-50"
            title={appointment.client_email ? `Send reminder email to ${appointment.client_email}` : 'No client email on file'}
          >
            <Send className="w-4 h-4" />
            {reminderStatus === 'sending' ? 'Sending...' : 'Reminder'}
          </button>
          <button
            onClick={handleSendSMS}
            disabled={smsStatus === 'sending' || appointment.send_whatsapp === false || !appointment.client_phone || isDummyPhoneNumber(appointment.client_phone)}
            className="flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium py-2.5 px-4 rounded-lg transition text-sm disabled:opacity-50"
            title={appointment.send_whatsapp === false ? 'WhatsApp is disabled for this customer' : !appointment.client_phone ? 'No client phone on file' : isDummyPhoneNumber(appointment.client_phone) ? 'Phone number is not a valid mobile number' : `Send text to ${appointment.client_phone}`}
          >
            <MessageSquare className="w-4 h-4" />
            {smsStatus === 'sending' ? 'Sending...' : 'Text'}
          </button>
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg transition text-sm"
          >
            <Edit2 className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={onDelete}
            className="flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2.5 font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
