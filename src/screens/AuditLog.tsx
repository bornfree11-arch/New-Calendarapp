import { useState, useEffect, useMemo } from 'react';
import {
  getAuditLogs,
  getCompanies,
  getProfiles,
  formatAppointmentStatusLabel,
  formatSupabaseError,
  AuditEntry,
} from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { formatDateMMDDYYYY } from '@/lib/dateUtils';
import { X, ScrollText, Loader2 } from 'lucide-react';

interface AuditLogProps {
  onClose: () => void;
}

const IGNORED_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'company_snapshot',
  'time_range',
]);

const FK_UNASSIGNED_FIELDS = new Set([
  'default_company_id',
  'company_id',
  'assigned_user_id',
  'assigned_to',
  'user_id',
  'customer_id',
  'last_modified_by',
  'created_by',
]);

const FIELD_LABELS: Record<string, string> = {
  default_company_id: 'Primary Company',
  company_id: 'Company',
  assigned_user_id: 'Assigned Employee',
  assigned_to: 'Assigned Employee',
  last_modified_by: 'Modified By',
  created_by: 'Created By',
  customer_id: 'Customer',
  user_id: 'User',
  full_name: 'Name',
  title: 'Title',
  client_name: 'Customer Name',
  customer_name: 'Customer Name',
  client_phone: 'Customer Phone',
  customer_phone: 'Customer Phone',
  client_email: 'Customer Email',
  customer_email: 'Customer Email',
  appointment_date: 'Date',
  start_time: 'Start Time',
  end_time: 'End Time',
  duration_minutes: 'Duration',
  appointment_type: 'Category',
  category: 'Category',
  action_category: 'Category',
  status: 'Status',
  notes: 'Notes',
  send_whatsapp: 'WhatsApp',
  is_global: 'Global Customer',
  is_active: 'Active',
  role: 'Role',
  phone: 'Phone',
  email: 'Email',
  name: 'Name',
  calendar_color: 'Color',
  date_of_birth: 'Birth Date',
  due_date: 'Due Date',
  completed_at: 'Completed At',
  address_line1: 'Address',
  address_line2: 'Address 2',
  city: 'City',
  state: 'State',
  zip_code: 'ZIP',
  tags: 'Tags',
  appointment_type_mapping: 'Appointment Type',
};

