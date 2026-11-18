import { useState, useEffect, useMemo } from 'react';
import { getCustomerAppointments, getCustomerSentEmails } from '@/lib/store';
import { Appointment, Company, Customer, Profile, SentEmailRecord, AppointmentStatus } from '@/types';
import { formatDateMMDDYYYY, formatDateTimeMMDDYYYY, formatTime12 } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabase';
import {
  X,
  History,
  Calendar,
  Mail,
  MessageCircle,
  Loader2,
  Building2,
  User,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface CustomerHistoryModalProps {
  customer: Customer;
  companies: Company[];
  profiles: Profile[];
  onClose: () => void;
  onOpenAppointment?: (appointment: Appointment) => void;
  dataVersion?: number;
}

type HistoryFilter = 'all' | 'appointments' | 'emails' | 'whatsapp';
type SourceBadge = 'Calendar' | 'Payroll' | 'Categorizer';

interface TimelineItem {
  id: string;
  kind: 'appointment' | 'email' | 'whatsapp';
  source: SourceBadge;
  timestamp: number;
  dateLabel: string;
  appointment?: Appointment;
  sentRecord?: SentEmailRecord;
}

const SOURCE_BADGE_STYLES: Record<SourceBadge, string> = {
  Calendar: 'bg-teal-50 text-teal-700 border-teal-200',
  Payroll: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Categorizer: 'bg-violet-50 text-violet-700 border-violet-200',
};

const APPT_STATUS_STYLES: Record<AppointmentStatus, string> = {
  Scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-red-50 text-red-700 border-red-200',
  'No-show': 'bg-amber-50 text-amber-700 border-amber-200',
  Rescheduled: 'bg-purple-50 text-purple-700 border-purple-200',
};

function resolveMessageChannel(row: SentEmailRecord): 'email' | 'whatsapp' {
  const ch = (row.channel || '').trim().toLowerCase();
  if (ch === 'whatsapp' || ch === 'sms') return 'whatsapp';
  if (ch === 'email') return 'email';
  const typeOrSubj = `${row.email_type || ''} ${row.subject || ''}`.toLowerCase();
  if (typeOrSubj.includes('whatsapp')) return 'whatsapp';
  if (row.recipient_phone && !row.recipient_email) return 'whatsapp';
  return 'email';
}

function resolveMessageSource(row: SentEmailRecord): SourceBadge {
  const src = (row.source_app || '').trim().toLowerCase();
  if (src.includes('categoriz')) return 'Categorizer';
  if (src.includes('payroll')) return 'Payroll';
  if (src.includes('calendar')) return 'Calendar';

  const hint = `${row.email_type || ''} ${row.subject || ''}`.toLowerCase();
  if (row.payroll_run_id || /payroll|941|940|rt-6|w-2|withholding|tax deposit|compliance/.test(hint)) {
    return 'Payroll';
  }
  if (/categoriz|bank statement|uncategorized|plaid|quickbooks/.test(hint)) {
    return 'Categorizer';
  }
  if (row.appointment_id || /appointment|reminder|reschedul/.test(hint)) {
    return 'Calendar';
  }
  return row.company_id ? 'Payroll' : 'Calendar';
}

export function CustomerHistoryModal({
  customer,
  companies,
  profiles,
  onClose,
  onOpenAppointment,
  dataVersion = 0,
}: CustomerHistoryModalProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [sentEmails, setSentEmails] = useState<SentEmailRecord[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name])), [profiles]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [appts, msgs] = await Promise.all([
          getCustomerAppointments(customer.id),
          getCustomerSentEmails(customer),
        ]);
        if (!active) return;
        setAppointments(appts);
        setSentEmails(msgs);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load customer history.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [customer, dataVersion]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];

    for (const appt of appointments) {
      const dateStr = appt.appointment_date || '';
      const timePart = appt.start_time || '00:00:00';
      const ts = Date.parse(`${dateStr}T${timePart}`) || Date.parse(appt.created_at) || 0;
      const formattedDate = formatDateMMDDYYYY(dateStr || appt.created_at);
      const timeRange = appt.start_time
        ? `${formatTime12(appt.start_time)}${appt.end_time ? ` – ${formatTime12(appt.end_time)}` : ''}`
        : '';

      items.push({
        id: `appt-${appt.id}`,
        kind: 'appointment',
        source: 'Calendar',
        timestamp: ts,
        dateLabel: timeRange ? `${formattedDate} · ${timeRange}` : formattedDate,
        appointment: appt,
      });
    }

    for (const row of sentEmails) {
      const channel = resolveMessageChannel(row);
      const source = resolveMessageSource(row);
      const rawTs = row.sent_at || row.created_at || '';
      const ts = Date.parse(rawTs) || 0;
      items.push({
        id: `msg-${row.id}`,
        kind: channel,
        source,
        timestamp: ts,
        dateLabel: rawTs ? formatDateTimeMMDDYYYY(rawTs) : '—',
        sentRecord: row,
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  }, [appointments, sentEmails]);

  const counts = useMemo(() => {
    return {
      all: timeline.length,
      appointments: timeline.filter((i) => i.kind === 'appointment').length,
      emails: timeline.filter((i) => i.kind === 'email').length,
      whatsapp: timeline.filter((i) => i.kind === 'whatsapp').length,
    };
  }, [timeline]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return timeline;
    if (filter === 'appointments') return timeline.filter((i) => i.kind === 'appointment');
    if (filter === 'emails') return timeline.filter((i) => i.kind === 'email');
    return timeline.filter((i) => i.kind === 'whatsapp');
  }, [timeline, filter]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-4 max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-800 truncate">
                Customer History — {customer.full_name}
              </h2>
              <div className="text-xs text-slate-500 truncate">
                {[customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact info on file'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition shrink-0">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 bg-slate-50/60">
          {(
            [
              { key: 'all', label: 'All', count: counts.all },
              { key: 'appointments', label: 'Appointments', count: counts.appointments },
              { key: 'emails', label: 'Emails', count: counts.emails },
              { key: 'whatsapp', label: 'WhatsApp', count: counts.whatsapp },
            ] as const
          ).map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={() => setFilter(pill.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border flex items-center gap-1.5 ${
                filter === pill.key
                  ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{pill.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded text-[11px] font-semibold ${
                  filter === pill.key ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {pill.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-slate-400 flex items-center justify-center gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading customer timeline...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
              {filter === 'all'
                ? 'No appointments, emails, or WhatsApp messages recorded for this customer yet.'
                : `No ${filter} found for this customer.`}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => {
                if (item.kind === 'appointment' && item.appointment) {
                  const appt = item.appointment;
                  const compName =
                    (appt.company_id && companyMap.get(appt.company_id)) ||
                    appt.company_snapshot?.name ||
                    'No company';
                  const assignedName = profileMap.get(appt.assigned_to) || 'Unassigned';
                  const statusStyle =
                    APPT_STATUS_STYLES[appt.status] || 'bg-slate-100 text-slate-600 border-slate-200';

                  return (
                    <div
                      key={item.id}
                      onClick={async () => {
                        let target = appt;
                        if (!target.client_name || !target.appointment_date) {
                          try {
                            const { data } = await supabase
                              .from('appointments')
                              .select('*')
                              .eq('id', appt.id)
                              .single();
                            if (data) target = data;
                          } catch {
                            // fallback
                          }
                        }
                        onOpenAppointment?.(target);
                      }}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition group"
                    >
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                            <Calendar className="w-4 h-4" />
                          </span>
                          <span className="text-sm font-semibold text-slate-800">
                            {appt.appointment_type} Appointment
                          </span>
                          <span
                            className={`text-[11px] font-medium px-2 py-0.5 rounded border ${SOURCE_BADGE_STYLES[item.source]}`}
                          >
                            {item.source}
                          </span>
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${statusStyle}`}>
                            {appt.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {item.dateLabel}
                          </span>
                          <span className="text-xs font-medium text-teal-600 group-hover:underline">
                            Open Appointment →
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 pl-9 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {compName}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          {assignedName}
                        </span>
                        <span>Duration: {appt.duration_minutes} min</span>
                      </div>

                      {appt.notes && (
                        <div className="mt-2 pl-9 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap">
                          {appt.notes}
                        </div>
                      )}
                    </div>
                  );
                }

                const msg = item.sentRecord!;
                const isWhatsapp = item.kind === 'whatsapp';
                const rawBody = (msg.body || msg.message || '').toString().trim();
                const isExpanded = expandedIds.has(item.id);
                const msgStatus = (msg.status || 'sent').toLowerCase();
                const statusBadge =
                  msgStatus === 'failed' || msgStatus === 'error'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                const recipientDisplay = isWhatsapp
                  ? msg.recipient_phone || msg.recipient_email || customer.phone
                  : msg.recipient_email || customer.email;

                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 hover:border-slate-300 transition"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isWhatsapp
                              ? 'bg-green-50 text-green-600'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isWhatsapp ? (
                            <MessageCircle className="w-4 h-4" />
                          ) : (
                            <Mail className="w-4 h-4" />
                          )}
                        </span>
                        <span className="text-sm font-semibold text-slate-800 truncate">
                          {msg.subject || (isWhatsapp ? 'WhatsApp Message' : 'Email Message')}
                        </span>
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded border ${SOURCE_BADGE_STYLES[item.source]}`}
                        >
                          {item.source}
                        </span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded border capitalize ${statusBadge}`}>
                          {msg.status || 'sent'}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {item.dateLabel}
                      </span>
                    </div>

                    <div className="mt-1.5 pl-9 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {isWhatsapp ? 'WhatsApp to' : 'To'}: {recipientDisplay || '—'}
                      </span>
                      {rawBody && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          className="text-teal-600 hover:text-teal-800 font-medium inline-flex items-center gap-1"
                        >
                          {isExpanded ? (
                            <>
                              Hide message <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              View message <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {msg.error_message && (
                      <div className="mt-2 pl-9 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">
                        Error: {msg.error_message}
                      </div>
                    )}

                    {rawBody && isExpanded && (
                      <div className="mt-2 pl-9">
                        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
                          {rawBody}
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
