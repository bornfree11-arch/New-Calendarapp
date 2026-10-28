import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getTasks } from '@/lib/store';
import { Task, TaskStatus, TASK_STATUSES } from '@/types';
import { TaskDetailsModal } from '@/components/TaskDetailsModal';
import { CATEGORY_COLORS, STATUS_COLORS } from '@/components/TaskDetailsModal';
import { formatDateLong, parseDateISO, formatDateISO, isToday } from '@/lib/dateUtils';
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Plus,
  Check,
  Loader2,
  ListTodo,
  Calendar as CalendarIcon,
} from 'lucide-react';

interface TasksScreenProps {
  onBackToCalendar: () => void;
  onSignOut: () => void;
}

type StatusFilter = 'all' | TaskStatus;

export function TasksScreen({ onBackToCalendar, onSignOut }: TasksScreenProps) {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [modalIsNew, setModalIsNew] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const t = await getTasks();
      setTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks, dataVersion]);

  const filtered = useMemo(() => {
    const list = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
    return [...list].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
  }, [tasks, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const s of TASK_STATUSES) c[s] = 0;
    for (const t of tasks) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [tasks]);

  function openTask(id: string) {
    setModalTaskId(id);
    setModalIsNew(false);
  }

  function openNew() {
    setModalTaskId(null);
    setModalIsNew(true);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-[900px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <button
            onClick={onBackToCalendar}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Calendar</span>
          </button>
          <h1 className="text-base font-semibold text-slate-800 truncate flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-teal-600" />
            Tasks
          </h1>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </header>

      <div className="max-w-[900px] mx-auto px-4 py-4">
        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip label="All" count={counts.all} active={filter === 'all'} onClick={() => setFilter('all')} />
            {TASK_STATUSES.map(s => (
              <FilterChip key={s} label={s} count={counts[s] || 0} active={filter === s} onClick={() => setFilter(s)} />
            ))}
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" /> New Task
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <ListTodo className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">
              {filter === 'all' ? 'No tasks yet. Create your first one.' : `No ${filter} tasks.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(task => (
              <TaskRow key={task.id} task={task} onClick={() => openTask(task.id)} />
            ))}
          </div>
        )}
      </div>

      {(modalIsNew || modalTaskId) && (
        <TaskDetailsModal
          taskId={modalTaskId}
          isNew={modalIsNew}
          onClose={() => { setModalTaskId(null); setModalIsNew(false); }}
          onChanged={() => setDataVersion(v => v + 1)}
        />
      )}
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition ${
        active
          ? 'bg-teal-600 text-white'
          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-slate-100'}`}>
        {count}
      </span>
    </button>
  );
}

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const isCompleted = task.status === 'Completed';
  const dueOverdue = task.due_date && !isCompleted && new Date(task.due_date) < new Date(new Date().toDateString());

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl border border-slate-200 hover:border-teal-300 hover:shadow-sm transition p-4 text-left flex items-center gap-3"
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${
        isCompleted ? 'bg-green-500' :
        task.status === 'In Progress' ? 'bg-blue-500' :
        task.status === 'On Hold' ? 'bg-amber-500' :
        task.status === 'Cancelled' ? 'bg-red-400' :
        'bg-slate-300'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {task.title}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[task.action_category]}`}>
            {task.action_category}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[task.status]}`}>
            {task.status}
          </span>
          {task.due_date && (
            <span className={`text-xs flex items-center gap-1 ${dueOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
              <CalendarIcon className="w-3 h-3" />
              {formatDateLong(parseDateISO(task.due_date))}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
