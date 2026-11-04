import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getTasks, getTaskDetails, updateTask, updateSubtask } from '@/lib/store';
import { Task, TaskActionCategory, Subtask, FocusSessionTask, FocusSession } from '@/types';
import { formatDateLong, parseDateISO, formatDateISO } from '@/lib/dateUtils';
import { CATEGORY_COLORS } from '@/components/TaskDetailsModal';
import type { useFocusSession } from '@/lib/useFocusSession';
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
  EyeOff,
  RotateCcw,
  Lock,
  CheckCircle2,
  SkipForward,
  PlusCircle,
  PartyPopper,
} from 'lucide-react';

type FocusState = 'active' | 'ignored';

interface DraftTask {
  taskId: string;
  title: string;
  actionCategory: TaskActionCategory;
  dueDate: string;
  status: string;
  hours: number;
  minutes: number;
  state: FocusState;
}

const EXCLUDED_STATUSES = new Set(['Completed', 'Cancelled']);
const STORAGE_PREFIX = 'focus-draft-';

type FocusSessionHook = ReturnType<typeof useFocusSession>;

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

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toDraftRow(task: Task): DraftTask {
  return {
    taskId: task.id,
    title: task.title,
    actionCategory: task.action_category,
    dueDate: task.due_date!,
    status: task.status,
    hours: 0,
    minutes: 0,
    state: 'active',
  };
}

function draftToSessionTask(d: DraftTask): FocusSessionTask {
  return {
    taskId: d.taskId,
    title: d.title,
    actionCategory: d.actionCategory,
    dueDate: d.dueDate,
    status: d.status,
    hours: d.hours,
    minutes: d.minutes,
  };
}

interface FocusModeWindowProps {
  onClose: () => void;
  focusSession: FocusSessionHook;
}

