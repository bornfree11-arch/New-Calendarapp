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
    setSession(updated);
  }, [currentTask]);

  const postpone = useCallback(async (extraMinutes: number) => {
    const s = sessionRef.current;
    if (!s || !s.task_deadline_at) return;
    const baseDeadline = new Date(s.task_deadline_at).getTime();
    const newDeadline = new Date(baseDeadline + extraMinutes * 60_000).toISOString();
    const updated = await updateFocusSession(s.id, {
      task_deadline_at: newDeadline,
    });
    setSession(updated);
  }, []);

  const dismissSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    await updateFocusSession(s.id, { status: 'completed' });
    setSession(null);
  }, []);

  return {
    session,
    currentTask,
    remainingMs,
    isAtZero,
    now,
    startSession,
    advanceToNextTask,
    postpone,
    dismissSession,
    reloadSession: loadSession,
  };
}
