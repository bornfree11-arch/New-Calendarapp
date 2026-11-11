import { supabase } from '@/lib/supabase';
import { Appointment, Profile, Company, AppointmentTypeMapping, CompanySnapshot, Task, Subtask, TaskStatusHistoryEntry, TaskActionCategory, TaskStatus, ReminderAttempt, DeliveryAlert, DeliveryFailureWithDetails, FocusSession, FocusSessionTask, Customer } from '@/types';
import { isDummyPhoneNumber } from '@/lib/dateUtils';

export interface AuditEntry {
  id: string;
  user_id: string | null;
  action_type: string;
  table_name: string;
  record_id: string | null;
  change_summary: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
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
  return (data || []) as Profile[];
}

export async function saveProfile(profile: Partial<Profile> & { id?: string }, actorId: string | null): Promise<Profile> {
  if (profile.id) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', profile.id)
      .maybeSingle<Profile>();

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...profile, updated_at: new Date().toISOString() })
      .eq('id', profile.id)
      .select('*')
      .single<Profile>();
    if (error) throw error;
    if (existing) {
      await logAudit('UPDATE', 'profiles', `Updated user "${data.full_name}"`, existing as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, actorId);
    }
    return data;
  }

  const { data, error } = await supabase
    .from('profiles')
    .insert({ ...profile, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('*')
    .single<Profile>();
  if (error) throw error;
  await logAudit('INSERT', 'profiles', `Created user "${data.full_name}"`, null, data as unknown as Record<string, unknown>, actorId);
  return data;
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
      .single<Appointment>();
    if (error) throw error;
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
  if (error) throw error;
  await logAudit('INSERT', 'appointments', `Created appointment for "${data.client_name}"`, null, data as unknown as Record<string, unknown>, actorId);
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

export async function getCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as Company[];
}

export async function saveCompany(company: Partial<Company> & { id?: string }, actorId: string | null): Promise<Company> {
  if (company.id) {
    const { data, error } = await supabase
      .from('companies')
      .update({ ...company, updated_at: new Date().toISOString() })
      .eq('id', company.id)
      .select('*')
      .single<Company>();
    if (error) throw error;
    await logAudit('UPDATE', 'companies', `Updated company "${data.name}"`, null, data as unknown as Record<string, unknown>, actorId);
    return data;
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({ ...company, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('*')
    .single<Company>();
  if (error) throw error;
  await logAudit('INSERT', 'companies', `Created company "${data.name}"`, null, data as unknown as Record<string, unknown>, actorId);
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
    await logAudit('UPDATE', 'appointment_type_mappings', `Updated mapping for "${appointmentType}"`, null, { ...existing, company_id: companyId } as unknown as Record<string, unknown>, actorId);
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
    .from('tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []) as Task[];
}

export async function getTasksByDateRange(startDate: string, endDate: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data || []) as Task[];
}

export async function getTasksByDate(date: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('due_date', date)
    .order('status', { ascending: true });
  if (error) throw error;
  return (data || []) as Task[];
}

export async function getTaskDetails(taskId: string): Promise<{ task: Task | null; subtasks: Subtask[]; history: TaskStatusHistoryEntry[] }> {
  const [taskRes, subtasksRes, historyRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('id', taskId).maybeSingle<Task>(),
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
    .from('tasks')
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
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single<Task>();
  if (error) throw error;
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
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
  let apptMap = new Map<string, Appointment>();
  if (apptIds.length > 0) {
    const { data: appts } = await supabase
      .from('appointments')
      .select('*')
      .in('id', apptIds);
    (appts || []).forEach((a: Appointment) => apptMap.set(a.id, a));
  }

  // Fetch agent profiles for all appointments
  const agentIdsFromAppts = [...new Set([...apptMap.values()].map(a => a.assigned_to))];
  let agentMap = new Map<string, Profile>();
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
      appointment: appt,
      profile,
      parent_attempt_id: attemptId,
    }),
  });

  if (!response.ok) {
    return { success: false, error: `Retry request failed (${response.status})` };
  }

  const result = await response.json();

  if (result.status === 'sent') {
    return { success: true, attempt_id: result.attempt_id || null };
  }

  return { success: false, error: result.error || 'Retry send failed.' };
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

export async function getCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data || []) as Customer[];
}

export async function searchCustomers(query: string): Promise<Customer[]> {
  if (!query.trim()) return getCustomers();
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
    .order('full_name', { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data || []) as Customer[];
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

  const { data, error } = await supabase
    .from('customers')
    .insert({ ...customer, created_by: actorId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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

  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
  if (deleted) {
    await logAudit('DELETE', 'customers', `Deleted customer "${deleted.full_name}"`, deleted as unknown as Record<string, unknown>, null, actorId);
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds an existing customer that matches the given name/phone/email.
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
): Promise<Customer | null> {
  const trimmedName = (name || '').trim();
  const trimmedEmail = (email || '').trim();

  // 1. Phone match (valid, non-dummy 10-digit)
  const phoneDigits = (phone || '').replace(/\D/g, '');
  const hasRealPhone = phoneDigits.length === 10 && !isDummyPhoneNumber(phoneDigits);
  if (hasRealPhone) {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .maybeSingle<Customer>();
    if (data) return data;
  }

  // 2. Email match
  if (trimmedEmail) {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('email', trimmedEmail.toLowerCase())
      .maybeSingle<Customer>();
    if (data) return data;
  }

  // 3. Name match — only when no real phone or email available
  if (!hasRealPhone && !trimmedEmail && trimmedName) {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .ilike('full_name', trimmedName)
      .maybeSingle<Customer>();
    if (data && normalizeName(data.full_name) === normalizeName(trimmedName)) {
      return data;
    }
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
  const blankableFields: (keyof Customer)[] = ['phone', 'email', 'notes', 'address_line1', 'address_line2', 'city', 'state', 'zip_code'];
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
