import { supabase } from '@/lib/supabase';
import { Appointment, Profile, Company, AppointmentTypeMapping, CompanySnapshot, Task, Subtask, TaskStatusHistoryEntry, TaskActionCategory, TaskStatus, ReminderAttempt, DeliveryAlert, DeliveryFailureWithDetails, FocusSession, FocusSessionTask, Customer, CustomerRole, CUSTOMER_ROLES } from '@/types';
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
    const { data, error } = await supabase
      .from('calendar_companies')
      .update({ ...company, updated_at: new Date().toISOString() })
      .eq('id', company.id)
      .select('*')
      .single<Company>();
    if (error) throw error;
    await logAudit('UPDATE', 'calendar_companies', `Updated company "${data.name}"`, null, data as unknown as Record<string, unknown>, actorId);
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

export function isCustomerVisibleForCompany(
  customer: Pick<Customer, 'company_id' | 'is_global'>,
  selectedCompanyId?: string | null,
): boolean {
  if (customer.is_global) return true;
  if (!selectedCompanyId) return false;
  return customer.company_id === selectedCompanyId;
}

export async function getCustomers(selectedCompanyId?: string | null): Promise<Customer[]> {
  let query = supabase
    .from('customers')
    .select('*');

  if (selectedCompanyId) {
    query = query.or(`company_id.eq.${selectedCompanyId},is_global.eq.true`);
  } else {
    query = query.eq('is_global', true);
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
    q = selectedCompanyId ? q.or(`company_id.eq.${selectedCompanyId},is_global.eq.true`) : q.eq('is_global', true);
    const { data } = await q.limit(10);
    const match = pickBestScopedCustomer(data as Customer[] | null, selectedCompanyId);
    if (match) return match;
  }

  // 2. Email match
  if (trimmedEmail) {
    let q = supabase.from('customers').select('*').eq('email', trimmedEmail.toLowerCase());
    q = selectedCompanyId ? q.or(`company_id.eq.${selectedCompanyId},is_global.eq.true`) : q.eq('is_global', true);
    const { data } = await q.limit(10);
    const match = pickBestScopedCustomer(data as Customer[] | null, selectedCompanyId);
    if (match) return match;
  }

  // 3. Name match — only when no real phone or email available
  if (!hasRealPhone && !trimmedEmail && trimmedName) {
    let q = supabase.from('customers').select('*').ilike('full_name', trimmedName);
    q = selectedCompanyId ? q.or(`company_id.eq.${selectedCompanyId},is_global.eq.true`) : q.eq('is_global', true);
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

export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = csvText.replace(/^\uFEFF/, '');
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
    } else if (ch === ',') {
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

  const headers = rawRows[0].map((h, idx) => h.trim() || `column_${idx + 1}`);
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const values = rawRows[r];
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      const val = (values[idx] || '').trim();
      if (val) hasValue = true;
      obj[header] = val;
    });
    if (hasValue) rows.push(obj);
  }

  return { headers, rows };
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
}

export interface CsvImportPreview {
  totalRows: number;
  readyToImport: CsvCustomerInsertRow[];
  skippedNoEmail: number;
  skippedNoName: number;
  duplicatesSkipped: number;
  roleCounts: Record<CustomerRole, number>;
}

