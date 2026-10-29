import { useState, useEffect, useCallback } from 'react';
import {
  Task,
  Subtask,
  TaskStatusHistoryEntry,
  TaskActionCategory,
  TaskStatus,
  TASK_ACTION_CATEGORIES,
  TASK_STATUSES,
} from '@/types';
import {
  getTaskDetails,
  createTask,
  updateTask,
  deleteTask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  createSubtasksBulk,
} from '@/lib/store';
import { formatDateLong, parseDateISO, formatDateISO } from '@/lib/dateUtils';
import {
  X,
  Plus,
  Trash2,
  Check,
  Clock,
  Calendar as CalendarIcon,
  Tag,
  Loader2,
  History,
} from 'lucide-react';

interface TaskDetailsModalProps {
  taskId: string | null;
  isNew: boolean;
  defaultDueDate?: string;
  onClose: () => void;
  onChanged: () => void;
}

const CATEGORY_COLORS: Record<TaskActionCategory, string> = {
  Call: 'bg-blue-100 text-blue-700',
  Email: 'bg-teal-100 text-teal-700',
  Text: 'bg-amber-100 text-amber-700',
  Personal: 'bg-rose-100 text-rose-700',
  Other: 'bg-slate-100 text-slate-700',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  'Not Started': 'bg-slate-100 text-slate-600',
  'In Progress': 'bg-blue-100 text-blue-700',
  'On Hold': 'bg-amber-100 text-amber-700',
  'Cancelled': 'bg-red-100 text-red-700',
  'Completed': 'bg-green-100 text-green-700',
};