function isEmptyValue(val: unknown): boolean {
  if (val === null || val === undefined || val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

function toHumanFieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getPrevSnapshot(entry: AuditEntry): Record<string, unknown> | null {
  return entry.previous_values ?? entry.old_data ?? null;
}

function getNextSnapshot(entry: AuditEntry): Record<string, unknown> | null {
  return entry.new_values ?? entry.new_data ?? null;
}

function formatTime12Padded(timeStr: string): string {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return timeStr;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${period}`;
}

function formatDateTimeMMDDYYYYPadded(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const datePart = formatDateMMDDYYYY(parsed);
  const hours = parsed.getHours();
  const minutes = parsed.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${datePart} ${hour12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function parseJsonRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function AuditLog({ onClose }: AuditLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [companyMap, setCompanyMap] = useState<Map<string, string>>(new Map());
  const [profileMap, setProfileMap] = useState<Map<string, string>>(new Map());
  const [customerMap, setCustomerMap] = useState<Map<string, string>>(new Map());
  const [expandedJsonIds, setExpandedJsonIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [logs, companies, profiles, custRes] = await Promise.all([
          getAuditLogs(200),
          getCompanies(),
          getProfiles(),
          supabase.from('customers').select('id, full_name').limit(2000),
        ]);
        setEntries(logs);
        setCompanyMap(new Map(companies.map((c) => [c.id, c.name])));
        setProfileMap(new Map(profiles.map((p) => [p.id, p.full_name])));
        const custRows = (custRes.data || []) as { id: string; full_name: string }[];
        setCustomerMap(new Map(custRows.map((c) => [c.id, c.full_name])));
      } catch (err) {
        setError(formatSupabaseError(err, 'Failed to load audit logs.'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleRawJson(id: string) {
    setExpandedJsonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function formatDate(ts: string) {
    return formatDateTimeMMDDYYYYPadded(ts);
  }

  const formatFieldValue = useMemo(() => {
    return (key: string, val: unknown, recordContext?: Record<string, unknown> | null): string => {
      if (isEmptyValue(val)) {
        return FK_UNASSIGNED_FIELDS.has(key) ? 'Unassigned' : 'None';
      }
      if (key === 'default_company_id' || key === 'company_id') {
        const id = String(val);
        return companyMap.get(id) || id;
      }
      if (
        key === 'assigned_user_id' ||
        key === 'assigned_to' ||
        key === 'user_id' ||
        key === 'last_modified_by' ||
        key === 'created_by'
      ) {
        const id = String(val);
        return profileMap.get(id) || id;
      }
      if (key === 'customer_id') {
        const id = String(val);
        return customerMap.get(id) || id;
      }
      if (key === 'status') {
        return formatAppointmentStatusLabel(String(val));
      }
      if (typeof val === 'boolean') {
        return val ? 'Yes' : 'No';
      }
      if (Array.isArray(val)) {
        return val.length > 0 ? val.join(', ') : 'None';
      }
      if ((key === 'appointment_date' || key === 'date_of_birth' || key === 'due_date') && typeof val === 'string') {
        return formatDateMMDDYYYY(val);
      }
      if ((key === 'start_time' || key === 'end_time') && typeof val === 'string') {
        const trimmed = val.trim();
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
          const timePart = formatTime12Padded(trimmed);
          const dateVal = recordContext?.['appointment_date'];
          if (typeof dateVal === 'string' && dateVal.trim()) {
            return `${formatDateMMDDYYYY(dateVal)} ${timePart}`;
          }
          return timePart;
        }
        return formatDateTimeMMDDYYYYPadded(trimmed);
      }
      if (key === 'completed_at' && typeof val === 'string') {
        return formatDateTimeMMDDYYYYPadded(val);
      }
      if (key === 'duration_minutes' && typeof val === 'number') {
        return `${val} min`;
      }
      if (typeof val === 'object') {
        return JSON.stringify(val);
      }
      const str = String(val).trim();
      return str.length > 120 ? `${str.slice(0, 117)}...` : str;
    };
  }, [companyMap, profileMap, customerMap]);

  const getDiffParts = useMemo(() => {
    return (entry: AuditEntry): string[] => {
      const prev = getPrevSnapshot(entry);
      const next = getNextSnapshot(entry);
      if (!prev || !next) return [];

      const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      const parts: string[] = [];

      for (const key of allKeys) {
        if (IGNORED_FIELDS.has(key)) continue;
        const beforeVal = prev[key];
        const afterVal = next[key];

        if (isEmptyValue(beforeVal) && isEmptyValue(afterVal)) continue;
        if (JSON.stringify(beforeVal ?? null) === JSON.stringify(afterVal ?? null)) continue;

        const label = toHumanFieldLabel(key);
        const fromText = formatFieldValue(key, beforeVal, prev);
        const toText = formatFieldValue(key, afterVal, next);
        if (fromText === toText) continue;

        parts.push(`${label}: ${fromText} → ${toText}`);
      }

      return parts;
    };
  }, [formatFieldValue]);

  const getFallbackChangeText = useMemo(() => {
    return (entry: AuditEntry): string | null => {
      const parts: string[] = [];

      const extractFromObject = (obj: Record<string, unknown>, context?: Record<string, unknown> | null) => {
        for (const [key, val] of Object.entries(obj)) {
          if (IGNORED_FIELDS.has(key)) continue;
          if (key === 'changes' && val && typeof val === 'object' && !Array.isArray(val)) {
            extractFromObject(val as Record<string, unknown>, context);
            continue;
          }
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            const rec = val as Record<string, unknown>;
            if ('old' in rec || 'new' in rec || 'from' in rec || 'to' in rec) {
              const fromVal = rec.old ?? rec.from;
              const toVal = rec.new ?? rec.to;
              const label = toHumanFieldLabel(key);
              const fromText = formatFieldValue(key, fromVal, context);
              const toText = formatFieldValue(key, toVal, context);
              if (fromText !== toText) {
                parts.push(`${label}: ${fromText} → ${toText}`);
              }
              continue;
            }
          }
          if (isEmptyValue(val)) continue;
          parts.push(`${toHumanFieldLabel(key)}: ${formatFieldValue(key, val, context)}`);
        }
      };

      const detailsObj = parseJsonRecord(entry.details);
      if (detailsObj) {
        extractFromObject(detailsObj, getNextSnapshot(entry) ?? getPrevSnapshot(entry));
      } else if (typeof entry.details === 'string' && entry.details.trim()) {
        parts.push(entry.details.trim());
      }

      const metaObj = parseJsonRecord(entry.metadata);
      if (metaObj) {
        extractFromObject(metaObj, getNextSnapshot(entry) ?? getPrevSnapshot(entry));
      } else if (typeof entry.metadata === 'string' && entry.metadata.trim()) {
        parts.push(entry.metadata.trim());
      }

      if (parts.length > 0) return parts.join(' · ');

      const next = getNextSnapshot(entry);
      const prev = getPrevSnapshot(entry);
      const snapshot = next ?? prev;
      if (snapshot) {
        const snapshotParts: string[] = [];
        for (const [key, val] of Object.entries(snapshot)) {
          if (IGNORED_FIELDS.has(key) || isEmptyValue(val)) continue;
          snapshotParts.push(`${toHumanFieldLabel(key)}: ${formatFieldValue(key, val, snapshot)}`);
        }
        if (snapshotParts.length > 0) {
          return snapshotParts.join(' · ');
        }
      }

      const isUpdate = entry.action_type.toLowerCase().includes('update');
      if (isUpdate) {
        return entry.change_summary?.trim() || 'Updated appointment record';
      }

      return null;
    };
  }, [formatFieldValue]);

  // Hide duplicate trigger rows (e.g., legacy/7-field appointment.update) when a matching UPDATE row exists at the same timestamp
  const visibleEntries = useMemo(() => {
    const richUpdateTimestampsByRecord = new Map<string, number[]>();
    const richInsertTimestampsByRecord = new Map<string, number[]>();
    const richDeleteTimestampsByRecord = new Map<string, number[]>();

    for (const entry of entries) {
      if (!entry.record_id) continue;
      const ts = Date.parse(entry.created_at) || 0;
      const act = entry.action_type.toUpperCase();
      if (act === 'UPDATE') {
        const list = richUpdateTimestampsByRecord.get(entry.record_id) || [];
        list.push(ts);
        richUpdateTimestampsByRecord.set(entry.record_id, list);
      } else if (act === 'INSERT') {
        const list = richInsertTimestampsByRecord.get(entry.record_id) || [];
        list.push(ts);
        richInsertTimestampsByRecord.set(entry.record_id, list);
      } else if (act === 'DELETE') {
        const list = richDeleteTimestampsByRecord.get(entry.record_id) || [];
        list.push(ts);
        richDeleteTimestampsByRecord.set(entry.record_id, list);
      }
    }

    const hasNearby = (map: Map<string, number[]>, recordId: string | null, ts: number) => {
      if (!recordId) return false;
      const timestamps = map.get(recordId);
      if (!timestamps) return false;
      return timestamps.some((otherTs) => Math.abs(otherTs - ts) <= 10000);
    };

    return entries.filter((entry) => {
      const ts = Date.parse(entry.created_at) || 0;
      const actionLower = entry.action_type.toLowerCase();

      if (actionLower === 'appointment.update') {
        if (hasNearby(richUpdateTimestampsByRecord, entry.record_id, ts)) {
          return false;
        }
      }
      if (actionLower === 'appointment.create') {
        if (hasNearby(richInsertTimestampsByRecord, entry.record_id, ts)) {
          return false;
        }
      }
      if (actionLower === 'appointment.delete') {
        if (hasNearby(richDeleteTimestampsByRecord, entry.record_id, ts)) {
          return false;
        }
      }
      return true;
    });
  }, [entries]);

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
          ) : visibleEntries.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No audit entries yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleEntries.map((entry) => {
                const prevSnap = getPrevSnapshot(entry);
                const nextSnap = getNextSnapshot(entry);
                const diffParts = getDiffParts(entry);
                const detailText =
                  diffParts.length > 0 ? diffParts.join(' · ') : getFallbackChangeText(entry);
                const hasRawJson = Boolean(
                  (prevSnap && Object.keys(prevSnap).length > 0) ||
                  (nextSnap && Object.keys(nextSnap).length > 0)
                );
                const isRawExpanded = expandedJsonIds.has(entry.id);

                return (
                  <div key={entry.id} className="py-2.5 px-2 hover:bg-slate-50/70 rounded-lg transition">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[11px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded shrink-0">
                          {entry.action_type}
                        </span>
                        <span className="text-sm font-medium text-slate-700 truncate">
                          {entry.change_summary}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {hasRawJson && (
                          <button
                            type="button"
                            onClick={() => toggleRawJson(entry.id)}
                            className="text-xs text-teal-600 hover:text-teal-800 hover:underline font-medium"
                          >
                            {isRawExpanded ? 'Hide Raw JSON' : 'Show Raw JSON'}
                          </button>
                        )}
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {formatDate(entry.created_at)}
                        </span>
                      </div>
                    </div>

                    {detailText && (
                      <div className="mt-1 pl-1 text-xs text-slate-600 break-words leading-relaxed">
                        {detailText}
                      </div>
                    )}

                    {isRawExpanded && hasRawJson && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {prevSnap && Object.keys(prevSnap).length > 0 && (
                          <div className="bg-red-50 rounded p-2">
                            <div className="font-medium text-red-700 mb-1">Before:</div>
                            <pre className="text-red-600 whitespace-pre-wrap break-words">
                              {JSON.stringify(prevSnap, null, 1)}
                            </pre>
                          </div>
                        )}
                        {nextSnap && Object.keys(nextSnap).length > 0 && (
                          <div className="bg-green-50 rounded p-2">
                            <div className="font-medium text-green-700 mb-1">After:</div>
                            <pre className="text-green-600 whitespace-pre-wrap break-words">
                              {JSON.stringify(nextSnap, null, 1)}
                            </pre>
                          </div>
                        )}
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