export function buildCsvImportPreview(params: {
  rows: Record<string, string>[];
  existingCustomers: Customer[];
  onlyWithValidEmail: boolean;
  targetCompanyId: string | null;
  isGlobal: boolean;
}): CsvImportPreview {
  const { rows, existingCustomers, onlyWithValidEmail, targetCompanyId, isGlobal } = params;

  const existingKeys = new Set<string>();
  for (const existing of existingCustomers) {
    const scopeMatch = isGlobal
      ? existing.is_global
      : existing.company_id === targetCompanyId || existing.is_global;
    if (!scopeMatch) continue;
    const key = `${normalizeName(existing.full_name || '')}::${(existing.email || '').trim().toLowerCase()}`;
    existingKeys.add(key);
  }

  const readyToImport: CsvCustomerInsertRow[] = [];
  let skippedNoEmail = 0;
  let skippedNoName = 0;
  let duplicatesSkipped = 0;
  const roleCounts: Record<CustomerRole, number> = {
    Taxpayer: 0,
    Spouse: 0,
    Dependent: 0,
    Other: 0,
  };

  for (const row of rows) {
    let rawName = getCsvColumnValue(row, [
      'clientname',
      'fullname',
      'name',
      'customername',
      'taxpayername',
      'contactname',
    ]);
    if (!rawName) {
      const first = getCsvColumnValue(row, ['firstname', 'first', 'fname']);
      const last = getCsvColumnValue(row, ['lastname', 'last', 'lname']);
      rawName = [first, last].filter(Boolean).join(' ');
    }
    const fullName = rawName.trim().replace(/\s+/g, ' ');
    if (!fullName) {
      skippedNoName++;
      continue;
    }

    const rawEmail = getCsvColumnValue(row, ['email', 'emailaddress', 'primaryemail']).trim();
    const hasValidEmail = rawEmail.length > 0 && isValidEmail(rawEmail);

    if (onlyWithValidEmail && !hasValidEmail) {
      skippedNoEmail++;
      continue;
    }

    const cleanEmail = hasValidEmail ? rawEmail.toLowerCase() : '';
    const dedupeKey = `${normalizeName(fullName)}::${cleanEmail}`;
    if (existingKeys.has(dedupeKey)) {
      duplicatesSkipped++;
      continue;
    }
    existingKeys.add(dedupeKey);

    const rawType = getCsvColumnValue(row, [
      'type',
      'role',
      'contacttype',
      'relationship',
      'clienttype',
      'tag',
      'tags',
      'category',
    ]);
    const role = normalizeCustomerRole(rawType);

    const rawBirthDate = getCsvColumnValue(row, [
      'birthdate',
      'dob',
      'dateofbirth',
      'birthday',
    ]);
    const date_of_birth = parseCsvBirthDate(rawBirthDate);

    const rawAddress = getCsvColumnValue(row, [
      'address',
      'mailingaddress',
      'streetaddress',
      'fulladdress',
    ]);
    const parsedAddr = parseCsvAddress(rawAddress);
    const colLine1 = getCsvColumnValue(row, ['addressline1', 'address1', 'street', 'street1']);
    const colLine2 = getCsvColumnValue(row, ['addressline2', 'address2', 'apt', 'suite', 'unit']);
    const colCity = getCsvColumnValue(row, ['city', 'town']);
    const colState = getCsvColumnValue(row, ['state', 'st', 'province']);
    const colZip = getCsvColumnValue(row, ['zipcode', 'zip', 'postalcode', 'postal']);

    const address_line1 = colLine1 || parsedAddr.address_line1;
    const address_line2 = colLine2 || parsedAddr.address_line2;
    const city = colCity || parsedAddr.city;
    const state = (colState || parsedAddr.state).toUpperCase();
    const zip_code = colZip || parsedAddr.zip_code;

    const rawPhone = getCsvColumnValue(row, [
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
    ]);
    const { phone, send_whatsapp } = parseCsvPhone(rawPhone);

    roleCounts[role]++;
    readyToImport.push({
      full_name: fullName,
      phone,
      email: cleanEmail,
      notes: '',
      tags: [role],
      company_id: isGlobal ? null : (targetCompanyId || null),
      assigned_user_id: null,
      is_global: isGlobal,
      send_whatsapp,
      address_line1,
      address_line2,
      city,
      state,
      zip_code,
      date_of_birth,
      role,
    });
  }

  return {
    totalRows: rows.length,
    readyToImport,
    skippedNoEmail,
    skippedNoName,
    duplicatesSkipped,
    roleCounts,
  };
}

export async function batchInsertCustomers(
  rows: CsvCustomerInsertRow[],
  actorId: string | null,
): Promise<{ inserted: number; failed: number }> {
  if (rows.length === 0) return { inserted: 0, failed: 0 };

  const now = new Date().toISOString();
  const payloads = rows.map((row) => ({
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    tags: row.tags,
    company_id: row.company_id,
    assigned_user_id: row.assigned_user_id,
    is_global: row.is_global,
    send_whatsapp: row.send_whatsapp,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    date_of_birth: row.date_of_birth,
    created_by: actorId,
    created_at: now,
    updated_at: now,
  }));

  let inserted = 0;
  let failed = 0;
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
      // Fallback row-by-row so one bad row doesn't fail the whole chunk
      for (const single of chunk) {
        const { error: singleErr } = await supabase.from('customers').insert(single);
        if (singleErr) failed++;
        else inserted++;
      }
    }
  }

  if (inserted > 0) {
    await logAudit(
      'IMPORT',
      'customers',
      `CSV imported ${inserted} customer${inserted !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`,
      null,
      { inserted, failed, is_global: rows[0]?.is_global ?? false, company_id: rows[0]?.company_id ?? null },
      actorId,
    );
  }

  return { inserted, failed };
}
