import { useMemo } from 'react';
import { Appointment, Profile, Task } from '@/types';
import {
  MONTH_NAMES,
  DAY_NAMES_SHORT,
  DAY_NAMES_MIN,
  getDaysInMonth,
  getFirstDayOfMonth,
  isSameDay,
  isToday,
  formatDateISO,
} from '@/lib/dateUtils';

interface MonthCalendarProps {
  year: number;
  month: number;
  appointments: Appointment[];
  profiles: Profile[];
  tasks?: Task[];
  selectedDate: Date | null;
  onDateClick: (date: Date) => void;
  onTaskClick?: (taskId: string) => void;
  compact?: boolean;
}

export function MonthCalendar({
  year,
  month,
  appointments,
  profiles,
  tasks = [],
  selectedDate,
  onDateClick,
  onTaskClick,
  compact = false,
}: MonthCalendarProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach(p => map.set(p.id, p));
    return map;
  }, [profiles]);

  // Build calendar grid with leading empty cells
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  // Trailing to fill complete weeks
  while (cells.length % 7 !== 0) cells.push(null);

  // Group appointments by date
  const apptsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.forEach(a => {
      if (!map.has(a.appointment_date)) map.set(a.appointment_date, []);
      map.get(a.appointment_date)!.push(a);
    });
    return map;
  }, [appointments]);

  // Group tasks by due date
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach(t => {
      if (!t.due_date) return;
      if (!map.has(t.due_date)) map.set(t.due_date, []);
      map.get(t.due_date)!.push(t);
    });
    return map;
  }, [tasks]);

  const dayNames = compact ? DAY_NAMES_MIN : DAY_NAMES_SHORT;

  return (
    <div className={compact ? 'text-xs' : ''}>
      <div className={`font-semibold text-slate-700 mb-2 ${compact ? 'text-sm' : 'text-lg'}`}>
        {MONTH_NAMES[month]} {year}
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {dayNames.map((day, i) => (
          <div key={i} className={`text-center font-medium text-slate-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className={`${compact ? 'h-7' : 'h-16'} rounded`} />;

          const dateStr = formatDateISO(date);
          const dayAppts = apptsByDate.get(dateStr) || [];
          const dayTasks = tasksByDate.get(dateStr) || [];
          const today = isToday(date);
          const selected = selectedDate && isSameDay(date, selectedDate);
          const hasAppts = dayAppts.length > 0;
          const hasTasks = dayTasks.length > 0;

          return (
            <button
              key={i}
              onClick={() => onDateClick(date)}
              className={`
                ${compact ? 'h-7' : 'h-16'} rounded relative flex flex-col items-center
                transition border
                ${selected
                  ? 'bg-teal-600 text-white border-teal-600 shadow-md'
                  : today
                    ? 'bg-teal-50 text-teal-700 border-teal-300 hover:bg-teal-100'
                    : 'bg-white text-slate-700 border-slate-100 hover:bg-slate-50 hover:border-slate-200'
                }
                ${compact ? 'justify-center text-[11px]' : 'pt-1'}
              `}
            >
              <span className={compact ? 'font-medium' : 'text-sm font-medium'}>
                {date.getDate()}
              </span>
              {!compact && hasAppts && (
                <div className="flex flex-wrap gap-0.5 mt-auto mb-1 justify-center max-w-full overflow-hidden">
                  {dayAppts.slice(0, 5).map((appt) => {
                    const prof = profileMap.get(appt.assigned_to);
                    const color = prof?.calendar_color || '#6B7B8D';
                    return (
                      <div
                        key={appt.id}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: selected ? 'white' : color }}
                      />
                    );
                  })}
                  {dayAppts.length > 5 && (
                    <span className={`text-[9px] ${selected ? 'text-white' : 'text-slate-400'}`}>
                      +{dayAppts.length - 5}
                    </span>
                  )}
                </div>
              )}
              {!compact && hasTasks && (
                <div className="flex flex-wrap gap-0.5 mt-0.5 mb-1 justify-center max-w-full overflow-hidden">
                  {dayTasks.slice(0, 3).map((task) => (
                    <button
                      key={task.id}
                      onClick={(e) => { e.stopPropagation(); onTaskClick?.(task.id); }}
                      className={`text-[8px] px-1 rounded truncate max-w-[50px] ${
                        task.status === 'Completed'
                          ? (selected ? 'bg-white/30 text-white/70' : 'bg-green-50 text-green-600')
                          : (selected ? 'bg-white/20 text-white/90' : 'bg-amber-50 text-amber-700')
                      }`}
                      title={task.title}
                    >
                      {task.title}
                    </button>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className={`text-[8px] ${selected ? 'text-white' : 'text-slate-400'}`}>
                      +{dayTasks.length - 3}
                    </span>
                  )}
                </div>
              )}
              {compact && hasAppts && (
                <div
                  className="absolute bottom-0.5 w-1 h-1 rounded-full"
                  style={{ backgroundColor: selected ? 'white' : '#2A9D8F' }}
                />
              )}
              {compact && hasTasks && (
                <div
                  className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full"
                  style={{ backgroundColor: selected ? 'white' : '#E0A458' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
