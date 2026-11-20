import { supabase } from '@/lib/supabase';
import { Appointment, AppointmentStatus, Profile, Company, AppointmentTypeMapping, CompanySnapshot, Task, Subtask, TaskStatusHistoryEntry, TaskActionCategory, TaskStatus, ReminderAttempt, DeliveryAlert, DeliveryFailureWithDetails, FocusSession, FocusSessionTask, Customer, CustomerRole, CUSTOMER_ROLES, SentEmailRecord } from '@/types';
import { isDummyPhoneNumber, formatPhoneNumber, isValidEmail } from '@/lib/dateUtils';

export interface AuditEntry {
  id: string;
  user_id: string | null;
  action_type: string;
  table_name: string;
  record_id: string | null;
  change_summary: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  details?: Record<string, unknown> | string | null;
  metadata?: Record<string, unknown> | string | null;
  created_at: string;
}

export function formatSupabaseError(err: unknown, fallback = 'An unexpected error occurred.'): string {
  if (!err) return fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message.trim()) {
      parts.push(e.message.trim());
    }
    if (typeof e.details === 'string' && e.details.trim() && e.details.trim() !== e.message) {
      parts.push(e.details.trim());
    }
    if (typeof e.hint === 'string' && e.hint.trim()) {
      parts.push(`Hint: ${e.hint.trim()}`);
    }
    if (parts.length > 0) return parts.join(' — ');
  }
  if (typeof err === 'string' && err.trim()) return err.trim();
  return fallback;
}

export function normalizeAppointmentStatus(status?: string | null): string {
  const s = (status || '').trim().toLowerCase();
  if (s === 'canceled' || s === 'cancelled') return 'cancelled';
  if (s === 'pending' || s === 'scheduled' || s === 'active' || s === 'confirmed') return 'scheduled';
  if (s === 'completed') return 'completed';
  if (s === 'rescheduled') return 'rescheduled';
  if (s === 'no-show' || s === 'noshow' || s === 'no_show') return 'no-show';
  return s;
}

export function formatAppointmentStatusLabel(status?: string | null): string {
  const raw = (status || '').trim();
  const s = raw.toLowerCase();
  if (s === 'canceled' || s === 'cancelled') return 'Cancelled';
  if (s === 'pending') return 'Pending';
  if (s === 'scheduled') return 'Scheduled';
  if (s === 'completed') return 'Completed';
  if (s === 'rescheduled') return 'Rescheduled';
  if (s === 'no-show' || s === 'noshow' || s === 'no_show') return 'No-show';
  return raw || 'Unknown';
}

function buildStatusCandidates(targetStatus: AppointmentStatus, existingStatus?: string | null): string[] {
  const trimmedExisting = (existingStatus || '').trim();
  const preferLower = trimmedExisting.length > 0 && trimmedExisting === trimmedExisting.toLowerCase();
  const lowerTarget = targetStatus.toLowerCase();

  const candidates: string[] = [];
  const add = (val: string) => {
    if (!candidates.includes(val)) candidates.push(val);
  };

  if (lowerTarget === 'cancelled' || lowerTarget === 'canceled') {
    if (preferLower) {
      add('cancelled');
      add('canceled');
      add('Cancelled');
      add('Canceled');
    } else {
      add('Cancelled');
      add('Canceled');
      add('cancelled');
      add('canceled');
    }
  } else if (lowerTarget === 'scheduled' || lowerTarget === 'pending') {
    if (preferLower) {
      if (trimmedExisting === 'pending') add('pending');
      add('scheduled');
      add('pending');
      add('Scheduled');
    } else {
      add('Scheduled');
      add('scheduled');
      add('pending');
    }
  } else {
    if (preferLower) {
      add(lowerTarget);
      add(targetStatus);
    } else {
      add(targetStatus);
      add(lowerTarget);
    }
  }
  return candidates;
}

function isStatusCheckConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const details = typeof e.details === 'string' ? e.details.toLowerCase() : '';
  return (
    code === '23514' ||
    msg.includes('appointments_status_check') ||
    details.includes('appointments_status_check') ||
    (msg.includes('check constraint') && msg.includes('status'))
  );
}

export interface ReminderRow {
  id: string;
  appointment_id: string;
  recipient_type: string;
  recipient_address: string;
  scheduled_send_at: string;
  attempted_at: string | null;
  status: string;
  error_details: string;
  retry_count: number;
  created_at: string;
}

async function logAudit(action: string, table: string, summary: string, prev: Record<string, unknown> | null, next: Record<string, unknown> | null, userId: string | null): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action_type: action,
      table_name: table,
      record_id: (next?.['id'] as string) || (prev?.['id'] as string) || null,
      change_summary: summary,
      previous_values: prev,
      new_values: next,
    });
  } catch {
    // Best-effort logging — don't fail the mutation
  }
}

// --- Profiles API ---

export async function getProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return ((data || []) as Profile[]).map((p) => ({
    ...p,
    default_company_id: p.default_company_id ?? null,
    notify_day_of_whatsapp: Boolean(p.notify_day_of_whatsapp),
    notify_20min_before: Boolean(p.notify_20min_before),
  }));
}

export async function saveProfile(profile: Partial<Profile> & { id?: string }, actorId: string | null): Promise<Profile> {
  const normalizedProfile: Partial<Profile> & { id?: string } = { ...profile };
  if ('default_company_id' in normalizedProfile) {
    normalizedProfile.default_company_id = normalizedProfile.default_company_id || null;
  }
  if ('notify_day_of_whatsapp' in normalizedProfile) {
    normalizedProfile.notify_day_of_whatsapp = Boolean(normalizedProfile.notify_day_of_whatsapp);
  }
  if ('notify_20min_before' in normalizedProfile) {
    normalizedProfile.notify_20min_before = Boolean(normalizedProfile.notify_20min_before);
  }

  if (normalizedProfile.id) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', normalizedProfile.id)
      .maybeSingle<Profile>();

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...normalizedProfile, updated_at: new Date().toISOString() })
      .eq('id', normalizedProfile.id)
      .select('*')
      .single<Profile>();
    if (error) throw error;
    const result: Profile = {
      ...data,
      default_company_id: data.default_company_id ?? null,
      notify_day_of_whatsapp: Boolean(data.notify_day_of_whatsapp),
      notify_20min_before: Boolean(data.notify_20min_before),
    };
    if (existing) {
      await logAudit('UPDATE', 'profiles', `Updated user "${result.full_name}"`, existing as unknown as Record<string, unknown>, result as unknown as Record<string, unknown>, actorId);
    }
    return result;
  }

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      ...normalizedProfile,
      default_company_id: normalizedProfile.default_company_id ?? null,
      notify_day_of_whatsapp: normalizedProfile.notify_day_of_whatsapp ?? false,
      notify_20min_before: normalizedProfile.notify_20min_before ?? false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single<Profile>();
  if (error) throw error;
  const result: Profile = {
    ...data,
    default_company_id: data.default_company_id ?? null,
    notify_day_of_whatsapp: Boolean(data.notify_day_of_whatsapp),
    notify_20min_before: Boolean(data.notify_20min_before),
  };
  await logAudit('INSERT', 'profiles', `Created user "${result.full_name}"`, null, result as unknown as Record<string, unknown>, actorId);
  return result;
}

export async function deleteProfile(id: string, actorId: string | null): Promise<void> {
  const { data: deleted } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle<Profile>();

  const { error } = await supabase.from('profiles').delete().eq('id', id);
  if (error) throw error;
  if (deleted) {
    await logAudit('DELETE', 'profiles', `Deleted user "${deleted.full_name}"`, deleted as unknown as Record<string, unknown>, null, actorId);
  }
}

// --- Appointments API ---

export async function getAppointments(): Promise<Appointment[]> {
  const { data, error } = await supabase.from('appointments').select('*');
  if (error) throw error;
  return (data || []) as Appointment[];
}

export async function getAllAppointments(): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []) as Appointment[];
}

export async function getCustomerAppointments(customerId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('customer_id', customerId)
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false });
  if (error) throw error;
  return (data || []) as Appointment[];
}

export async function getAppointmentsByDateRange(startDate: string, endDate: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .gte('appointment_date', startDate)
    .lte('appointment_date', endDate)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []) as Appointment[];
}

export async function getAppointmentsByDate(date: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('appointment_date', date)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []) as Appointment[];
}

