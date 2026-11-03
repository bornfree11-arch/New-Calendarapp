import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getTasks } from '@/lib/store';
import { Task, TaskActionCategory } from '@/types';
import { formatDateLong, parseDateISO, formatDateISO } from '@/lib/dateUtils';
import { CATEGORY_COLORS } from '@/components/TaskDetailsModal';
import {
  Loader2,
  GripVertical,
  Clock,
  Play,
  Calendar as CalendarIcon,
  X,
  AlertCircle,
  Timer,
  Minimize2,
} from 'lucide-react';

interface FocusTask {
  task: Task;
  hours: number;
  minutes: number;
}

const EXCLUDED_STATUSES = new Set(['Completed', 'Cancelled']);

function isEligible(task: Task): boolean {
  if (EXCLUDED_STATUSES.has(task.status)) return false;
  if (!task.due_date) return false;
  const due = parseDateISO(task.due_date);
  const today = new Date(new Date().toDateString());
  return due <= today;
}

function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface FocusModeWindowProps {
  onClose: () => void;
}

export function FocusModeWindow({ onClose }: FocusModeWindowProps) {
  const { profile } = useAuth();
  const [focusTasks, setFocusTasks] = useState<FocusTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startMessage, setStartMessage] = useState('');
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const loadTasks = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const allTasks = await getTasks();
      const eligible = allTasks.filter(isEligible);
      eligible.sort((a, b) => {
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
        return a.created_at < b.created_at ? -1 : 1;
      });
      setFocusTasks(eligible.map(task => ({ task, hours: 0, minutes: 0 })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const totalMinutes = useMemo(() => {
    return focusTasks.reduce((sum, ft) => sum + ft.hours * 60 + ft.minutes, 0);
  }, [focusTasks]);

  const allValid = useMemo(() => {
    if (focusTasks.length === 0) return false;
    return focusTasks.every(ft => (ft.hours * 60 + ft.minutes) > 0);
  }, [focusTasks]);

  function updateHours(index: number, raw: string) {
    const val = Math.max(0, Math.min(23, parseInt(raw) || 0));
    setFocusTasks(prev => prev.map((ft, i) => i === index ? { ...ft, hours: val } : ft));
  }

  function updateMinutes(index: number, raw: string) {
    const val = Math.max(0, Math.min(59, parseInt(raw) || 0));
    setFocusTasks(prev => prev.map((ft, i) => i === index ? { ...ft, minutes: val } : ft));
  }

  function removeTask(index: number) {
    setFocusTasks(prev => prev.filter((_, i) => i !== index));
  }

  function handleDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragOverIndex !== index) setDragOverIndex(index);
  }

  function handleDragLeave() {
    setDragOverIndex(null);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (dragIndex === null || dragIndex === dropIndex) return;
    setFocusTasks(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
  }

  function handleDragEnd() {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }

  function handleStart() {
    setStartMessage('Active Focus sessions will be enabled in Phase 2. Your task order and estimates are ready to go.');
  }

  const overdueCount = useMemo(() => {
    const todayStr = formatDateISO(new Date());
    return focusTasks.filter(ft => ft.task.due_date! < todayStr).length;
  }, [focusTasks]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-white border-b border-slate-200 sticky top-0 z-10 rounded-t-2xl">
          <div className="px-5 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Timer className="w-5 h-5 text-teal-600 shrink-0" />
              <h2 className="text-base font-semibold text-slate-800 truncate">Focus Mode</h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Minimize — return to calendar"
              >
                <Minimize2 className="w-4 h-4" />
                <span className="hidden sm:inline">Minimize</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Combined duration banner */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-2xl px-6 py-5 mb-4 shadow-sm">
            <div className="flex items-center gap-2 text-teal-100 text-xs font-medium uppercase tracking-wide mb-1">
              <Clock className="w-3.5 h-3.5" />
              Total Estimated Time
            </div>
            <div className="text-3xl font-bold text-white">
              {formatDuration(totalMinutes)}
            </div>
            <div className="text-teal-200 text-sm mt-1">
              {focusTasks.length} task{focusTasks.length !== 1 ? 's' : ''}
              {overdueCount > 0 && ` · ${overdueCount} overdue`}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : focusTasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
              <Timer className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                No tasks are due today or overdue. You're all caught up!
              </p>
            </div>
          ) : (
            <>
              {/* Task list */}
              <div className="space-y-2 mb-4">
                {focusTasks.map((ft, index) => (
                  <TaskDragRow
                    key={ft.task.id}
                    focusTask={ft}
                    index={index}
                    isDragOver={dragOverIndex === index}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onHoursChange={updateHours}
                    onMinutesChange={updateMinutes}
                    onRemove={removeTask}
                  />
                ))}
              </div>

              {/* Start button */}
              <button
                onClick={handleStart}
                disabled={!allValid}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition shadow-sm ${
                  allValid
                    ? 'bg-teal-600 text-white hover:bg-teal-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Play className="w-4 h-4" />
                Start Focus Session
              </button>

              {!allValid && focusTasks.length > 0 && (
                <p className="text-xs text-slate-400 text-center mt-2">
                  Set a duration greater than zero for every task to enable Start.
                </p>
              )}

              {startMessage && (
                <div className="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{startMessage}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface TaskDragRowProps {
  focusTask: FocusTask;
  index: number;
  isDragOver: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onHoursChange: (index: number, value: string) => void;
  onMinutesChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}

function TaskDragRow({
  focusTask: { task, hours, minutes },
  index,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onHoursChange,
  onMinutesChange,
  onRemove,
}: TaskDragRowProps) {
  const todayStr = formatDateISO(new Date());
  const isOverdue = task.due_date! < todayStr;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`bg-white rounded-xl border p-3 transition-all ${
        isDragOver
          ? 'border-teal-400 border-2 shadow-md -translate-y-0.5'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <div className="flex items-center pt-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition shrink-0">
          <GripVertical className="w-5 h-5" />
        </div>

        {/* Task info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800">
              {task.title}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[task.action_category as TaskActionCategory]}`}>
              {task.action_category}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {task.due_date && (
              <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                <CalendarIcon className="w-3 h-3" />
                {formatDateLong(parseDateISO(task.due_date))}
              </span>
            )}
            <span className="text-xs text-slate-400">
              {task.status}
            </span>
          </div>

          {/* Duration inputs */}
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-slate-500 font-medium">Estimate:</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={23}
                value={hours || ''}
                onChange={(e) => onHoursChange(index, e.target.value)}
                placeholder="0"
                className="w-12 px-2 py-1 text-sm border border-slate-300 rounded-lg text-center focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
              />
              <span className="text-xs text-slate-500">h</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minutes || ''}
                onChange={(e) => onMinutesChange(index, e.target.value)}
                placeholder="0"
                className="w-12 px-2 py-1 text-sm border border-slate-300 rounded-lg text-center focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
              />
              <span className="text-xs text-slate-500">m</span>
            </div>
          </div>
        </div>

        {/* Remove button */}
        <button
          onClick={() => onRemove(index)}
          className="p-1 text-slate-300 hover:text-red-500 transition shrink-0"
          title="Remove from focus list"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