export function FocusModeWindow({ onClose, focusSession }: FocusModeWindowProps) {
  const { profile } = useAuth();
  const activeSession = focusSession.session;

  if (activeSession && activeSession.status === 'active') {
    return <ActiveSessionView session={activeSession} hook={focusSession} onClose={onClose} />;
  }

  if (activeSession && activeSession.status === 'completed') {
    return <SessionSummaryView session={activeSession} hook={focusSession} onClose={onClose} />;
  }

  return <PreparationView profile={profile} hook={focusSession} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// Preparation View (Phase 1 — unchanged behavior)
// ---------------------------------------------------------------------------

function PreparationView({ profile, hook, onClose }: { profile: ReturnType<typeof useAuth>['profile']; hook: FocusSessionHook; onClose: () => void }) {
  const [focusTasks, setFocusTasks] = useState<DraftTask[]>([]);
  const [committed, setCommitted] = useState<{ tasks: DraftTask[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startMessage, setStartMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Auto-scroll state for drag-and-drop
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const dragClientYRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  const EDGE_ZONE = 60; // pixels from top/bottom edge where auto-scroll activates
  const MAX_SCROLL_SPEED = 14; // pixels per frame at the very edge

  const stopAutoScroll = useCallback(() => {
    dragClientYRef.current = null;
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  const autoScrollLoop = useCallback(() => {
    const container = scrollContainerRef.current;
    const clientY = dragClientYRef.current;
    if (!container || clientY === null) {
      autoScrollRafRef.current = null;
      return;
    }

    const rect = container.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const distanceFromTop = relativeY;
    const distanceFromBottom = rect.height - relativeY;

    let scrollDelta = 0;
    if (distanceFromTop < EDGE_ZONE && distanceFromTop > 0) {
      // Scroll up — speed increases as pointer approaches the top edge
      const intensity = 1 - distanceFromTop / EDGE_ZONE;
      scrollDelta = -Math.ceil(MAX_SCROLL_SPEED * intensity);
    } else if (distanceFromBottom < EDGE_ZONE && distanceFromBottom > 0) {
      // Scroll down — speed increases as pointer approaches the bottom edge
      const intensity = 1 - distanceFromBottom / EDGE_ZONE;
      scrollDelta = Math.ceil(MAX_SCROLL_SPEED * intensity);
    }

    if (scrollDelta !== 0) {
      container.scrollTop += scrollDelta;
      autoScrollRafRef.current = requestAnimationFrame(autoScrollLoop);
    } else {
      autoScrollRafRef.current = null;
    }
  }, []);

  const startAutoScrollIfNeeded = useCallback((clientY: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    dragClientYRef.current = clientY;
    if (autoScrollRafRef.current === null) {
      autoScrollRafRef.current = requestAnimationFrame(autoScrollLoop);
    }
  }, [autoScrollLoop]);

  const storageKey = useMemo(() => {
    return profile ? `${STORAGE_PREFIX}${profile.id}` : null;
  }, [profile]);

  const loadTasks = useCallback(async () => {
    if (!profile || !storageKey) return;
    setLoading(true);
    setError('');
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { draft?: DraftTask[]; committed?: { tasks: DraftTask[] } | null };
        if (parsed.committed) {
          setCommitted(parsed.committed);
          setFocusTasks(parsed.committed.tasks);
          setLoading(false);
          return;
        }
        if (parsed.draft && parsed.draft.length > 0) {
          const allTasks = await getTasks();
          const taskMap = new Map(allTasks.map(t => [t.id, t]));
          const refreshed = parsed.draft
            .filter(d => taskMap.has(d.taskId))
            .filter(d => isEligible(taskMap.get(d.taskId)!))
            .map(d => {
              const t = taskMap.get(d.taskId)!;
              return { ...d, title: t.title, actionCategory: t.action_category, status: t.status, dueDate: t.due_date! };
            });
          const existingIds = new Set(refreshed.map(d => d.taskId));
          const newEligible = allTasks
            .filter(isEligible)
            .filter(t => !existingIds.has(t.id))
            .map(toDraftRow);
          setFocusTasks([...refreshed, ...newEligible]);
          setLoading(false);
          return;
        }
      }
      const allTasks = await getTasks();
      const eligible = allTasks.filter(isEligible);
      eligible.sort((a, b) => {
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
        return a.created_at < b.created_at ? -1 : 1;
      });
      setFocusTasks(eligible.map(toDraftRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [profile, storageKey]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!storageKey || loading) return;
    if (committed) return;
    const payload = JSON.stringify({ draft: focusTasks, committed: null });
    localStorage.setItem(storageKey, payload);
  }, [focusTasks, storageKey, loading, committed]);

  const isLocked = committed !== null;

  const activeTasks = useMemo(() => focusTasks.filter(ft => ft.state === 'active'), [focusTasks]);
  const ignoredTasks = useMemo(() => focusTasks.filter(ft => ft.state === 'ignored'), [focusTasks]);

  const totalMinutes = useMemo(() => {
    return activeTasks.reduce((sum, ft) => sum + ft.hours * 60 + ft.minutes, 0);
  }, [activeTasks]);

  const allValid = useMemo(() => {
    if (activeTasks.length === 0) return false;
    return activeTasks.every(ft => (ft.hours * 60 + ft.minutes) > 0);
  }, [activeTasks]);

  function updateHours(index: number, raw: string) {
    if (isLocked) return;
    const val = Math.max(0, Math.min(23, parseInt(raw) || 0));
    setFocusTasks(prev => prev.map((ft, i) => i === index ? { ...ft, hours: val } : ft));
  }

  function updateMinutes(index: number, raw: string) {
    if (isLocked) return;
    const val = Math.max(0, Math.min(59, parseInt(raw) || 0));
    setFocusTasks(prev => prev.map((ft, i) => i === index ? { ...ft, minutes: val } : ft));
  }

  function toggleIgnore(index: number) {
    if (isLocked) return;
    setFocusTasks(prev => prev.map((ft, i) =>
      i === index ? { ...ft, state: ft.state === 'active' ? 'ignored' : 'active' } : ft
    ));
  }

  function handleDragStart(index: number) {
    if (isLocked) return;
    dragIndexRef.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    if (isLocked) return;
    e.preventDefault();
    if (dragOverIndex !== index) setDragOverIndex(index);
    startAutoScrollIfNeeded(e.clientY);
  }

  function handleDragLeave() {
    setDragOverIndex(null);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    if (isLocked) return;
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
    stopAutoScroll();
  }

  async function handleStart() {
    if (!allValid || !storageKey) return;
    setStarting(true);
    setError('');
    try {
      const committedTasks = focusTasks.filter(ft => ft.state === 'active');
      const sessionTasks = committedTasks.map(draftToSessionTask);
      await hook.startSession(sessionTasks);
      localStorage.removeItem(storageKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setError('An active Focus session already exists. It has been loaded for you.');
      } else {
        setError(msg || 'Failed to start session.');
      }
      setStarting(false);
    }
  }

  function handleStartNewPrep() {
    if (!storageKey) return;
    setCommitted(null);
    setStartMessage('');
    localStorage.removeItem(storageKey);
    loadTasks();
  }

  const overdueCount = useMemo(() => {
    const todayStr = formatDateISO(new Date());
    return focusTasks.filter(ft => ft.dueDate < todayStr).length;
  }, [focusTasks]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={scrollContainerRef}
        className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-white border-b border-slate-200 sticky top-0 z-10 rounded-t-2xl">
          <div className="px-5 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Timer className="w-5 h-5 text-teal-600 shrink-0" />
              <h2 className="text-base font-semibold text-slate-800 truncate">Focus Mode</h2>
              {isLocked && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                  <Lock className="w-3 h-3" />
                  Committed
                </span>
              )}
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

        {/* Sticky summary banner */}
        <div className="sticky top-14 z-[5] bg-slate-50 px-5 pt-4 pb-4">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-2xl px-6 py-5 shadow-sm">
            <div className="flex items-center gap-2 text-teal-100 text-xs font-medium uppercase tracking-wide mb-1">
              <Clock className="w-3.5 h-3.5" />
              Total Estimated Time{isLocked ? ' — Session' : ''}
            </div>
            <div className="text-3xl font-bold text-white">
              {formatDuration(totalMinutes)}
            </div>
            <div className="text-teal-200 text-sm mt-1">
              {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''}
              {!isLocked && ignoredTasks.length > 0 && ` · ${ignoredTasks.length} ignored`}
              {overdueCount > 0 && ` · ${overdueCount} overdue`}
            </div>
          </div>
        </div>

        <div className="px-5 pb-4">
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
              <div className="space-y-2 mb-4">
                {focusTasks.map((ft, index) => (
                  <TaskDragRow
                    key={ft.taskId}
                    focusTask={ft}
                    index={index}
                    isDragOver={dragOverIndex === index}
                    isLocked={isLocked}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onHoursChange={updateHours}
                    onMinutesChange={updateMinutes}
                    onToggleIgnore={toggleIgnore}
                  />
                ))}
              </div>

              {!isLocked ? (
                <>
                  <button
                    onClick={handleStart}
                    disabled={!allValid || starting}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition shadow-sm ${
                      allValid && !starting
                        ? 'bg-teal-600 text-white hover:bg-teal-700'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Start Focus Session
                  </button>

                  {!allValid && activeTasks.length > 0 && (
                    <p className="text-xs text-slate-400 text-center mt-2">
                      Set a duration greater than zero for every active task to enable Start.
                    </p>
                  )}

                  {activeTasks.length === 0 && focusTasks.length > 0 && (
                    <p className="text-xs text-slate-400 text-center mt-2">
                      Reactivate at least one task to enable Start.
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Session committed.</p>
                      <p className="text-xs mt-0.5 text-amber-600">
                        {activeTasks.length} task{activeTasks.length !== 1 ? 's' : ''} locked in execution order.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleStartNewPrep}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition shadow-sm bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Start New Preparation
                  </button>
                </div>
              )}

              {startMessage && !isLocked && (
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

// ---------------------------------------------------------------------------
// Active Session View (Phase 2)
// ---------------------------------------------------------------------------

function ActiveSessionView({ session, hook, onClose }: { session: FocusSession; hook: FocusSessionHook; onClose: () => void }) {
  const currentTask = session.tasks[session.current_task_index];
  const remainingMs = hook.remainingMs;
  const isAtZero = hook.isAtZero;

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [taskNotes, setTaskNotes] = useState('');
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPostpone, setShowPostpone] = useState(false);
  const [customPostpone, setCustomPostpone] = useState('');

  useEffect(() => {
    if (!currentTask) return;
    let cancelled = false;
    setLoadingDetails(true);
    (async () => {
      try {
        const details = await getTaskDetails(currentTask.taskId);
        if (cancelled) return;
        setSubtasks(details.subtasks);
        setTaskNotes(details.task?.notes || '');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load task details.');
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentTask?.taskId]);

  async function handleComplete() {
    if (!currentTask) return;
    setActionLoading(true);
    setError('');
    try {
      await updateTask(currentTask.taskId, { status: 'Completed' });
      await hook.advanceToNextTask('completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete task.');
      setActionLoading(false);
    }
  }

  async function handleSkip() {
    if (!currentTask) return;
    setActionLoading(true);
    setError('');
    try {
      await hook.advanceToNextTask('skipped');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip task.');
      setActionLoading(false);
    }
  }

  async function handlePostpone(minutes: number) {
    setActionLoading(true);
    setError('');
    try {
      await hook.postpone(minutes);
      setShowPostpone(false);
      setCustomPostpone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to postpone.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleSubtask(subtask: Subtask) {
    try {
      const updated = await updateSubtask(subtask.id, { completed: !subtask.completed });
      setSubtasks(prev => prev.map(s => s.id === subtask.id ? updated : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subtask.');
    }
  }

  if (!currentTask) {
    return null;
  }

  const totalTasks = session.tasks.length;
  const taskNumber = session.current_task_index + 1;
  const completedCount = session.completed_task_ids.length;
  const skippedCount = session.skipped_task_ids.length;
  const progress = ((completedCount + skippedCount) / totalTasks) * 100;

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
              <h2 className="text-base font-semibold text-slate-800 truncate">Focus Session</h2>
              <span className="text-xs text-slate-400 shrink-0">
                Task {taskNumber} of {totalTasks}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Minimize — session continues in background"
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

        {/* Countdown banner */}
        <div className="sticky top-14 z-[5] bg-slate-50 px-5 pt-4 pb-4">
          <div className={`rounded-2xl px-6 py-5 shadow-sm transition-colors ${
            isAtZero
              ? 'bg-gradient-to-r from-red-600 to-red-700'
              : 'bg-gradient-to-r from-teal-600 to-teal-700'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-teal-100 text-xs font-medium uppercase tracking-wide" style={isAtZero ? { color: 'rgba(254,226,226,0.9)' } : undefined}>
                <Clock className="w-3.5 h-3.5" />
                {isAtZero ? 'Time Expired' : 'Time Remaining'}
              </div>
              <div className="text-xs text-teal-100" style={isAtZero ? { color: 'rgba(254,226,226,0.9)' } : undefined}>
                {completedCount} done · {skippedCount} skipped
              </div>
            </div>
            <div className="text-3xl font-bold text-white font-mono">
              {formatCountdown(remainingMs)}
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white/80 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="px-5 pb-4">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Current task info */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="text-lg font-semibold text-slate-800">{currentTask.title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[currentTask.actionCategory]}`}>
                {currentTask.actionCategory}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {currentTask.dueDate && (
                <span className="flex items-center gap-1">
                  <CalendarIcon className="w-3 h-3" />
                  {formatDateLong(parseDateISO(currentTask.dueDate))}
                </span>
              )}
              <span>Estimate: {formatDuration(currentTask.hours * 60 + currentTask.minutes)}</span>
            </div>
            {taskNotes && (
              <p className="text-sm text-slate-500 mt-2 whitespace-pre-wrap">{taskNotes}</p>
            )}
          </div>

          {/* Subtasks */}
          {loadingDetails ? (
            <div className="flex items-center justify-center py-6 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : subtasks.length > 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Subtasks</h4>
              <div className="space-y-1.5">
                {subtasks.map(st => (
                  <label
                    key={st.id}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={st.completed}
                      onChange={() => handleToggleSubtask(st)}
                      className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={`text-sm ${st.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                      {st.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={handleComplete}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition shadow-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Complete Task
            </button>

            <div className="flex gap-2">
              <button
                onClick={() => setShowPostpone(s => !s)}
                disabled={!isAtZero || actionLoading}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition ${
                  isAtZero && !actionLoading
                    ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                }`}
                title={isAtZero ? 'Add more time' : 'Available when countdown reaches zero'}
              >
                <PlusCircle className="w-4 h-4" />
                Postpone
              </button>
              <button
                onClick={handleSkip}
                disabled={actionLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
              >
                <SkipForward className="w-4 h-4" />
                Skip
              </button>
            </div>

            {showPostpone && isAtZero && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {[15, 30, 45, 60].map(m => (
                    <button
                      key={m}
                      onClick={() => handlePostpone(m)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-sm font-medium bg-white text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition disabled:opacity-50"
                    >
                      +{m}m
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={customPostpone}
                    onChange={(e) => setCustomPostpone(e.target.value)}
                    placeholder="Custom minutes"
                    className="w-32 px-2 py-1.5 text-sm border border-slate-300 rounded-lg text-center focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition"
                  />
                  <button
                    onClick={() => {
                      const m = parseInt(customPostpone);
                      if (m > 0) handlePostpone(m);
                    }}
                    disabled={actionLoading || !customPostpone || parseInt(customPostpone) <= 0}
                    className="px-3 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session Summary View
// ---------------------------------------------------------------------------

function SessionSummaryView({ session, hook, onClose }: { session: FocusSession; hook: FocusSessionHook; onClose: () => void }) {
  const completedIds = new Set(session.completed_task_ids);
  const skippedIds = new Set(session.skipped_task_ids);

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
              <PartyPopper className="w-5 h-5 text-teal-600 shrink-0" />
              <h2 className="text-base font-semibold text-slate-800 truncate">Session Complete</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-6">
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-2xl px-6 py-5 mb-4 shadow-sm text-center">
            <PartyPopper className="w-10 h-10 text-teal-100 mx-auto mb-2" />
            <p className="text-white text-lg font-semibold">All tasks processed!</p>
            <p className="text-teal-200 text-sm mt-1">
              {session.completed_task_ids.length} completed · {session.skipped_task_ids.length} skipped
            </p>
          </div>

          <div className="space-y-2 mb-4">
            {session.tasks.map((task, i) => {
              const isCompleted = completedIds.has(task.taskId);
              const isSkipped = skippedIds.has(task.taskId);
              return (
                <div
                  key={task.taskId}
                  className={`bg-white rounded-xl border p-3 flex items-center gap-3 ${
                    isCompleted ? 'border-green-200' : isSkipped ? 'border-slate-200' : 'border-slate-200'
                  }`}
                >
                  <div className="shrink-0">
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <SkipForward className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium ${isSkipped ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {i + 1}. {task.title}
                    </span>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Estimate: {formatDuration(task.hours * 60 + task.minutes)}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    isCompleted ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isCompleted ? 'Completed' : 'Skipped'}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            onClick={async () => { await hook.dismissSession(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition shadow-sm bg-teal-600 text-white hover:bg-teal-700"
          >
            <RotateCcw className="w-4 h-4" />
            Done — Start New Preparation
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Row (Phase 1 — unchanged)
// ---------------------------------------------------------------------------

interface TaskDragRowProps {
  focusTask: DraftTask;
  index: number;
  isDragOver: boolean;
  isLocked: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onHoursChange: (index: number, value: string) => void;
  onMinutesChange: (index: number, value: string) => void;
  onToggleIgnore: (index: number) => void;
}

function TaskDragRow({
  focusTask: { title, actionCategory, dueDate, status, hours, minutes, state },
  index,
  isDragOver,
  isLocked,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onHoursChange,
  onMinutesChange,
  onToggleIgnore,
}: TaskDragRowProps) {
  const todayStr = formatDateISO(new Date());
  const isOverdue = dueDate < todayStr;
  const isIgnored = state === 'ignored';

  return (
    <div
      draggable={!isLocked}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`rounded-xl border p-3 transition-all ${
        isDragOver
          ? 'border-teal-400 border-2 shadow-md -translate-y-0.5'
          : isIgnored
            ? 'border-slate-200 bg-slate-100/60'
            : 'border-slate-200 bg-white'
      } ${isLocked ? 'cursor-default' : ''}`}
    >
      <div className={`flex items-start gap-2 ${isIgnored ? 'opacity-50' : ''}`}>
        {!isLocked && (
          <div className="flex items-center pt-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition shrink-0">
            <GripVertical className="w-5 h-5" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${isIgnored ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {title}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[actionCategory]}`}>
              {actionCategory}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
              <CalendarIcon className="w-3 h-3" />
              {formatDateLong(parseDateISO(dueDate))}
            </span>
            <span className="text-xs text-slate-400">
              {status}
            </span>
          </div>

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
                disabled={isLocked || isIgnored}
                className="w-12 px-2 py-1 text-sm border border-slate-300 rounded-lg text-center focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition disabled:bg-slate-100 disabled:text-slate-400"
              />
              <span className="text-xs text-slate-500">h</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minutes || ''}
                onChange={(e) => onMinutesChange(index, e.target.value)}
                placeholder="0"
                disabled={isLocked || isIgnored}
                className="w-12 px-2 py-1 text-sm border border-slate-300 rounded-lg text-center focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition disabled:bg-slate-100 disabled:text-slate-400"
              />
              <span className="text-xs text-slate-500">m</span>
            </div>
          </div>
        </div>

        {!isLocked && (
          <button
            onClick={() => onToggleIgnore(index)}
            className={`p-1.5 rounded-lg transition shrink-0 ${
              isIgnored
                ? 'text-teal-600 hover:bg-teal-50'
                : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
            }`}
            title={isIgnored ? 'Reactivate task' : 'Ignore task'}
          >
            {isIgnored ? <RotateCcw className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