export async function searchAppointments(query: string): Promise<Appointment[]> {
  const q = `%${query}%`;
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .or(`client_name.ilike.${q},client_phone.ilike.${q}`)
    .order('appointment_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as Appointment[];
}

export async function saveAppointment(appt: Partial<Appointment> & { id?: string }, actorId: string | null): Promise<Appointment> {
  const { company_snapshot, ...rest } = appt;
  const payload: Record<string, unknown> = { ...rest };
  if (company_snapshot !== undefined) {
    payload.company_snapshot = company_snapshot;
  }

  if (appt.id) {
    const { data: existing } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', appt.id)
      .maybeSingle<Appointment>();

    const { data, error } = await supabase
      .from('appointments')
      .update({ ...payload, updated_at: new Date().toISOString(), last_modified_by: actorId })
      .eq('id', appt.id)
      .select('*')
      .maybeSingle<Appointment>();
    if (error) {
      throw new Error(formatSupabaseError(error, 'Failed to save appointment.'));
    }
    if (!data) {
      throw new Error('Update blocked by database permissions. Only the assigned coworker or an administrator can modify this appointment.');
    }
    if (existing) {
      await logAudit('UPDATE', 'appointments', `Updated appointment for "${data.client_name}"`, existing as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, actorId);
    }
    return data;
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert({ ...payload, created_by: actorId, last_modified_by: actorId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('*')
    .single<Appointment>();
  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to create appointment.'));
  }
  await logAudit('INSERT', 'appointments', `Created appointment for "${data.client_name}"`, null, data as unknown as Record<string, unknown>, actorId);
  return data;
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
  actorId: string | null,
): Promise<Appointment> {
  const { data: existing, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .maybeSingle<Appointment>();

  if (fetchError) {
    throw new Error(formatSupabaseError(fetchError, 'Failed to load appointment before updating status.'));
  }

  const candidates = buildStatusCandidates(status, existing?.status);
  let lastError: unknown = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidateStatus = candidates[i];
    const { data, error } = await supabase
      .from('appointments')
      .update({ status: candidateStatus })
      .eq('id', id)
      .select('*')
      .maybeSingle<Appointment>();

    if (error) {
      lastError = error;
      if (isStatusCheckConstraintError(error) && i < candidates.length - 1) {
        continue;
      }
      throw new Error(formatSupabaseError(error, 'Failed to update appointment status.'));
    }

    if (!data) {
      throw new Error('Update blocked by database row-level security. Only the assigned coworker or an administrator can update this appointment.');
    }

    await logAudit(
      'UPDATE',
      'appointments',
      `Updated appointment status for "${data.client_name}" (${existing ? formatAppointmentStatusLabel(existing.status) : 'Unknown'} → ${formatAppointmentStatusLabel(data.status)})`,
      (existing || null) as unknown as Record<string, unknown> | null,
      data as unknown as Record<string, unknown>,
      actorId,
    );
    return data;
  }

  throw new Error(formatSupabaseError(lastError, 'Failed to update appointment status.'));
}

export async function linkAppointmentCustomer(
  appointmentId: string,
  customerId: string,
  actorId: string | null,
): Promise<Appointment> {
  const { data: existing } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .maybeSingle<Appointment>();

  const { data, error } = await supabase
    .from('appointments')
    .update({ customer_id: customerId })
    .eq('id', appointmentId)
    .select('*')
    .maybeSingle<Appointment>();

  if (error) {
    throw new Error(formatSupabaseError(error, 'Failed to link customer to appointment.'));
  }
  if (!data) {
    throw new Error('Update blocked by database permissions. Could not link customer to appointment.');
  }

  if (existing) {
    await logAudit(
      'UPDATE',
      'appointments',
      `Linked customer to appointment for "${data.client_name}"`,
      existing as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
      actorId,
    );
  }
  return data;
}

export async function deleteAppointment(id: string, actorId: string | null): Promise<void> {
  const { data: deleted } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .maybeSingle<Appointment>();

  const { error } = await supabase.from('appointments').delete().eq('id', id);
  if (error) throw error;
  if (deleted) {
    await logAudit('DELETE', 'appointments', `Deleted appointment for "${deleted.client_name}"`, deleted as unknown as Record<string, unknown>, null, actorId);
  }
}

// --- Companies API ---
// --- Companies API ---

export async function getCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('calendar_companies')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as Company[];
}

export async function saveCompany(company: Partial<Company> & { id?: string }, actorId: string | null): Promise<Company> {
  if (company.id) {
    const { data: existing } = await supabase
      .from('calendar_companies')
      .select('*')
      .eq('id', company.id)
      .maybeSingle<Company>();

    const { data, error } = await supabase
      .from('calendar_companies')
      .update({ ...company, updated_at: new Date().toISOString() })
      .eq('id', company.id)
      .select('*')
      .single<Company>();
    if (error) throw error;
    await logAudit(
      'UPDATE',
      'calendar_companies',
      `Updated company "${data.name}"`,
      (existing || null) as unknown as Record<string, unknown> | null,
      data as unknown as Record<string, unknown>,
      actorId,
    );
    return data;
  }

  const { data, error } = await supabase
    .from('calendar_companies')
    .insert({ ...company, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('*')
    .single<Company>();
  if (error) throw error;
  await logAudit('INSERT', 'calendar_companies', `Created company "${data.name}"`, null, data as unknown as Record<string, unknown>, actorId);
  return data;
}


// --- Type Mappings API ---

export async function getTypeMappings(): Promise<AppointmentTypeMapping[]> {
  const { data, error } = await supabase
    .from('appointment_type_mappings')
    .select('*')
    .order('appointment_type', { ascending: true });
  if (error) throw error;
  return (data || []) as AppointmentTypeMapping[];
}

export async function updateTypeMapping(appointmentType: string, companyId: string | null, actorId: string | null): Promise<void> {
  const { data: existing } = await supabase
    .from('appointment_type_mappings')
    .select('*')
    .eq('appointment_type', appointmentType)
    .maybeSingle<AppointmentTypeMapping>();

  if (existing) {
    const { error } = await supabase
      .from('appointment_type_mappings')
      .update({ company_id: companyId, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
    await logAudit(
      'UPDATE',
      'appointment_type_mappings',
      `Updated mapping for "${appointmentType}"`,
      existing as unknown as Record<string, unknown>,
      { ...existing, company_id: companyId } as unknown as Record<string, unknown>,
      actorId,
    );
  } else {
    const { error } = await supabase
      .from('appointment_type_mappings')
      .insert({ appointment_type: appointmentType, company_id: companyId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (error) throw error;
    await logAudit('INSERT', 'appointment_type_mappings', `Created mapping for "${appointmentType}"`, null, { appointment_type: appointmentType, company_id: companyId } as unknown as Record<string, unknown>, actorId);
  }
}

// --- Audit Logs API ---

export async function getAuditLogs(limit: number = 50): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as AuditEntry[];
}

// --- Reminders API ---

export async function getReminders(): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .order('scheduled_send_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ReminderRow[];
}

// --- Company snapshot helper ---

export function buildCompanySnapshot(company: Company | null): CompanySnapshot | null {
  if (!company) return null;
  return {
    name: company.name,
    address_line1: company.address_line1,
    address_line2: company.address_line2,
    city: company.city,
    state: company.state,
    zip_code: company.zip_code,
    phone: company.phone,
  };
}

// --- Tasks API ---

export async function getTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('calendar_tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []) as Task[];
}

export async function getTasksByDateRange(startDate: string, endDate: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('calendar_tasks')
    .select('*')
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data || []) as Task[];
}

export async function getTasksByDate(date: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('calendar_tasks')
    .select('*')
    .eq('due_date', date)
    .order('status', { ascending: true });
  if (error) throw error;
  return (data || []) as Task[];
}

export async function getTaskDetails(taskId: string): Promise<{ task: Task | null; subtasks: Subtask[]; history: TaskStatusHistoryEntry[] }> {
  const [taskRes, subtasksRes, historyRes] = await Promise.all([
    supabase.from('calendar_tasks').select('*').eq('id', taskId).maybeSingle<Task>(),
    supabase.from('subtasks').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from('task_status_history').select('*').eq('task_id', taskId).order('changed_at', { ascending: true }),
  ]);
  if (taskRes.error) throw taskRes.error;
  if (subtasksRes.error) throw subtasksRes.error;
  if (historyRes.error) throw historyRes.error;
  return {
    task: taskRes.data,
    subtasks: (subtasksRes.data || []) as Subtask[],
    history: (historyRes.data || []) as TaskStatusHistoryEntry[],
  };
}

export async function createTask(input: {
  title: string;
  action_category: TaskActionCategory;
  notes?: string;
  due_date?: string | null;
  status?: TaskStatus;
}): Promise<Task> {
  const { data, error } = await supabase
    .from('calendar_tasks')
    .insert({
      title: input.title,
      action_category: input.action_category,
      notes: input.notes || '',
      due_date: input.due_date ?? null,
      status: input.status || 'Not Started',
    })
    .select('*')
    .single<Task>();
  if (error) throw error;
  return data;
}

export async function updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'action_category' | 'notes' | 'due_date' | 'status'>>): Promise<Task> {
  const { data, error } = await supabase
    .from('calendar_tasks')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single<Task>();
  if (error) throw error;
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_tasks').delete().eq('id', id);
  if (error) throw error;
}

// --- Subtasks API ---

export async function addSubtask(taskId: string, title: string): Promise<Subtask> {
  const { data, error } = await supabase
    .from('subtasks')
    .insert({ task_id: taskId, title })
    .select('*')
    .single<Subtask>();
  if (error) throw error;
  return data;
}

export async function createSubtasksBulk(taskId: string, titles: string[]): Promise<Subtask[]> {
  if (titles.length === 0) return [];
  const rows = titles.map(title => ({ task_id: taskId, title }));
  const { data, error } = await supabase
    .from('subtasks')
    .insert(rows)
    .select('*');
  if (error) throw error;
  return (data || []) as Subtask[];
}

export async function updateSubtask(id: string, updates: Partial<Pick<Subtask, 'title' | 'completed'>>): Promise<Subtask> {
  const { data, error } = await supabase
    .from('subtasks')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single<Subtask>();
  if (error) throw error;
  return data;
}

export async function deleteSubtask(id: string): Promise<void> {
  const { error } = await supabase.from('subtasks').delete().eq('id', id);
  if (error) throw error;
}

// --- Delivery monitoring API ---

export async function getUnacknowledgedFailureCount(): Promise<number> {
  const { count, error } = await supabase
    .from('delivery_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('acknowledged', false)
    .eq('resolved', false);
  if (error) throw error;
  return count || 0;
}

export async function getDeliveryFailures(): Promise<DeliveryFailureWithDetails[]> {
  // Get all alerts (including acknowledged/resolved for history)
  const { data: alerts, error: alertError } = await supabase
    .from('delivery_alerts')
    .select('*')
    .order('created_at', { ascending: false });
  if (alertError) throw alertError;
  if (!alerts || alerts.length === 0) return [];

  const alertList = alerts as DeliveryAlert[];
  const attemptIds = alertList.map(a => a.attempt_id);

  const { data: attempts, error: attemptError } = await supabase
    .from('reminder_attempts')
    .select('*')
    .in('id', attemptIds);
  if (attemptError) throw attemptError;

  const attemptList = (attempts || []) as ReminderAttempt[];
  const apptIds = [...new Set(attemptList.map(a => a.appointment_id).filter(Boolean))] as string[];

  // Fetch appointments
  const apptMap = new Map<string, Appointment>();
  if (apptIds.length > 0) {
    const { data: appts } = await supabase
      .from('appointments')
      .select('*')
      .in('id', apptIds);
    (appts || []).forEach((a: Appointment) => apptMap.set(a.id, a));
  }

  // Fetch agent profiles for all appointments
  const agentIdsFromAppts = [...new Set([...apptMap.values()].map(a => a.assigned_to))];
  const agentMap = new Map<string, Profile>();
  if (agentIdsFromAppts.length > 0) {
    const { data: agents } = await supabase
      .from('profiles')
      .select('*')
      .in('id', agentIdsFromAppts);
    (agents || []).forEach((p: Profile) => agentMap.set(p.id, p));
  }

  return alertList.map(alert => {
    const attempt = attemptList.find(a => a.id === alert.attempt_id);
    if (!attempt) return null;
    const appt = attempt.appointment_id ? apptMap.get(attempt.appointment_id) || null : null;
    const agent = appt ? agentMap.get(appt.assigned_to) || null : null;
    return { attempt, alert, appointment: appt, agent };
  }).filter((x): x is DeliveryFailureWithDetails => x !== null);
}

export async function acknowledgeAlert(alertId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('delivery_alerts')
    .update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    })
    .eq('id', alertId);
  if (error) throw error;
}

export async function resolveAlert(alertId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('delivery_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq('id', alertId);
  if (error) throw error;
}

export async function retryFailedMessage(attemptId: string): Promise<{ success: boolean; error?: string; attempt_id?: string }> {
  // Fetch the original attempt to get template params
  const { data: attempt, error: attemptError } = await supabase
    .from('reminder_attempts')
    .select('*')
    .eq('id', attemptId)
    .maybeSingle<ReminderAttempt>();
  if (attemptError) throw attemptError;
  if (!attempt) return { success: false, error: 'Original attempt not found.' };

  // Must have template params to safely reconstruct the message
  if (!attempt.template_params || !attempt.template_slug) {
    return { success: false, error: 'Original message content cannot be safely reconstructed — template parameters are missing.' };
  }

  // Fetch the appointment and profile to send via the send-reminder edge function
  if (!attempt.appointment_id) {
    return { success: false, error: 'Appointment no longer exists for this attempt.' };
  }

  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', attempt.appointment_id)
    .maybeSingle<Appointment>();
  if (apptError || !appt) {
    return { success: false, error: 'Could not load appointment for retry.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, phone')
    .eq('id', appt.assigned_to)
    .maybeSingle<{ full_name: string; email: string; phone: string | null }>();

  if (!profile) {
    return { success: false, error: 'Assigned agent profile not found.' };
  }

  // Call the send-reminder edge function with manual=true and parent_attempt_id
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-reminder`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  };

  // Get current session token
  const { data: session } = await supabase.auth.getSession();
  if (session?.session?.access_token) {
    headers['Authorization'] = `Bearer ${session.session.access_token}`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      manual: true,
      channel: 'sms',
      recipient_type: 'client',
      recipient_address: attempt.recipient_address,
      appointment: {
        ...appt,
        customer_id: appt.customer_id ?? null,
      },
      profile,
      parent_attempt_id: attemptId,
    }),
  });

  if (!response.ok) {
    return { success: false, error: `Retry request failed (${response.status})` };
  }

  const result = await response.json();

  if (result.status === 'sent') {
    if (!result.sent_email_logged) {
      await logCalendarSentEmail({
        customer_id: appt.customer_id ?? null,
        appointment_id: appt.id,
        channel: 'whatsapp',
        recipient_email: appt.client_email || '',
        recipient_phone: attempt.recipient_address,
        recipient_name: appt.client_name,
        subject: `WhatsApp Appointment Confirmation – ${appt.client_name}`,
        body: attempt.original_message || `WhatsApp reminder sent to ${appt.client_name} (${attempt.recipient_address}) for ${appt.appointment_date}.`,
        status: 'sent',
      });
    }
    return { success: true, attempt_id: result.attempt_id || null };
  }

  return { success: false, error: result.error || 'Retry send failed.' };
}

// --- Shared sent_emails API (Calendar + Payroll + Categorizer) ---

export interface LogCalendarSentEmailInput {
  customer_id?: string | null;
  appointment_id?: string | null;
  channel: 'email' | 'whatsapp';
  recipient_email?: string | null;
  recipient_phone?: string | null;
  recipient_name?: string | null;
  subject: string;
  body: string;
  status?: string;
  sent_at?: string;
  source_app?: string;
}

function extractMissingColumnName(message: string): string | null {
  const m1 = message.match(/Could not find the '([^']+)' column/i);
  if (m1) return m1[1];
  const m2 = message.match(/column "([^"]+)"(?: of relation "[^"]+")? does not exist/i);
  if (m2) return m2[1];
  const m3 = message.match(/column [a-zA-Z0-9_]+\.([a-zA-Z0-9_]+) does not exist/i);
  if (m3) return m3[1];
  return null;
}

export async function logCalendarSentEmail(input: LogCalendarSentEmailInput): Promise<void> {
  const nowIso = input.sent_at || new Date().toISOString();
  const payload: Record<string, unknown> = {
    customer_id: input.customer_id || null,
    appointment_id: input.appointment_id || null,
    source_app: input.source_app || 'calendar',
    channel: input.channel,
    recipient_email: (input.recipient_email || '').trim().toLowerCase(),
    recipient_phone: input.recipient_phone || null,
    recipient_name: input.recipient_name || null,
    subject: input.subject || '(No Subject)',
    body: input.body || '',
    status: input.status || 'sent',
    sent_at: nowIso,
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabase.from('sent_emails').insert(payload);
    if (!error) return;
    const missingCol = extractMissingColumnName(error.message || '');
    if (missingCol && missingCol in payload) {
      delete payload[missingCol];
      continue;
    }
    return;
  }
}

function normalizePhone10(value?: string | null): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export async function getCustomerSentEmails(
  customer: Pick<Customer, 'id' | 'email' | 'phone'>,
): Promise<SentEmailRecord[]> {
  const trimmedEmail = (customer.email || '').trim().toLowerCase();
  const phone10 = normalizePhone10(customer.phone);

  interface QueryClause {
    column: string;
    clause: string;
  }

  const clauses: QueryClause[] = [
    { column: 'customer_id', clause: `customer_id.eq.${customer.id}` },
  ];

  if (trimmedEmail) {
    clauses.push({ column: 'recipient_email', clause: `recipient_email.ilike.${trimmedEmail}` });
  }

  if (phone10) {
    const formattedUs = `(${phone10.slice(0, 3)}) ${phone10.slice(3, 6)}-${phone10.slice(6)}`;
    clauses.push({ column: 'recipient_phone', clause: `recipient_phone.ilike.%${phone10}%` });
    clauses.push({ column: 'recipient_phone', clause: `recipient_phone.eq.${formattedUs}` });
    clauses.push({ column: 'recipient_phone', clause: `recipient_phone.ilike.%${phone10.slice(0, 3)}%${phone10.slice(6)}%` });
    clauses.push({ column: 'recipient_email', clause: `recipient_email.ilike.%${phone10}%` });
    clauses.push({ column: 'recipient_email', clause: `recipient_email.eq.${formattedUs}` });
  }

  let activeClauses = [...clauses];
  let rows: SentEmailRecord[] = [];

  for (let attempt = 0; attempt < 6; attempt++) {
    if (activeClauses.length === 0) break;
    const orExpr = activeClauses.map((c) => c.clause).join(',');
    const { data, error } = await supabase
      .from('sent_emails')
      .select('*')
      .or(orExpr)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error) {
      rows = (data || []) as SentEmailRecord[];
      break;
    }

    const missingCol = extractMissingColumnName(error.message || '');
    if (missingCol) {
      const nextClauses = activeClauses.filter((c) => c.column !== missingCol);
      if (nextClauses.length !== activeClauses.length) {
        activeClauses = nextClauses;
        continue;
      }
    }

    // Fallback order by sent_at or unordered if created_at doesn't exist
    if ((error.message || '').toLowerCase().includes('created_at')) {
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from('sent_emails')
        .select('*')
        .or(orExpr)
        .limit(200);
      if (!fallbackErr) {
        rows = (fallbackData || []) as SentEmailRecord[];
        break;
      }
    }

    throw error;
  }

  // Deduplicate and verify strict client-side match
  const seen = new Set<string>();
  const matched = rows.filter((row) => {
    if (!row || !row.id || seen.has(row.id)) return false;
    seen.add(row.id);

    if (row.customer_id && row.customer_id === customer.id) return true;
    const rowEmail = (row.recipient_email || '').trim().toLowerCase();
    if (trimmedEmail && rowEmail && rowEmail === trimmedEmail) return true;

    if (phone10) {
      const rowPhone10 = normalizePhone10(row.recipient_phone);
      if (rowPhone10 && rowPhone10 === phone10) return true;
      // Only treat recipient_email as phone when it has no '@'
      if (rowEmail && !rowEmail.includes('@') && normalizePhone10(rowEmail) === phone10) {
        return true;
      }
    }
    return false;
  });

  matched.sort((a, b) => {
    const tsA = Date.parse(a.sent_at || a.created_at || '') || 0;
    const tsB = Date.parse(b.sent_at || b.created_at || '') || 0;
    return tsB - tsA;
  });

  return matched;
}

export async function getAllAttempts(): Promise<ReminderAttempt[]> {
  const { data, error } = await supabase
    .from('reminder_attempts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ReminderAttempt[];
}

// --- Focus sessions API ---

function parseSessionRow(row: Record<string, unknown>): FocusSession {
  return {
    id: row['id'] as string,
    user_id: row['user_id'] as string,
    tasks: (row['tasks'] as FocusSessionTask[]) || [],
    current_task_index: row['current_task_index'] as number,
    task_started_at: (row['task_started_at'] as string | null) || null,
    task_deadline_at: (row['task_deadline_at'] as string | null) || null,
    completed_task_ids: (row['completed_task_ids'] as string[]) || [],
    skipped_task_ids: (row['skipped_task_ids'] as string[]) || [],
    status: row['status'] as 'active' | 'completed',
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}

export async function getActiveFocusSession(): Promise<FocusSession | null> {
  const { data, error } = await supabase
    .from('focus_sessions')
    .select('*')
    .eq('status', 'active')
    .maybeSingle<Record<string, unknown>>();
  if (error) throw error;
  if (!data) return null;
  return parseSessionRow(data);
}

export async function createFocusSession(
  tasks: FocusSessionTask[],
  taskStartedAt: string,
  taskDeadlineAt: string,
): Promise<FocusSession> {
  const { data, error } = await supabase
    .from('focus_sessions')
    .insert({
      tasks,
      current_task_index: 0,
      task_started_at: taskStartedAt,
      task_deadline_at: taskDeadlineAt,
      completed_task_ids: [],
      skipped_task_ids: [],
      status: 'active',
    })
    .select('*')
    .single<Record<string, unknown>>();
  if (error) throw error;
  return parseSessionRow(data);
}

export async function updateFocusSession(
  id: string,
  updates: Partial<Pick<FocusSession, 'current_task_index' | 'task_started_at' | 'task_deadline_at' | 'completed_task_ids' | 'skipped_task_ids' | 'status'>>,
): Promise<FocusSession> {
  const { data, error } = await supabase
    .from('focus_sessions')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single<Record<string, unknown>>();
  if (error) throw error;
  return parseSessionRow(data);
}

export async function deleteFocusSession(id: string): Promise<void> {
  const { error } = await supabase.from('focus_sessions').delete().eq('id', id);
  if (error) throw error;
}

// --- Customers API ---

export function isCustomerVisibleForCompany(
  customer: Pick<Customer, 'company_id' | 'is_global'>,
  selectedCompanyId?: string | null,
): boolean {
  if (customer.is_global || customer.company_id === null) return true;
  if (!selectedCompanyId) return false;
  return customer.company_id === selectedCompanyId;
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle<Customer>();
  if (error) throw error;
  return data;
}

export async function getCustomers(selectedCompanyId?: string | null): Promise<Customer[]> {
  let query = supabase
    .from('customers')
    .select('*');

  if (selectedCompanyId) {
    query = query.or(`company_id.eq.${selectedCompanyId},company_id.is.null,is_global.eq.true`);
  } else {
    query = query.or('company_id.is.null,is_global.eq.true');
  }

  const { data, error } = await query.order('full_name', { ascending: true });
  if (error) throw error;
  return ((data || []) as Customer[]).filter((c) => isCustomerVisibleForCompany(c, selectedCompanyId));
}

export async function searchCustomers(query: string, selectedCompanyId?: string | null): Promise<Customer[]> {
  const all = await getCustomers(selectedCompanyId);
  const q = query.trim().toLowerCase();
  if (!q) return all;
  const digitsOnly = q.replace(/\D/g, '');
  return all
    .filter((c) => {
      const nameMatch = (c.full_name || '').toLowerCase().includes(q);
      const emailMatch = (c.email || '').toLowerCase().includes(q);
      const phoneMatch =
        (c.phone || '').toLowerCase().includes(q) ||
        (digitsOnly.length >= 2 && (c.phone || '').replace(/\D/g, '').includes(digitsOnly));
      return nameMatch || emailMatch || phoneMatch;
    })
    .slice(0, 50);
}


export async function saveCustomer(customer: Partial<Customer> & { id?: string }, actorId: string | null): Promise<Customer> {
  if (customer.id) {
    const { data: existing } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customer.id)
      .maybeSingle<Customer>();

    const { data, error } = await supabase
      .from('customers')
      .update({ ...customer, updated_at: new Date().toISOString() })
      .eq('id', customer.id)
      .select('*')
      .single<Customer>();
    if (error) throw error;
    if (existing) {
      await logAudit('UPDATE', 'customers', `Updated customer "${data.full_name}"`, existing as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, actorId);
    }
    return data;
  }

  const assigned_user_id = customer.assigned_user_id !== undefined && customer.assigned_user_id !== ''
    ? customer.assigned_user_id
    : actorId;

  const { data, error } = await supabase
    .from('customers')
    .insert({
      ...customer,
      assigned_user_id,
      preferred_language: customer.preferred_language || 'es',
      created_by: actorId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single<Customer>();
  if (error) throw error;
  await logAudit('INSERT', 'customers', `Created customer "${data.full_name}"`, null, data as unknown as Record<string, unknown>, actorId);
  return data;
}

export async function deleteCustomer(id: string, actorId: string | null): Promise<void> {
  const { data: deleted } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle<Customer>();

  const { error: unlinkErr } = await supabase
    .from('appointments')
    .update({ customer_id: null, updated_at: new Date().toISOString() })
    .eq('customer_id', id);
  if (unlinkErr) throw unlinkErr;

  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
  if (deleted) {
    await logAudit('DELETE', 'customers', `Deleted customer "${deleted.full_name}"`, deleted as unknown as Record<string, unknown>, null, actorId);
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickBestScopedCustomer(
  rows: Customer[] | null | undefined,
  selectedCompanyId?: string | null,
): Customer | null {
  const visible = (rows || []).filter((c) => isCustomerVisibleForCompany(c, selectedCompanyId));
  if (visible.length === 0) return null;
  if (selectedCompanyId) {
    const companyMatch = visible.find((c) => c.company_id === selectedCompanyId && !c.is_global);
    if (companyMatch) return companyMatch;
  }
  return visible[0];
}

/**
 * Finds an existing customer that matches the given name/phone/email within
 * the active company scope (`company_id = selectedCompanyId OR is_global = true`).
 * Matching priority:
 *   1. Valid, non-dummy 10-digit phone number
 *   2. Lowercase email (if non-empty)
 *   3. Exact case-insensitive normalized full_name — only when BOTH phone and
 *      email are absent/invalid (avoids false matches when real identifiers exist)
 */
export async function findMatchingCustomer(
  name: string,
  phone: string,
  email: string,
  selectedCompanyId?: string | null,
): Promise<Customer | null> {
  const trimmedName = (name || '').trim();
  const trimmedEmail = (email || '').trim();

  // 1. Phone match (valid, non-dummy 10-digit)
  const phoneDigits = (phone || '').replace(/\D/g, '');
  const hasRealPhone = phoneDigits.length === 10 && !isDummyPhoneNumber(phoneDigits);
  if (hasRealPhone) {
    let q = supabase.from('customers').select('*').eq('phone', phone);
    q = selectedCompanyId
      ? q.or(`company_id.eq.${selectedCompanyId},company_id.is.null,is_global.eq.true`)
      : q.or('company_id.is.null,is_global.eq.true');
    const { data } = await q.limit(10);
    const match = pickBestScopedCustomer(data as Customer[] | null, selectedCompanyId);
    if (match) return match;
  }

  // 2. Email match
  if (trimmedEmail) {
    let q = supabase.from('customers').select('*').eq('email', trimmedEmail.toLowerCase());
    q = selectedCompanyId
      ? q.or(`company_id.eq.${selectedCompanyId},company_id.is.null,is_global.eq.true`)
      : q.or('company_id.is.null,is_global.eq.true');
    const { data } = await q.limit(10);
    const match = pickBestScopedCustomer(data as Customer[] | null, selectedCompanyId);
    if (match) return match;
  }

  // 3. Name match — only when no real phone or email available
  if (!hasRealPhone && !trimmedEmail && trimmedName) {
    let q = supabase.from('customers').select('*').ilike('full_name', trimmedName);
    q = selectedCompanyId
      ? q.or(`company_id.eq.${selectedCompanyId},company_id.is.null,is_global.eq.true`)
      : q.or('company_id.is.null,is_global.eq.true');
    const { data } = await q.limit(10);
    const exactNameRows = ((data || []) as Customer[]).filter(
      (c) => normalizeName(c.full_name) === normalizeName(trimmedName),
    );
    const match = pickBestScopedCustomer(exactNameRows, selectedCompanyId);
    if (match) return match;
  }

  return null;
}

/**
 * Merges duplicateId into keepId: fills blank fields on keepId from duplicateId,
 * reassigns all appointments pointing at duplicateId to keepId, then deletes duplicateId.
 */
export async function mergeCustomers(keepId: string, duplicateId: string, actorId: string | null): Promise<Customer> {
  if (keepId === duplicateId) throw new Error('Cannot merge a customer into itself.');

  const { data: keep, error: keepErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', keepId)
    .maybeSingle<Customer>();
  if (keepErr) throw keepErr;
  if (!keep) throw new Error('Target customer not found.');

  const { data: dup, error: dupErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', duplicateId)
    .maybeSingle<Customer>();
  if (dupErr) throw dupErr;
  if (!dup) throw new Error('Duplicate customer not found.');

  // Fill blank fields on keep from dup
  const updates: Partial<Customer> = {};
  const blankableFields: (keyof Customer)[] = ['phone', 'email', 'notes', 'address_line1', 'address_line2', 'city', 'state', 'zip_code', 'preferred_language'];
  for (const field of blankableFields) {
    const keepVal = keep[field] as string;
    const dupVal = dup[field] as string;
    if ((!keepVal || keepVal === '') && dupVal && dupVal !== '') {
      (updates as Record<string, unknown>)[field] = dupVal;
    }
  }
  if (!keep.date_of_birth && dup.date_of_birth) {
    updates.date_of_birth = dup.date_of_birth;
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', keepId);
    if (updErr) throw updErr;
  }

  // Reassign appointments
  const { error: apptErr } = await supabase
    .from('appointments')
    .update({ customer_id: keepId, updated_at: new Date().toISOString() })
    .eq('customer_id', duplicateId);
  if (apptErr) throw apptErr;

  // Best-effort reassign shared sent_emails linked to duplicate customer
  try {
    await supabase
      .from('sent_emails')
      .update({ customer_id: keepId })
      .eq('customer_id', duplicateId);
  } catch {
    // Ignore if sent_emails or customer_id column is unavailable
  }

  // Delete duplicate
  const { error: delErr } = await supabase
    .from('customers')
    .delete()
    .eq('id', duplicateId);
  if (delErr) throw delErr;

  await logAudit('MERGE', 'customers', `Merged customer "${dup.full_name}" into "${keep.full_name}"`, dup as unknown as Record<string, unknown>, keep as unknown as Record<string, unknown>, actorId);

  // Return refreshed keep row
  const { data: refreshed, error: refErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', keepId)
    .single<Customer>();
  if (refErr) throw refErr;
  return refreshed;
}

// --- Customer Role & CSV Import Helpers ---

const ROLE_TAG_LOOKUP = new Map<string, CustomerRole>(
  CUSTOMER_ROLES.map((r) => [r.toLowerCase(), r]),
);

export function normalizeCustomerRole(raw?: string | null): CustomerRole {
  const cleaned = (raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!cleaned) return 'Other';
  if (cleaned === 'taxpayer' || cleaned === 'primary' || cleaned === 'primarytaxpayer') return 'Taxpayer';
  if (cleaned === 'spouse') return 'Spouse';
  if (cleaned === 'dependent') return 'Dependent';
  if (cleaned === 'other') return 'Other';
  return ROLE_TAG_LOOKUP.get(cleaned) || 'Other';
}

export function getCustomerRole(tags?: string[] | null): CustomerRole {
  if (!Array.isArray(tags) || tags.length === 0) return 'Other';
  for (const tag of tags) {
    const lower = (tag || '').trim().toLowerCase();
    const matched = ROLE_TAG_LOOKUP.get(lower);
    if (matched) return matched;
  }
  return 'Other';
}

export function setCustomerRoleTag(tags: string[] | null | undefined, role: CustomerRole): string[] {
  const existing = Array.isArray(tags) ? tags : [];
  const filtered = existing.filter((t) => !ROLE_TAG_LOOKUP.has((t || '').trim().toLowerCase()));
  return [role, ...filtered];
}

export function parseStateAndZip(raw: string): { state: string; zip_code: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { state: '', zip_code: '' };

  const match = trimmed.match(/^([A-Za-z]{2,})\s*[-,\s]+\s*(\d{5}(?:-\d{4})?)$/);
  if (match) {
    return {
      state: match[1].toUpperCase(),
      zip_code: match[2],
    };
  }

  const tokens = trimmed.split(/[\s,-]+/).filter(Boolean);
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    if (/^\d{5}(?:-\d{4})?$/.test(last) && /^[A-Za-z]{2,}$/.test(prev)) {
      return {
        state: prev.toUpperCase(),
        zip_code: last,
      };
    }
  }

  if (/^\d{5}(?:-\d{4})?$/.test(trimmed)) {
    return { state: '', zip_code: trimmed };
  }
  if (/^[A-Za-z]{2,}$/.test(trimmed)) {
    return { state: trimmed.toUpperCase(), zip_code: '' };
  }

  return { state: trimmed, zip_code: '' };
}

function parseStateZip(raw: string): { city: string; state: string; zip_code: string } {
  const trimmed = (raw || '').trim();
  const match = trimmed.match(/^(.*?)\s*,\s*([A-Za-z]{2,})\s*[-,\s]\s*(\d{5}(?:-\d{4})?)$/i) ||
                trimmed.match(/^(.*?)\s+([A-Za-z]{2,})\s+(\d{5}(?:-\d{4})?)$/i);
  if (match) {
    return {
      city: (match[1] || '').replace(/,+$/, '').trim(),
      state: match[2].toUpperCase(),
      zip_code: match[3],
    };
  }
  const sz = parseStateAndZip(trimmed);
  return { city: '', state: sz.state, zip_code: sz.zip_code };
}

export function parseMultiLineAddress(lines: string[]): {
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
} {
  const cleaned = lines.map((l) => (l || '').trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { address_line1: '', address_line2: '', city: '', state: '', zip_code: '' };
  }

  if (cleaned.length === 1) {
    return parseCsvAddress(cleaned[0]);
  }

  if (cleaned.length === 2) {
    const streetLine = cleaned[0];
    const secondLine = cleaned[1];
    const cityStateZip = parseStateZip(secondLine);
    const stateZip = parseStateAndZip(secondLine);
    return {
      address_line1: streetLine,
      address_line2: '',
      city: cityStateZip.city || secondLine.replace(/,+$/, '').trim(),
      state: stateZip.state,
      zip_code: stateZip.zip_code,
    };
  }

  if (cleaned.length === 3) {
    const streetLine = cleaned[0];
    const cityLine = cleaned[1].replace(/,+$/, '').trim();
    const stateZipLine = cleaned[2];
    const { state, zip_code } = parseStateAndZip(stateZipLine);
    return {
      address_line1: streetLine,
      address_line2: '',
      city: cityLine,
      state,
      zip_code,
    };
  }

  // 4 or more lines: [streetLine, aptLine, ..., cityLine, stateZipLine]
  const streetLine = cleaned[0];
  const finalLine = cleaned[cleaned.length - 1];
  const secondToLastLine = cleaned[cleaned.length - 2].replace(/,+$/, '').trim();
  const middleLines = cleaned.slice(1, cleaned.length - 2);
  const address_line2 = middleLines.join(', ');
  const { state, zip_code } = parseStateAndZip(finalLine);

  return {
    address_line1: streetLine,
    address_line2,
    city: secondToLastLine,
    state,
    zip_code,
  };
}

function isRowEmptyForCustomerFields(row: Record<string, string>): boolean {
  const hasName = Boolean(getCsvColumnValue(row, [
    'clientname', 'fullname', 'name', 'customername', 'taxpayername', 'contactname',
    'firstname', 'first', 'fname', 'lastname', 'last', 'lname'
  ]));
  const hasDob = Boolean(getCsvColumnValue(row, ['birthdate', 'dob', 'dateofbirth', 'birthday']));
  const hasPhone = Boolean(getCsvColumnValue(row, [
    'phonenumber', 'phone', 'cell', 'cellphone', 'mobile', 'mobilephone',
    'telephone', 'tel', 'homephone', 'workphone'
  ]));
  const hasType = Boolean(getCsvColumnValue(row, [
    'type', 'role', 'contacttype', 'relationship', 'clienttype', 'tag', 'tags', 'category'
  ]));
  const hasEmail = Boolean(getCsvColumnValue(row, ['email', 'emailaddress', 'primaryemail']));

  return !hasName && !hasDob && !hasPhone && !hasType && !hasEmail;
}

function getRowAddressValue(row: Record<string, string>): string {
  return getCsvColumnValue(row, [
    'address', 'mailingaddress', 'streetaddress', 'fulladdress',
    'addressline1', 'address1', 'street', 'street1'
  ]);
}

function extractRowAddressText(row: Record<string, string>): string {
  const primary = getRowAddressValue(row);
  if (primary) return primary;
  const a1 = getCsvColumnValue(row, ['addressline1', 'address1', 'street', 'street1']);
  const a2 = getCsvColumnValue(row, ['addressline2', 'address2']);
  const c = getCsvColumnValue(row, ['city', 'town']);
  const s = getCsvColumnValue(row, ['state', 'st']);
  const z = getCsvColumnValue(row, ['zipcode', 'zip']);
  return [a1, a2, c, [s, z].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function isAddressContinuationRow(row: Record<string, string>): boolean {
  if (!isRowEmptyForCustomerFields(row)) return false;
  const hasAddr = Boolean(
    getCsvColumnValue(row, [
      'address', 'mailingaddress', 'streetaddress', 'fulladdress',
      'addressline1', 'address1', 'street', 'street1',
      'addressline2', 'address2', 'city', 'state', 'zipcode', 'zip'
    ])
  );
  return hasAddr;
}

export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = csvText.replace(/^\uFEFF/, '');
  const firstLines = text.split(/\r?\n/).slice(0, 4).join('\n');
  const commaCount = (firstLines.match(/,/g) || []).length;
  const semiCount = (firstLines.match(/;/g) || []).length;
  const tabCount = (firstLines.match(/\t/g) || []).length;
  let delimiter = ',';
  if (semiCount > commaCount && semiCount >= tabCount) delimiter = ';';
  else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && next === '\n') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rawRows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rawRows.push(currentRow);
    }
  }

  if (rawRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerKeywords = ['name', 'client', 'birth', 'dob', 'phone', 'email', 'address', 'taxpayer', 'contact', 'type'];
  let headerRowIndex = 0;
  let maxScore = -1;

  const maxScan = Math.min(10, rawRows.length);
  for (let r = 0; r < maxScan; r++) {
    const rowCells = rawRows[r];
    let score = 0;
    for (const cell of rowCells) {
      const norm = normalizeHeaderKey(cell);
      if (headerKeywords.some(kw => norm.includes(kw))) {
        score++;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      headerRowIndex = r;
    }
  }

  const headers = rawRows[headerRowIndex].map((h, idx) => h.trim() || `column_${idx + 1}`);
  const rawDataRows: Record<string, string>[] = [];

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const values = rawRows[r];
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      const val = (values[idx] || '').trim();
      if (val) hasValue = true;
      obj[header] = val;
    });
    if (hasValue) rawDataRows.push(obj);
  }

  const rows: Record<string, string>[] = [];
  let currentCustomerRow: (Record<string, string> & { _address_lines?: string[] }) | null = null;

  for (const row of rawDataRows) {
    const extRow = row as Record<string, string> & { _address_lines?: string[] };
    if (isAddressContinuationRow(row) && currentCustomerRow) {
      const textLine = extractRowAddressText(row);
      if (textLine) {
        currentCustomerRow._address_lines = currentCustomerRow._address_lines || [];
        currentCustomerRow._address_lines.push(textLine);
      }
    } else {
      const textLine = extractRowAddressText(row);
      extRow._address_lines = textLine ? [textLine] : [];
      currentCustomerRow = extRow;
      rows.push(row);
    }
  }

  return { headers, rows };
}

export function detectHeaderMapping(headers: string[]): {
  clientName: string;
  birthDate: string;
  address: string;
  phone: string;
  type: string;
  email: string;
  language: string;
  assignedTo: string;
  isClientNameAutoMatched: boolean;
} {
  const findMatch = (aliases: string[]) => {
    for (const h of headers) {
      const norm = normalizeHeaderKey(h);
      if (aliases.some(a => norm.includes(a) || norm === a)) {
        return h;
      }
    }
    return '';
  };

  const nameAliases = ['clientname', 'fullname', 'name', 'customername', 'taxpayername', 'contactname', 'firstname', 'first', 'fname', 'taxpayer', 'client'];
  const dobAliases = ['birthdate', 'dob', 'dateofbirth', 'birthday', 'birth'];
  const addressAliases = ['address', 'mailingaddress', 'streetaddress', 'fulladdress', 'addressline1', 'address1', 'street', 'street1'];
  const phoneAliases = ['phonenumber', 'phone', 'cell', 'cellphone', 'mobile', 'mobilephone', 'telephone', 'tel', 'homephone', 'workphone'];
  const typeAliases = ['type', 'role', 'contacttype', 'relationship', 'clienttype', 'tag', 'tags', 'category'];
  const emailAliases = ['email', 'emailaddress', 'primaryemail'];
  const langAliases = ['language', 'preferredlanguage', 'lang', 'idioma', 'preferredlang'];
  const assignedAliases = ['assignedto', 'assigneduser', 'employee', 'assigned', 'agent', 'staff'];

  const clientName = findMatch(nameAliases);
  const birthDate = findMatch(dobAliases);
  const address = findMatch(addressAliases);
  const phone = findMatch(phoneAliases);
  const type = findMatch(typeAliases);
  const email = findMatch(emailAliases);
  const language = findMatch(langAliases);
  const assignedTo = findMatch(assignedAliases);

  return {
    clientName,
    birthDate,
    address,
    phone,
    type,
    email,
    language,
    assignedTo,
    isClientNameAutoMatched: Boolean(clientName),
  };
}

function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCsvColumnValue(row: Record<string, string>, aliases: string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => normalizeHeaderKey(key) === alias);
    if (found && found[1]) return found[1].trim();
  }
  return '';
}

export function parseCsvBirthDate(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // Strip optional timestamp portion (e.g. "01/15/1980 00:00:00")
  const datePart = trimmed.split(/[\sT]+/)[0];

  // Match MM/DD/YYYY or M/D/YYYY (or with dashes)
  const mdy = datePart.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const check = new Date(Date.UTC(year, month - 1, day));
      if (
        check.getUTCFullYear() === year &&
        check.getUTCMonth() === month - 1 &&
        check.getUTCDate() === day
      ) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  // Match ISO YYYY-MM-DD (or YYYY/M/D)
  const iso = datePart.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const check = new Date(Date.UTC(year, month - 1, day));
      if (
        check.getUTCFullYear() === year &&
        check.getUTCMonth() === month - 1 &&
        check.getUTCDate() === day
      ) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }

  return null;
}

export function parseCsvAddress(raw: string): {
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
} {
  const normalized = (raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return { address_line1: '', address_line2: '', city: '', state: '', zip_code: '' };
  }

  const parts = normalized.split(',').map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];

    // Pattern: "..., City, ST, 12345"
    if (/^\d{5}(?:-\d{4})?$/.test(last) && /^[A-Za-z]{2}$/.test(prev)) {
      const zip_code = last;
      const state = prev.toUpperCase();
      const before = parts.slice(0, -2);
      const city = before.length >= 2 ? before[before.length - 1] : '';
      const streetParts = before.length >= 2 ? before.slice(0, -1) : before;
      return {
        address_line1: streetParts[0] || '',
        address_line2: streetParts.slice(1).join(', '),
        city,
        state,
        zip_code,
      };
    }

    // Pattern: "..., ST 12345" or "..., City ST 12345"
    const stateZipMatch = last.match(/^(?:(.*?)\s+)?([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZipMatch) {
      const inlineCity = (stateZipMatch[1] || '').trim();
      const state = stateZipMatch[2].toUpperCase();
      const zip_code = stateZipMatch[3];
      const before = parts.slice(0, -1);

      if (inlineCity) {
        return {
          address_line1: before[0] || '',
          address_line2: before.slice(1).join(', '),
          city: inlineCity,
          state,
          zip_code,
        };
      }

      const city = before.length >= 2 ? before[before.length - 1] : '';
      const streetParts = before.length >= 2 ? before.slice(0, -1) : before;
      return {
        address_line1: streetParts[0] || '',
        address_line2: streetParts.slice(1).join(', '),
        city,
        state,
        zip_code,
      };
    }

    // Pattern: "..., City, ST"
    const stateOnlyMatch = last.match(/^(?:(.*?)\s+)?([A-Za-z]{2})$/);
    if (stateOnlyMatch) {
      const inlineCity = (stateOnlyMatch[1] || '').trim();
      const state = stateOnlyMatch[2].toUpperCase();
      const before = parts.slice(0, -1);

      if (inlineCity) {
        return {
          address_line1: before[0] || '',
          address_line2: before.slice(1).join(', '),
          city: inlineCity,
          state,
          zip_code: '',
        };
      }

      const city = before.length >= 2 ? before[before.length - 1] : '';
      const streetParts = before.length >= 2 ? before.slice(0, -1) : before;
      return {
        address_line1: streetParts[0] || '',
        address_line2: streetParts.slice(1).join(', '),
        city,
        state,
        zip_code: '',
      };
    }

    // Generic 3+ comma parts fallback: "street, city, rest"
    if (parts.length >= 3) {
      return {
        address_line1: parts[0],
        address_line2: parts.slice(1, -2).join(', '),
        city: parts[parts.length - 2],
        state: parts[parts.length - 1],
        zip_code: '',
      };
    }
  }

  // Single-string fallback without commas: "123 Main St Miami FL 33101"
  const singleLineZip = normalized.match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (singleLineZip) {
    return {
      address_line1: singleLineZip[1].trim(),
      address_line2: '',
      city: '',
      state: singleLineZip[2].toUpperCase(),
      zip_code: singleLineZip[3],
    };
  }

  return {
    address_line1: normalized,
    address_line2: '',
    city: '',
    state: '',
    zip_code: '',
  };
}

export function parseCsvPhone(raw: string): { phone: string; send_whatsapp: boolean } {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }
  const hasRealPhone = digits.length === 10 && !isDummyPhoneNumber(digits);
  if (!hasRealPhone) {
    return { phone: '', send_whatsapp: false };
  }
  return {
    phone: formatPhoneNumber(digits),
    send_whatsapp: true,
  };
}

export function normalizePreferredLanguage(raw?: string | null): 'es' | 'en' {
  const cleaned = (raw || '').trim().toLowerCase();
  if (!cleaned) return 'es';
  if (cleaned === 'en' || cleaned === 'english') return 'en';
  if (cleaned === 'es' || cleaned === 'spanish' || cleaned === 'español' || cleaned === 'espanol') return 'es';
  return 'es';
}

export interface CsvCustomerInsertRow {
  full_name: string;
  phone: string;
  email: string;
  notes: string;
  tags: string[];
  company_id: string | null;
  assigned_user_id: string | null;
  is_global: boolean;
  send_whatsapp: boolean;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  date_of_birth: string | null;
  role: CustomerRole;
  preferred_language: 'es' | 'en';
}

export interface CsvCustomerUpdateRow {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  date_of_birth: string | null;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  role: CustomerRole;
  tags: string[];
  send_whatsapp: boolean;
  assigned_user_id: string | null;
  preferred_language: 'es' | 'en';
}

export interface CsvImportPreview {
  totalRows: number;
  readyToImport: CsvCustomerInsertRow[];
  readyToUpdate: CsvCustomerUpdateRow[];
  skippedNoValidPhone: number;
  skippedNoEmail: number;
  skippedNoName: number;
  roleCounts: Record<CustomerRole, number>;
}

export function buildCsvImportPreview(params: {
  rows: Record<string, string>[];
  existingCustomers: Customer[];
  onlyWithValidEmail: boolean;
  targetCompanyId: string | null;
  isGlobal: boolean;
  profiles?: Profile[];
  currentUserId?: string | null;
  columnMapping?: {
    clientName?: string;
    birthDate?: string;
    address?: string;
    phone?: string;
    type?: string;
    email?: string;
    language?: string;
    assignedTo?: string;
  };
}): CsvImportPreview {
  const { rows, existingCustomers, onlyWithValidEmail, targetCompanyId, isGlobal, profiles = [], currentUserId = null, columnMapping } = params;

  const getCol = (row: Record<string, string>, aliases: string[], mappedKey?: string) => {
    if (mappedKey && row[mappedKey] !== undefined && row[mappedKey] !== null && String(row[mappedKey]).trim() !== '') {
      return String(row[mappedKey]).trim();
    }
    return getCsvColumnValue(row, aliases);
  };

  const existingMap = new Map<string, Customer>();
  for (const existing of existingCustomers) {
    const scopeMatch = isGlobal
      ? existing.is_global
      : existing.company_id === targetCompanyId || existing.is_global;
    if (!scopeMatch) continue;
    const phoneDigits = (existing.phone || '').replace(/\D/g, '').slice(-10);
    const nameNorm = normalizeName(existing.full_name || '');
    if (phoneDigits.length === 10 && nameNorm) {
      existingMap.set(`${phoneDigits}::${nameNorm}`, existing);
    }
  }

  const readyToImport: CsvCustomerInsertRow[] = [];
  const readyToUpdate: CsvCustomerUpdateRow[] = [];
  const seenUpdateIds = new Set<string>();
  let skippedNoValidPhone = 0;
  let skippedNoEmail = 0;
  let skippedNoName = 0;
  const roleCounts: Record<CustomerRole, number> = {
    Taxpayer: 0,
    Spouse: 0,
    Dependent: 0,
    Other: 0,
  };

  for (const row of rows) {
    let rawName = getCol(row, [
      'clientname',
      'fullname',
      'name',
      'customername',
      'taxpayername',
      'contactname',
    ], columnMapping?.clientName);
    if (!rawName) {
      const first = getCol(row, ['firstname', 'first', 'fname']);
      const last = getCol(row, ['lastname', 'last', 'lname']);
      rawName = [first, last].filter(Boolean).join(' ');
    }
    const fullName = rawName.trim().replace(/\s+/g, ' ');
    if (!fullName) {
      skippedNoName++;
      continue;
    }

    const rawPhone = getCol(row, [
      'phonenumber',
      'phone',
      'cell',
      'cellphone',
      'mobile',
      'mobilephone',
      'telephone',
      'tel',
      'homephone',
      'workphone',
    ], columnMapping?.phone);
    const { phone, send_whatsapp } = parseCsvPhone(rawPhone);
    if (!phone) {
      skippedNoValidPhone++;
      continue;
    }

    const rawEmail = getCol(row, ['email', 'emailaddress', 'primaryemail'], columnMapping?.email).trim();
    const hasValidEmail = rawEmail.length > 0 && isValidEmail(rawEmail);

    if (onlyWithValidEmail && !hasValidEmail) {
      skippedNoEmail++;
      continue;
    }

    const cleanEmail = hasValidEmail ? rawEmail.toLowerCase() : '';

    const rawType = getCol(row, [
      'type',
      'role',
      'contacttype',
      'relationship',
      'clienttype',
      'tag',
      'tags',
      'category',
    ], columnMapping?.type);
    const role = normalizeCustomerRole(rawType);

    const rawLang = getCol(row, ['language', 'preferredlanguage', 'lang', 'idioma', 'preferredlang'], columnMapping?.language);
    const preferred_language = normalizePreferredLanguage(rawLang);

    const rawAssigned = getCol(row, [
      'assignedto',
      'assigneduser',
      'employee',
      'assigned',
      'agent',
      'staff',
    ], columnMapping?.assignedTo);

    let assignedUserId: string | null = null;
    if (rawAssigned) {
      const trimmed = rawAssigned.trim().toLowerCase();
      const matchedProfile = profiles.find(p =>
        p.id === rawAssigned ||
        p.full_name.toLowerCase() === trimmed ||
        (p.email && p.email.toLowerCase() === trimmed)
      );
      if (matchedProfile) {
        assignedUserId = matchedProfile.id;
      }
    }

    const rawBirthDate = getCol(row, [
      'birthdate',
      'dob',
      'dateofbirth',
      'birthday',
    ], columnMapping?.birthDate);
    const date_of_birth = parseCsvBirthDate(rawBirthDate);

    const rawAddress = getCol(row, [
      'address',
      'mailingaddress',
      'streetaddress',
      'fulladdress',
    ], columnMapping?.address);
    const multiAddr = parseMultiLineAddress((row as Record<string, unknown> & { _address_lines?: string[] })._address_lines || [rawAddress].filter(Boolean));
    const colLine1 = getCsvColumnValue(row, ['addressline1', 'address1', 'street', 'street1']);
    const colLine2 = getCsvColumnValue(row, ['addressline2', 'address2', 'apt', 'suite', 'unit']);
    const colCity = getCsvColumnValue(row, ['city', 'town']);
    const colState = getCsvColumnValue(row, ['state', 'st', 'province']);
    const colZip = getCsvColumnValue(row, ['zipcode', 'zip', 'postalcode', 'postal']);

    const address_line1 = colLine1 || multiAddr.address_line1;
    const address_line2 = colLine2 || multiAddr.address_line2;
    const city = colCity || multiAddr.city;
    const state = (colState || multiAddr.state).toUpperCase();
    const zip_code = colZip || multiAddr.zip_code;

    const incomingPhoneDigits = phone.replace(/\D/g, '').slice(-10);
    const incomingNameNorm = normalizeName(fullName);
    const matchKey = `${incomingPhoneDigits}::${incomingNameNorm}`;
    const existingMatch = existingMap.get(matchKey);

    roleCounts[role]++;

    if (existingMatch && !seenUpdateIds.has(existingMatch.id)) {
      seenUpdateIds.add(existingMatch.id);
      const updatedTags = setCustomerRoleTag(existingMatch.tags, role);
      readyToUpdate.push({
        id: existingMatch.id,
        full_name: fullName,
        phone,
        email: cleanEmail || existingMatch.email || '',
        date_of_birth: date_of_birth || existingMatch.date_of_birth || null,
        address_line1: address_line1 || existingMatch.address_line1 || '',
        address_line2: address_line2 || existingMatch.address_line2 || '',
        city: city || existingMatch.city || '',
        state: state || existingMatch.state || '',
        zip_code: zip_code || existingMatch.zip_code || '',
        role,
        tags: updatedTags,
        send_whatsapp,
        assigned_user_id: assignedUserId || existingMatch.assigned_user_id || currentUserId || null,
        preferred_language: preferred_language || (existingMatch as Customer).preferred_language || 'es',
      });
    } else {
      readyToImport.push({
        full_name: fullName,
        phone,
        email: cleanEmail,
        notes: '',
        tags: [role],
        company_id: isGlobal ? null : (targetCompanyId || null),
        assigned_user_id: assignedUserId || currentUserId || null,
        is_global: isGlobal,
        send_whatsapp,
        address_line1,
        address_line2,
        city,
        state,
        zip_code,
        date_of_birth,
        role,
        preferred_language,
      });
    }
  }

  return {
    totalRows: rows.length,
    readyToImport,
    readyToUpdate,
    skippedNoValidPhone,
    skippedNoEmail,
    skippedNoName,
    roleCounts,
  };
}

export async function batchImportCustomers(
  inserts: CsvCustomerInsertRow[],
  updates: CsvCustomerUpdateRow[],
  actorId: string | null,
): Promise<{ inserted: number; updated: number; failed: number }> {
  let inserted = 0;
  let updatedCount = 0;
  let failed = 0;

  if (inserts.length > 0) {
    const now = new Date().toISOString();
    const payloads = inserts.map((row) => ({
      full_name: row.full_name,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      tags: row.tags,
      company_id: row.company_id,
      assigned_user_id: row.assigned_user_id || actorId,
      is_global: row.is_global,
      send_whatsapp: row.send_whatsapp,
      address_line1: row.address_line1,
      address_line2: row.address_line2,
      city: row.city,
      state: row.state,
      zip_code: row.zip_code,
      date_of_birth: row.date_of_birth,
      preferred_language: row.preferred_language || 'es',
      created_by: actorId,
      created_at: now,
      updated_at: now,
    }));

    const CHUNK_SIZE = 100;
    for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
      const chunk = payloads.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('customers')
        .insert(chunk)
        .select('id');

      if (!error) {
        inserted += data?.length ?? chunk.length;
      } else {
        for (const single of chunk) {
          const { error: singleErr } = await supabase.from('customers').insert(single);
          if (singleErr) failed++;
          else inserted++;
        }
      }
    }
  }

  if (updates.length > 0) {
    const now = new Date().toISOString();
    for (const upRow of updates) {
      const updatePayload: Record<string, unknown> = {
        full_name: upRow.full_name,
        phone: upRow.phone,
        email: upRow.email,
        date_of_birth: upRow.date_of_birth,
        address_line1: upRow.address_line1,
        address_line2: upRow.address_line2,
        city: upRow.city,
        state: upRow.state,
        zip_code: upRow.zip_code,
        tags: upRow.tags,
        send_whatsapp: upRow.send_whatsapp,
        ...(upRow.assigned_user_id !== undefined ? { assigned_user_id: upRow.assigned_user_id } : {}),
        preferred_language: upRow.preferred_language || 'es',
        updated_at: now,
      };

      const { error: updErr } = await supabase
        .from('customers')
        .update(updatePayload)
        .eq('id', upRow.id);

      if (updErr) {
        failed++;
      } else {
        updatedCount++;
      }
    }
  }

  const totalProcessed = inserted + updatedCount;
  if (totalProcessed > 0) {
    await logAudit(
      'IMPORT',
      'customers',
      `CSV imported ${inserted} new, updated ${updatedCount} customer${totalProcessed !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`,
      null,
      { inserted, updated: updatedCount, failed, is_global: inserts[0]?.is_global ?? false, company_id: inserts[0]?.company_id ?? null },
      actorId,
    );
  }

  return { inserted, updated: updatedCount, failed };
}

export async function batchInsertCustomers(
  rows: CsvCustomerInsertRow[],
  actorId: string | null,
): Promise<{ inserted: number; failed: number }> {
  const res = await batchImportCustomers(rows, [], actorId);
  return { inserted: res.inserted, failed: res.failed };
}
