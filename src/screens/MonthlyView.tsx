import { useState, useEffect, useCallback } from 'react';
import { getProfiles, getAppointmentsByDateRange, getTasksByDateRange } from '@/lib/store';
import { Appointment, Profile } from '@/types';
import { MonthCalendar } from '@/components/MonthCalendar';
import { ColorLegend } from '@/components/ColorLegend';
import { CompactTaskList } from '@/components/CompactTaskList';
import { Task } from '@/types';
import {
  addMonths,
  formatDateISO,
  MONTH_NAMES,
} from '@/lib/dateUtils';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';

interface MonthlyViewProps {
  onSelectDate: (date: Date) => void;
  onOpenTasks: () => void;
  onOpenTask: (taskId: string) => void;
  onNewTask: () => void;
  dataVersion: number;
}

export function MonthlyView({
  onSelectDate,
  onOpenTasks,
  onOpenTask,
  onNewTask,
  dataVersion,
}: MonthlyViewProps) {
  const [centerDate, setCenterDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    const prevMonth = addMonths(centerDate, -1);
    const nextMonth = addMonths(centerDate, 1);
    const startDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
    const endDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);

    try {
      const [a, t] = await Promise.all([
        getAppointmentsByDateRange(formatDateISO(startDate), formatDateISO(endDate)),
        getTasksByDateRange(formatDateISO(startDate), formatDateISO(endDate)),
      ]);
      setAppointments(a);
      setTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [centerDate]);

  useEffect(() => { loadProfiles(); }, [loadProfiles, dataVersion]);
  useEffect(() => { loadAppointments(); }, [loadAppointments, dataVersion]);

  const prevMonth = addMonths(centerDate, -1);
  const nextMonth = addMonths(centerDate, 1);

  function handleMonthNav(direction: -1 | 1) {
    setCenterDate(addMonths(centerDate, direction));
  }

  function handleToday() {
    setCenterDate(new Date());
  }

  function handleSideMonthClick(date: Date) {
    const newCenter = new Date(date.getFullYear(), date.getMonth(), 15);
    setCenterDate(newCenter);
  }

  function handleDateClick(date: Date) {
    setSelectedDate(date);
    onSelectDate(date);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleMonthNav(-1)}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </button>
            <button
              onClick={handleToday}
              className="px-4 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition"
            >
              Today
            </button>
            <button
              onClick={() => handleMonthNav(1)}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition"
              aria-label="Next month"
            >
              <ChevronRight className="w-5 h-5 text-slate-600" />
            </button>
          </div>
          <h2 className="text-lg font-semibold text-slate-800">
            {MONTH_NAMES[centerDate.getMonth()]} {centerDate.getFullYear()}
          </h2>
          <div className="w-24" />
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_1.6fr_1fr]'}`}>
          {!isMobile && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <MonthCalendar
                year={prevMonth.getFullYear()}
                month={prevMonth.getMonth()}
                appointments={appointments}
                profiles={profiles}
                tasks={tasks}
                selectedDate={selectedDate}
                onDateClick={handleSideMonthClick}
                compact
              />
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-4 lg:p-6">
            {loading && (
              <div className="text-center py-8 text-slate-400 text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading calendar...
              </div>
            )}
            <MonthCalendar
              year={centerDate.getFullYear()}
              month={centerDate.getMonth()}
              appointments={appointments}
              profiles={profiles}
              tasks={tasks}
              selectedDate={selectedDate}
              onDateClick={handleDateClick}
              onTaskClick={onOpenTask}
            />
          </div>

          {!isMobile && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <MonthCalendar
                  year={nextMonth.getFullYear()}
                  month={nextMonth.getMonth()}
                  appointments={appointments}
                  profiles={profiles}
                  tasks={tasks}
                  selectedDate={selectedDate}
                  onDateClick={handleSideMonthClick}
                  compact
                />
              </div>
            </div>
          )}
        </div>

        {isMobile && (
          <div className="mt-4">
            <ColorLegend profiles={profiles} />
          </div>
        )}

        {!isMobile && (
          <div className="mt-4 flex items-start gap-4">
            <div className="flex-1 max-w-md">
              <CompactTaskList
                onOpenTask={onOpenTask}
                onOpenTasksScreen={onOpenTasks}
                onNewTask={onNewTask}
                dataVersion={dataVersion}
              />
            </div>
            <div className="w-56 shrink-0 ml-auto">
              <ColorLegend profiles={profiles} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
