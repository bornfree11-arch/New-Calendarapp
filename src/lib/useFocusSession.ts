import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getActiveFocusSession,
  createFocusSession,
  updateFocusSession,
} from '@/lib/store';
import { FocusSession, FocusSessionTask, Profile } from '@/types';

export interface SessionSummaryEntry {
  task: FocusSessionTask;
  outcome: 'completed' | 'skipped';
}

interface UseFocusSessionArgs {
  profile: Profile | null;
  authLoading: boolean;
}

export function useFocusSession({ profile, authLoading }: UseFocusSessionArgs) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const sessionRef = useRef<FocusSession | null>(null);
  const loadRequestIdRef = useRef(0);

  // Track which task index we've already fired the expiration notification for.
  // Keyed by task index + session id so a session reload after refresh won't
  // re-notify for a task that was already expired when the page loaded.
  const notifiedKeyRef = useRef<string | null>(null);
  const [expiredTask, setExpiredTask] = useState<FocusSessionTask | null>(null);

  sessionRef.current = session;

  // Tick every second to refresh countdown display
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load active session — only when authentication is ready
  const loadSession = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    try {
      const s = await getActiveFocusSession();
      // Prevent stale responses from overwriting newer state
      if (requestId !== loadRequestIdRef.current) return;
      setSession(s);
    } catch {
      if (requestId !== loadRequestIdRef.current) return;
      setSession(null);
    }
  }, []);

  // Re-run loading when the authenticated user changes or becomes available
  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      // User signed out or not authenticated — clear any stale session
      ++loadRequestIdRef.current;
      setSession(null);
      notifiedKeyRef.current = null;
      setExpiredTask(null);
      return;
    }
    loadSession();
  }, [profile, authLoading, loadSession]);

  // Compute remaining time from the saved deadline
  const remainingMs = session?.task_deadline_at
    ? Math.max(0, new Date(session.task_deadline_at).getTime() - now)
    : 0;

  const isAtZero = remainingMs <= 0;

  const currentTask: FocusSessionTask | null = session && session.current_task_index < session.tasks.length
    ? session.tasks[session.current_task_index]
    : null;

  // Detect task expiration and fire notifications exactly once per task
  useEffect(() => {
    if (!session || !currentTask || !session.task_deadline_at) {
      setExpiredTask(null);
      return;
    }

    const deadlineMs = new Date(session.task_deadline_at).getTime();
    const isExpired = Date.now() >= deadlineMs;
    const notifyKey = `${session.id}:${session.current_task_index}`;

    if (isExpired) {
      // Only fire if we haven't already notified for this task in this session
      if (notifiedKeyRef.current !== notifyKey) {
        notifiedKeyRef.current = notifyKey;
        setExpiredTask(currentTask);

        // Fire desktop notification if tab is hidden and permission granted
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const n = new Notification('Focus time expired', {
              body: `"${currentTask.title}" — the allotted time has ended.`,
              tag: `focus-expired-${notifyKey}`,
            });
            n.onclick = () => {
              window.focus();
              n.close();
            };
          } catch {
            // Some browsers throw if the notification constructor fails
          }
        }
      }
    } else {
      // Task is not expired — clear the notified key so a future expiration
      // (e.g. after postpone extends the deadline) will notify again
      if (notifiedKeyRef.current === notifyKey) {
        notifiedKeyRef.current = null;
      }
      setExpiredTask(null);
    }
  }, [session, currentTask, now]);

  // Clear expired popup when the popup is dismissed
  const dismissExpiredPopup = useCallback(() => {
    setExpiredTask(null);
  }, []);

  const startSession = useCallback(async (tasks: FocusSessionTask[]) => {
    if (tasks.length === 0) return;

    // Check for an existing active session before attempting to create one
    const existing = await getActiveFocusSession();
    if (existing) {
      setSession(existing);
      return existing;
    }

    const startedAt = new Date().toISOString();
    const totalMinutes = tasks[0].hours * 60 + tasks[0].minutes;
    const deadline = new Date(Date.now() + totalMinutes * 60_000).toISOString();

    try {
      const s = await createFocusSession(tasks, startedAt, deadline);
      notifiedKeyRef.current = null;
      setSession(s);
      return s;
    } catch (err) {
      // Race condition: another session was created between our check and insert.
      // The unique partial index blocks the duplicate — attempt to retrieve it.
      const recovered = await getActiveFocusSession();
      if (recovered) {
        setSession(recovered);
        return recovered;
      }
      throw err;
    }
  }, []);

  const advanceToNextTask = useCallback(async (outcome: 'completed' | 'skipped') => {
    const s = sessionRef.current;
    if (!s || !currentTask) return;

    const completedIds = outcome === 'completed'
      ? [...s.completed_task_ids, currentTask.taskId]
      : s.completed_task_ids;
    const skippedIds = outcome === 'skipped'
      ? [...s.skipped_task_ids, currentTask.taskId]
      : s.skipped_task_ids;

    const nextIndex = s.current_task_index + 1;

    if (nextIndex >= s.tasks.length) {
      const updated = await updateFocusSession(s.id, {
        current_task_index: nextIndex,
        completed_task_ids: completedIds,
        skipped_task_ids: skippedIds,
        task_started_at: null,
        task_deadline_at: null,
        status: 'completed',
      });
      notifiedKeyRef.current = null;
      setExpiredTask(null);
      setSession(updated);
      return;
    }

    const nextTask = s.tasks[nextIndex];
    const nextMinutes = nextTask.hours * 60 + nextTask.minutes;
    const nextStartedAt = new Date().toISOString();
    const nextDeadline = new Date(Date.now() + nextMinutes * 60_000).toISOString();

    const updated = await updateFocusSession(s.id, {
      current_task_index: nextIndex,
      completed_task_ids: completedIds,
      skipped_task_ids: skippedIds,
      task_started_at: nextStartedAt,
      task_deadline_at: nextDeadline,
    });
    notifiedKeyRef.current = null;
    setExpiredTask(null);
    setSession(updated);
  }, [currentTask]);

  const postpone = useCallback(async (extraMinutes: number) => {
    const s = sessionRef.current;
    if (!s || !s.task_deadline_at) return;
    const baseDeadline = new Date(s.task_deadline_at).getTime();
    const nowMs = Date.now();
    // If the deadline has already passed, calculate the new deadline from the
    // current timestamp so the user gets the full extension. Otherwise, extend
    // the existing deadline to preserve remaining time.
    const startMs = baseDeadline < nowMs ? nowMs : baseDeadline;
    const newDeadline = new Date(startMs + extraMinutes * 60_000).toISOString();
    const updated = await updateFocusSession(s.id, {
      task_deadline_at: newDeadline,
    });
    // Clear the notified key so a future expiration will notify again
    notifiedKeyRef.current = null;
    setExpiredTask(null);
    setSession(updated);
  }, []);

  const dismissSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    await updateFocusSession(s.id, { status: 'completed' });
    notifiedKeyRef.current = null;
    setExpiredTask(null);
    setSession(null);
  }, []);

  return {
    session,
    currentTask,
    remainingMs,
    isAtZero,
    now,
    expiredTask,
    dismissExpiredPopup,
    startSession,
    advanceToNextTask,
    postpone,
    dismissSession,
    reloadSession: loadSession,
  };
}