export function TaskDetailsModal({ taskId, isNew, defaultDueDate, onClose, onChanged }: TaskDetailsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [history, setHistory] = useState<TaskStatusHistoryEntry[]>([]);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskActionCategory>('Other');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<TaskStatus>('Not Started');
  const [newSubtask, setNewSubtask] = useState('');
  const [pendingSubtasks, setPendingSubtasks] = useState<{ title: string }[]>([]);

  const load = useCallback(async () => {
    if (isNew) {
      setTask(null);
      setTitle('');
      setCategory('Other');
      setNotes('');
      setDueDate(defaultDueDate || '');
      setStatus('Not Started');
      setSubtasks([]);
      setPendingSubtasks([]);
      setHistory([]);
      setLoading(false);
      return;
    }
    if (!taskId) return;
    setLoading(true);
    setError('');
    try {
      const { task: t, subtasks: st, history: h } = await getTaskDetails(taskId);
      if (!t) {
        setError('Task not found.');
        setLoading(false);
        return;
      }
      setTask(t);
      setTitle(t.title);
      setCategory(t.action_category);
      setNotes(t.notes);
      setDueDate(t.due_date || '');
      setStatus(t.status);
      setSubtasks(st);
      setHistory(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task.');
    } finally {
      setLoading(false);
    }
  }, [taskId, isNew, defaultDueDate]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setError('');
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    try {
      const dueDateValue = dueDate || null;
      if (isNew || !task) {
        const created = await createTask({
          title: title.trim(),
          action_category: category,
          notes: notes.trim(),
          due_date: dueDateValue,
          status,
        });
        if (pendingSubtasks.length > 0) {
          await createSubtasksBulk(created.id, pendingSubtasks.map(s => s.title));
        }
      } else {
        await updateTask(task.id, {
          title: title.trim(),
          action_category: category,
          notes: notes.trim(),
          due_date: dueDateValue,
          status,
        });
      }
      onChanged();
      onClose();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const isDev = import.meta.env.DEV;
      setError(isDev ? `Failed to save task: ${detail}` : 'Failed to save task. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    setSaving(true);
    try {
      await deleteTask(task.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSubtask() {
    if (!newSubtask.trim()) return;
    if (isNew || !task) {
      setPendingSubtasks(prev => [...prev, { title: newSubtask.trim() }]);
      setNewSubtask('');
      return;
    }
    try {
      const st = await addSubtask(task.id, newSubtask.trim());
      setSubtasks(prev => [...prev, st]);
      setNewSubtask('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add subtask.');
    }
  }

  function handleDeletePendingSubtask(index: number) {
    setPendingSubtasks(prev => prev.filter((_, i) => i !== index));
  }


  async function handleToggleSubtask(st: Subtask) {
    try {
      const updated = await updateSubtask(st.id, { completed: !st.completed });
      setSubtasks(prev => prev.map(s => (s.id === st.id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subtask.');
    }
  }

  async function handleDeleteSubtask(st: Subtask) {
    try {
      await deleteSubtask(st.id);
      setSubtasks(prev => prev.filter(s => s.id !== st.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove subtask.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-slate-800">
            {isNew ? 'New Task' : 'Task Details'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="px-6 py-4 space-y-5">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="Task title"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <div className="relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as TaskActionCategory)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition appearance-none bg-white"
                  >
                    {TASK_ACTION_CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as TaskStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition appearance-none bg-white"
                >
                  {TASK_STATUSES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition resize-none"
                placeholder="Optional notes..."
              />
            </div>

            {/* Subtasks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">Subtasks</label>
                {!isNew && (
                  <span className="text-xs text-slate-400">
                    {subtasks.filter(s => s.completed).length}/{subtasks.length} done
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {!isNew && subtasks.map(st => (
                  <div key={st.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => handleToggleSubtask(st)}
                      className={`w-5 h-5 rounded border flex items-center justify-center transition shrink-0 ${
                        st.completed
                          ? 'bg-teal-600 border-teal-600 text-white'
                          : 'border-slate-300 hover:border-teal-500'
                      }`}
                    >
                      {st.completed && <Check className="w-3.5 h-3.5" />}
                    </button>
                    <input
                      type="text"
                      value={st.title}
                      onChange={e => {
                        const val = e.target.value;
                        setSubtasks(prev => prev.map(s => (s.id === st.id ? { ...s, title: val } : s)));
                      }}
                      onBlur={async () => {
                        try { await updateSubtask(st.id, { title: st.title }); } catch { /* ignore */ }
                      }}
                      className={`flex-1 px-2 py-1 text-sm border border-transparent rounded focus:border-slate-300 outline-none transition ${
                        st.completed ? 'line-through text-slate-400' : 'text-slate-700'
                      }`}
                    />
                    <button
                      onClick={() => handleDeleteSubtask(st)}
                      className="p-1 text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {isNew && pendingSubtasks.map((st, index) => (
                  <div key={index} className="flex items-center gap-2 group">
                    <div className="w-5 h-5 rounded border border-slate-300 shrink-0" />
                    <span className="flex-1 px-2 py-1 text-sm text-slate-700">{st.title}</span>
                    <button
                      onClick={() => handleDeletePendingSubtask(index)}
                      className="p-1 text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    value={newSubtask}
                    onChange={e => setNewSubtask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(); } }}
                    placeholder="Add a subtask..."
                    className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                  />
                  <button
                    onClick={handleAddSubtask}
                    disabled={!newSubtask.trim()}
                    className="p-1.5 text-teal-600 hover:bg-teal-50 rounded-lg transition disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Status history */}
            {!isNew && history.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <History className="w-4 h-4 text-slate-400" />
                  <label className="block text-sm font-medium text-slate-700">Status History</label>
                </div>
                <div className="space-y-1.5 bg-slate-50 rounded-lg p-3 border border-slate-100">
                  {history.map(h => {
                    const d = new Date(h.changed_at);
                    const dateLabel = formatDateLong(d);
                    const isCreate = h.from_status === null;
                    return (
                      <div key={h.id} className="text-sm text-slate-600 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1.5 shrink-0" />
                        <span>
                          {isCreate ? (
                            <>Created — <span className="text-slate-400">{dateLabel}</span></>
                          ) : (
                            <>
                              Changed from <strong className="text-slate-700">{h.from_status}</strong> to{' '}
                              <strong className="text-slate-700">{h.to_status}</strong> —{' '}
                              <span className="text-slate-400">{dateLabel}</span>
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              {!isNew && task ? (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-sm text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              ) : <div />}
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {isNew ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { CATEGORY_COLORS, STATUS_COLORS };
