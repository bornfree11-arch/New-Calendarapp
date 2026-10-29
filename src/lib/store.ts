import { supabase } from '@/lib/supabase';
import { Appointment, Profile, Company, AppointmentTypeMapping, CompanySnapshot, Task, Subtask, TaskStatusHistoryEntry, TaskActionCategory, TaskStatus } from '@/types';

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
