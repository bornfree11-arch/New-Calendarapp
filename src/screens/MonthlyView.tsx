import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
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
  ChevronDown,
  CalendarDays,
  LogOut,
  Search,
  Users,
  Building2,
  FileText,
  ScrollText,
  Bell,
  Loader2,
  ListTodo,
} from 'lucide-react';

interface MonthlyViewProps {
  onSelectDate: (date: Date) => void;
  onOpenSearch: () => void;
  onOpenUserManagement: () => void;
  onOpenCompanyManagement: () => void;
  onOpenAuditLog: () => void;
  onOpenReminderStatus: () => void;
  onOpenExport: () => void;
  onOpenTasks: () => void;
  onOpenTask: (taskId: string) => void;
  onNewTask: () => void;
  dataVersion: number;
}

export function MonthlyView({
  onSelectDate,
  onOpenSearch,
  onOpenUserManagement,
  onOpenCompanyManagement,
  onOpenAuditLog,
  onOpenReminderStatus,
  onOpenExport,
  onOpenTasks,
  onOpenTask,
  onNewTask,
  dataVersion,
}: MonthlyViewProps) {
  const { profile, signOut } = useAuth();
  const [centerDate, setCenterDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdminMenu, setShowAdminMenu] = useState(false);
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

  const isAdmin = profile?.role === 'admin';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center shrink-0">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-base font-semibold text-slate-800 truncate hidden sm:block">
              Shared Calendar
            </h1>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={onOpenTasks}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              <ListTodo className="w-4 h-4" />
              <span className="hidden sm:inline">Tasks</span>
            </button>

            <button
              onClick={onOpenSearch}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search</span>
            </button>

            {isAdmin && (
              <div className="relative">
                <button
                  onClick={() => setShowAdminMenu(!showAdminMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  <span className="hidden sm:inline">Admin</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showAdminMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowAdminMenu(false)}
                    />
                    <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-40 py-1.5">
                      <AdminMenuItem icon={<Users className="w-4 h-4" />} label="User Management" onClick={() => { onOpenUserManagement(); setShowAdminMenu(false); }} />
                      <AdminMenuItem icon={<Building2 className="w-4 h-4" />} label="Company Management" onClick={() => { onOpenCompanyManagement(); setShowAdminMenu(false); }} />
                      <AdminMenuItem icon={<ScrollText className="w-4 h-4" />} label="Audit Log" onClick={() => { onOpenAuditLog(); setShowAdminMenu(false); }} />
                      <AdminMenuItem icon={<Bell className="w-4 h-4" />} label="Reminder Status" onClick={() => { onOpenReminderStatus(); setShowAdminMenu(false); }} />
                      <AdminMenuItem icon={<FileText className="w-4 h-4" />} label="Export CSV" onClick={() => { onOpenExport(); setShowAdminMenu(false); }} />
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={() => signOut()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Log Out</span>
            </button>
          </div>
        </div>
      </header>

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

function AdminMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
    >
      {icon}
      {label}
    </button>
  );
}
