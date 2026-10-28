import { useState, useEffect, useMemo, useCallback } from 'react';
import { getTasks } from '@/lib/store';
import { Task } from '@/types';
import { CATEGORY_COLORS, STATUS_COLORS } from '@/components/TaskDetailsModal';
import { formatDateMedium, parseDateISO } from '@/lib/dateUtils';
import { ListTodo, Loader2, Plus } from 'lucide-react';

interface CompactTaskListProps {
  onOpenTask: (taskId: string) => void;
  onOpenTasksScreen: () => void;
  onNewTask: () => void;
  dataVersion: number;
}

export function CompactTaskList({ onOpenTask, onOpenTasksScreen, onNewTask, dataVersion }: CompactTaskListProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getTasks();
      setTasks(t);
    } catch {
      /* ignore in dashboard widget */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const visible = useMemo(() => {
    const filtered = showCompleted ? tasks : tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
    return [...filtered].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return 0;
    }).slice(0, 6);
  }, [tasks, showCompleted]);

  const incompleteCount = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled').length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onOpenTasksScreen}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-teal-600 transition"
        >
          <ListTodo className="w-4 h-4 text-teal-600" />
          My Tasks
          <span className="text-xs font-normal text-slate-400">({incompleteCount} open)</span>
        </button>
        <button
          onClick={onNewTask}
          className="p-1 text-teal-600 hover:bg-teal-50 rounded-lg transition"
          title="New task"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="py-3 text-sm text-slate-400 text-center">
          {showCompleted ? 'No completed tasks.' : 'No open tasks. Nice work!'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map(task => {
            const overdue = task.due_date && task.status !== 'Completed' && task.status !== 'Cancelled' &&
              new Date(task.due_date) < new Date(new Date().toDateString());
            return (
              <button
                key={task.id}
                onClick={() => onOpenTask(task.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 transition text-left group"
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  task.status === 'Completed' ? 'bg-green-500' :
                  task.status === 'In Progress' ? 'bg-blue-500' :
                  task.status === 'On Hold' ? 'bg-amber-500' :
                  'bg-slate-300'
                }`} />
                <span className={`text-sm truncate flex-1 ${task.status === 'Completed' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  {task.title}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[task.action_category]}`}>
                  {task.action_category}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[task.status]}`}>
                  {task.status}
                </span>
                {task.due_date && (
                  <span className={`text-xs shrink-0 ${overdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                    {formatDateMedium(parseDateISO(task.due_date))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <button
          onClick={() => setShowCompleted(prev => !prev)}
          className="mt-3 text-xs text-slate-400 hover:text-slate-600 transition w-full text-center"
        >
          {showCompleted ? 'Hide completed' : 'Show completed'}
        </button>
      )}
    </div>
  );
}
