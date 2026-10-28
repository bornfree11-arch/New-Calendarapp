export type UserRole = 'admin' | 'coworker';
export type UserStatus = 'active' | 'inactive';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  notes: string;
  calendar_color: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppointmentTypeMapping {
  id: string;
  appointment_type: AppointmentType;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AppointmentType = 'Tax/Accounting' | 'ACA' | 'Medicare' | 'Life' | 'Other';
export type AppointmentStatus = 'Scheduled' | 'Completed' | 'Cancelled' | 'No-show';
export type DurationMinutes = 30 | 60 | 90 | 120;

export interface CompanySnapshot {
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string | null;
}

export interface Appointment {
  id: string;
  appointment_date: string;
  start_time: string;
  duration_minutes: DurationMinutes;
  end_time: string;
  appointment_type: AppointmentType;
  client_name: string;
  client_phone: string;
  client_email: string;
  notes: string;
  assigned_to: string;
  company_id: string | null;
  company_snapshot: CompanySnapshot | null;
  status: AppointmentStatus;
  created_by: string | null;
  last_modified_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentWithDetails extends Appointment {
  assigned_profile?: Profile;
  company?: Company | null;
}

export interface AppSettings {
  id: number;
  business_timezone: string;
}

export const APPOINTMENT_TYPES: AppointmentType[] = [
  'Tax/Accounting',
  'ACA',
  'Medicare',
  'Life',
  'Other',
];

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'Scheduled',
  'Completed',
  'Cancelled',
  'No-show',
];

export const DURATIONS: DurationMinutes[] = [30, 60, 90, 120];

export type TaskActionCategory = 'Call' | 'Email' | 'Text' | 'Personal' | 'Other';
export type TaskStatus = 'Not Started' | 'In Progress' | 'On Hold' | 'Cancelled' | 'Completed';

export const TASK_ACTION_CATEGORIES: TaskActionCategory[] = [
  'Call', 'Email', 'Text', 'Personal', 'Other',
];

export const TASK_STATUSES: TaskStatus[] = [
  'Not Started', 'In Progress', 'On Hold', 'Cancelled', 'Completed',
];

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskStatusHistoryEntry {
  id: string;
  task_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  action_category: TaskActionCategory;
  notes: string;
  due_date: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskWithDetails extends Task {
  subtasks?: Subtask[];
  status_history?: TaskStatusHistoryEntry[];
}

export const COLOR_PALETTE: { name: string; value: string }[] = [
  { name: 'Teal', value: '#2A9D8F' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#6BAA75' },
  { name: 'Amber', value: '#E0A458' },
  { name: 'Coral', value: '#E07856' },
  { name: 'Rose', value: '#D65D7A' },
  { name: 'Slate', value: '#6B7B8D' },
  { name: 'Sage', value: '#87A96B' },
  { name: 'Brown', value: '#A0826D' },
  { name: 'Steel', value: '#5B8BA0' },
  { name: 'Plum', value: '#9B6A8C' },
  { name: 'Olive', value: '#8A8B3F' },
  { name: 'Yellow', value: '#FACC15' },
  { name: 'Pale Blue', value: '#93C5FD' },
];

export function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

export const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 7; h <= 18; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 19 && m > 0) break;
      const hour = h;
      const min = m;
      slots.push(
        `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00`
      );
    }
  }
  // Add 18:30 but stop at 19:00
  return slots.filter(s => s <= '18:30:00');
})();
