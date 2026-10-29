import { useState, useEffect, useMemo, useCallback } from 'react';
import { getProfiles, getAppointmentsByDate, getTasks } from '@/lib/store';
import { Appointment, Profile, AppointmentStatus, isLightColor, Task, TaskStatus } from '@/types';
import {
  formatDateISO,
  formatTime12,
  formatDateLong,
  formatDateMedium,
  addDays,
  parseDateISO,
} from '@/lib/dateUtils';
import { ColorLegend } from '@/components/ColorLegend';
import { CATEGORY_COLORS, STATUS_COLORS } from '@/components/TaskDetailsModal';
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Clock,
  Loader2,
  Plus,
} from 'lucide-react';

interface DailyViewProps {
  date: Date;
  onBackToMonthly: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onSlotClick: (date: Date, startTime: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onTaskClick: (taskId: string) => void;
  onAddTask: (defaultDate: Date) => void;
  dataVersion: number;
}

const STATUS_BORDER: Record<AppointmentStatus, string> = {
  'Scheduled': 'ring-1 ring-slate-200',
  'Completed': 'ring-1 ring-green-300',
  'Cancelled': 'ring-1 ring-red-300 opacity-60',
  'No-show': 'ring-1 ring-amber-300',
};

const INCOMPLETE_STATUSES: TaskStatus[] = ['Not Started', 'In Progress', 'On Hold'];

export function DailyView({
  date,
  onBackToMonthly,
  onPrevDay,
  onNextDay,
  onSlotClick,
  onAppointmentClick,
  onTaskClick,
  onAddTask,
  dataVersion,
}: DailyViewProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dailyTasks, setDailyTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');



  const loadProfiles = useCallback(async () => {
    try {
      const p = await getProfiles();
      setProfiles(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, t] = await Promise.all([
        getAppointmentsByDate(formatDateISO(date)),
        getTasks(),
      ]);
      setAppointments(a);
      setDailyTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { loadProfiles(); }, [loadProfiles, dataVersion]);
  useEffect(() => { loadAppointments(); }, [loadAppointments, dataVersion]);

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach(p => map.set(p.id, p));
    return map;
  }, [profiles]);

  const selectedISO = formatDateISO(date);
  const realTodayISO = formatDateISO(new Date());
  const tomorrowOfSelectedISO = formatDateISO(addDays(date, 1));

  const incompleteTasks = useMemo(
    () => dailyTasks.filter(t => INCOMPLETE_STATUSES.includes(t.status) && t.due_date !== null),
    [dailyTasks]
  );

  const sortByDueDate = (a: Task, b: Task) =>
    (a.due_date || '') < (b.due_date || '') ? -1 : (a.due_date || '') > (b.due_date || '') ? 1 : 0;

  const pastDueTasks = useMemo(
    () => incompleteTasks
      .filter(t => (t.due_date || '') < realTodayISO)
      .sort(sortByDueDate),
    [incompleteTasks, realTodayISO]
  );

  const todayTasks = useMemo(
    () => incompleteTasks
      .filter(t => (t.due_date || '') === selectedISO)
      .sort(sortByDueDate),
    [incompleteTasks, selectedISO]
  );

  const tomorrowTasks = useMemo(
    () => incompleteTasks
      .filter(t => (t.due_date || '') === tomorrowOfSelectedISO)
      .sort(sortByDueDate),
    [incompleteTasks, tomorrowOfSelectedISO]
  );

  const hasAnyTask = pastDueTasks.length > 0 || todayTasks.length > 0 || tomorrowTasks.length > 0;

  const timeSlots = useMemo(() => {
    const slots: { time: string; label: string }[] = [];
    for (let h = 7; h <= 19; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 19 && m > 0) break;
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`;
        slots.push({ time: timeStr, label: formatTime12(timeStr) });
      }
    }
    return slots;
  }, []);

  const { apptLane, laneCount } = useMemo(() => {
    const sorted = [...appointments].sort((a, b) =>
      a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0
    );
    const lanes: string[] = [];
    const apptLaneMap = new Map<string, number>();
    for (const appt of sorted) {
      let assigned = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= appt.start_time) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = lanes.length;
        lanes.push(appt.end_time);
      } else {
        lanes[assigned] = appt.end_time;
      }
      apptLaneMap.set(appt.id, assigned);
    }
    return { apptLane: apptLaneMap, laneCount: Math.max(lanes.length, 1) };
  }, [appointments]);

  function getApptsStartingAt(slotTime: string): Appointment[] {
    return appointments.filter(a => a.start_time === slotTime);
  }

  function getApptsAtSlot(slotTime: string): Appointment[] {
    return appointments.filter(
      a => a.start_time <= slotTime && a.end_time > slotTime
    );
  }

  function getApptHeight(appt: Appointment): number {
    const slots = appt.duration_minutes / 30;
    return slots * 48;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-14 z-10 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={onPrevDay}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Previous Day</span>
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={onBackToMonthly}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-600 hover:bg-teal-50 rounded-lg transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Monthly</span>
              </button>
              <div className="text-center">
                <div className="text-lg font-semibold text-slate-800">{formatDateLong(date)}</div>
                <div className="text-sm text-slate-500">
                  {appointments.filter(a => a.status !== 'Cancelled').length} appointment{appointments.filter(a => a.status !== 'Cancelled').length !== 1 ? 's' : ''} today
                </div>
              </div>
            </div>
            <button
              onClick={onNextDay}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition shadow-sm"
            >
              <span className="hidden sm:inline">Next Day</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 py-4">
        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="lg:mr-64">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading appointments...
            </div>
          ) : (
            <div className="relative">
              {timeSlots.map((slot) => {
                const startingAppts = getApptsStartingAt(slot.time);
                const occupyingAppts = getApptsAtSlot(slot.time);
                const slotOccupied = occupyingAppts.length > 0;
                return (
                  <div
                    key={slot.time}
                    className="flex border-b border-slate-100 last:border-b-0"
                    style={{ minHeight: '48px' }}
                  >
                    <div className="w-20 shrink-0 px-2 py-1 text-xs text-slate-400 text-right border-r border-slate-100 flex items-start">
                      {slot.label}
                    </div>

                    <div
                      className="flex-1 relative"
                      style={{ display: 'flex' }}
                    >
                      {startingAppts.length > 0 ? (
                        startingAppts.map(appt => (
                          <AppointmentBlock
                            key={appt.id}
                            appt={appt}
                            profile={profileMap.get(appt.assigned_to)}
                            height={getApptHeight(appt)}
                            lane={apptLane.get(appt.id) || 0}
                            laneCount={laneCount}
                            onClick={() => onAppointmentClick(appt)}
                          />
                        ))
                      ) : !slotOccupied ? (
                        <button
                          onClick={() => onSlotClick(date, slot.time)}
                          className="flex-1 hover:bg-teal-50 transition group cursor-pointer"
                        >
                          <div className="opacity-0 group-hover:opacity-100 transition flex items-center justify-center h-full text-xs text-teal-600 font-medium">
                            + Book {slot.label}
                          </div>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>

        <div className="mt-4 lg:hidden">
          <ColorLegend profiles={profiles} />
        </div>
      </div>

      <div className="fixed right-6 top-32 w-56 hidden lg:block space-y-4">
        <ColorLegend profiles={profiles} />
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-700">Tasks</h3>
              {hasAnyTask && (
                <span className="text-xs text-slate-400">({pastDueTasks.length + todayTasks.length + tomorrowTasks.length})</span>
              )}
            </div>
            <button
              onClick={() => onAddTask(date)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task</span>
            </button>
          </div>

          {pastDueTasks.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-red-600 mb-1.5 uppercase tracking-wide">Past Due</h4>
              <div className="space-y-2">
                {pastDueTasks.map(task => (
                  <TaskPanelItem key={task.id} task={task} overdue onTaskClick={onTaskClick} />
                ))}
              </div>
            </div>
          )}

          {todayTasks.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Today</h4>
              <div className="space-y-2">
                {todayTasks.map(task => (
                  <TaskPanelItem key={task.id} task={task} onTaskClick={onTaskClick} />
                ))}
              </div>
            </div>
          )}

          {tomorrowTasks.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Tomorrow</h4>
              <div className="space-y-2">
                {tomorrowTasks.map(task => (
                  <TaskPanelItem key={task.id} task={task} onTaskClick={onTaskClick} />
                ))}
              </div>
            </div>
          )}

          {!hasAnyTask && (
            <p className="text-xs text-slate-400 text-center py-2">No pending tasks.</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface TaskPanelItemProps {
  task: Task;
  overdue?: boolean;
  onTaskClick: (taskId: string) => void;
}

function TaskPanelItem({ task, overdue, onTaskClick }: TaskPanelItemProps) {
  const titleColor = overdue ? 'text-red-600' : 'text-slate-800';
  const dateColor = overdue ? 'text-red-500 font-medium' : 'text-slate-400';
  const dueDateLabel = task.due_date ? formatDateMedium(parseDateISO(task.due_date)) : '';

  return (
    <button
      onClick={() => onTaskClick(task.id)}
      className="w-full bg-white rounded-lg border border-slate-200 hover:border-teal-300 hover:shadow-sm transition p-2 text-left flex items-center gap-2"
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${
        task.status === 'In Progress' ? 'bg-blue-500' :
        task.status === 'On Hold' ? 'bg-amber-500' :
        'bg-slate-300'
      }`} />
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-medium block truncate ${titleColor}`}>
          {task.title}
        </span>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <span className={`text-[10px] px-1 py-0.5 rounded ${CATEGORY_COLORS[task.action_category]}`}>
            {task.action_category}
          </span>
          <span className={`text-[10px] px-1 py-0.5 rounded ${STATUS_COLORS[task.status]}`}>
            {task.status}
          </span>
          {dueDateLabel && (
            <span className={`text-[10px] ${dateColor}`}>
              {dueDateLabel}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

interface AppointmentBlockProps {
  appt: Appointment;
  profile?: Profile;
  height: number;
  lane: number;
  laneCount: number;
  onClick: () => void;
}

function AppointmentBlock({ appt, profile, height, lane, laneCount, onClick }: AppointmentBlockProps) {
  const color = profile?.calendar_color || '#6B7B8D';
  const widthPercent = 100 / laneCount;
  const light = isLightColor(color);
  const textColor = light ? 'text-slate-800' : 'text-white';
  const subTextColor = light ? 'text-slate-600' : 'text-white/80';
  const faintTextColor = light ? 'text-slate-500' : 'text-white/70';
  const dotColor = light ? 'bg-slate-400/60' : 'bg-white/70';

  return (
    <button
      onClick={onClick}
      className={`absolute rounded-lg shadow-sm px-3 py-2 text-left overflow-hidden transition hover:shadow-md hover:brightness-95 ${STATUS_BORDER[appt.status]}`}
      style={{
        height: `${height - 2}px`,
        left: `${lane * widthPercent}%`,
        width: `${widthPercent}%`,
        backgroundColor: color,
        zIndex: 1,
      }}
    >
      <div className={`font-semibold text-sm ${textColor} truncate`}>
        {appt.client_name}
      </div>
      <div className={`text-xs ${subTextColor} truncate`}>
        {appt.appointment_type}
      </div>
      <div className={`text-xs ${faintTextColor} flex items-center gap-1 mt-0.5`}>
        <Clock className="w-3 h-3" />
        {formatTime12(appt.start_time)} – {formatTime12(appt.end_time)}
      </div>
      {profile && (
        <div className="text-xs mt-0.5 flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className={`${subTextColor} truncate`}>{profile.full_name}</span>
        </div>
      )}
      <div className={`text-xs ${faintTextColor} mt-0.5`}>{appt.status}</div>
    </button>
  );
}
