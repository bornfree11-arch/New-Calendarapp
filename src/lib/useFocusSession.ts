import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getActiveFocusSession,
  createFocusSession,
  updateFocusSession,
  deleteFocusSession,
} from '@/lib/store';
import {
  playHalfwayChime,
  startRepeatingCompletionChime,
  stopRepeatingCompletionChime,
  startTitleFlash,
  stopTitleFlash,
  sendDesktopNotification,
  requestNotificationPermission,
  unlockAudio,
} from '@/lib/alerts';
import { FocusSession, FocusSessionTask, Profile } from '@/types';

export interface SessionSummaryEntry {
  task: FocusSessionTask;
  outcome: 'completed' | 'skipped';
}

interface UseFocusSessionArgs {
  profile: Profile | null;
  authLoading: boolean;
}

interface SavedPauseState {
  taskIndex: number;
  remainingMs: number;
}

const PAUSE_STORAGE_PREFIX = 'focus-pause-';
const HALFWAY_STORAGE_PREFIX = 'focus-halfway-';
const EXPIRED_ACK_PREFIX = 'focus-expired-ack-';

function getPauseStorageKey(sessionId: string): string {
  return `${PAUSE_STORAGE_PREFIX}${sessionId}`;
}

function readSavedPause(sessionId: string, taskIndex: number): number | null {
  try {
    const raw = localStorage.getItem(getPauseStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPauseState;
    if (
      parsed &&
      parsed.taskIndex === taskIndex &&
      typeof parsed.remainingMs === 'number' &&
      parsed.remainingMs > 0
    ) {
      return parsed.remainingMs;
    }
    return null;
  } catch {
    return null;
  }
}

function writeSavedPause(sessionId: string, taskIndex: number, remainingMs: number): void {
  try {
    localStorage.setItem(
      getPauseStorageKey(sessionId),
      JSON.stringify({ taskIndex, remainingMs } satisfies SavedPauseState),
    );
  } catch {
    // Ignore storage errors
  }
}

function clearSavedPause(sessionId: string): void {
  try {
    localStorage.removeItem(getPauseStorageKey(sessionId));
  } catch {
    // Ignore storage errors
  }
}

function getHalfwayStorageKey(sessionId: string, taskIndex: number): string {
  return `${HALFWAY_STORAGE_PREFIX}${sessionId}:${taskIndex}`;
}

function hasHalfwayFired(sessionId: string, taskIndex: number): boolean {
  try {
    return localStorage.getItem(getHalfwayStorageKey(sessionId, taskIndex)) === '1';
  } catch {
    return false;
  }
}

function markHalfwayFired(sessionId: string, taskIndex: number): void {
  try {
    localStorage.setItem(getHalfwayStorageKey(sessionId, taskIndex), '1');
  } catch {
    // Ignore storage errors
  }
}

function hasExpiredAck(notifyKey: string): boolean {
  try {
    return sessionStorage.getItem(`${EXPIRED_ACK_PREFIX}${notifyKey}`) === '1';
  } catch {
    return false;
  }
}

function markExpiredAck(notifyKey: string): void {
  try {
    sessionStorage.setItem(`${EXPIRED_ACK_PREFIX}${notifyKey}`, '1');
  } catch {
    // Ignore storage errors
  }
}

function clearSessionLocalState(session: FocusSession): void {
  clearSavedPause(session.id);
  try {
    for (let i = 0; i < session.tasks.length; i++) {
      localStorage.removeItem(getHalfwayStorageKey(session.id, i));
    }
  } catch {
    // Ignore storage errors
  }
}

export function useFocusSession({ profile, authLoading }: UseFocusSessionArgs) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isPaused, setIsPaused] = useState(false);
  const [pausedRemainingMs, setPausedRemainingMs] = useState<number | null>(null);
  const sessionRef = useRef<FocusSession | null>(null);
  const loadRequestIdRef = useRef(0);

  // Track which task expiration / halfway mark we've already triggered
  const notifiedKeyRef = useRef<string | null>(null);
  const halfwayKeyRef = useRef<string | null>(null);
  const [expiredTask, setExpiredTask] = useState<FocusSessionTask | null>(null);
  const [completionAlertTask, setCompletionAlertTask] = useState<FocusSessionTask | null>(null);
  const [halfwayAlertTask, setHalfwayAlertTask] = useState<FocusSessionTask | null>(null);

  sessionRef.current = session;

  // Tick every second to refresh countdown display when not paused
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  // Clean up audio & title flash if hook unmounts
  useEffect(() => {
    return () => {
      stopRepeatingCompletionChime();
      stopTitleFlash('focus-complete');
      stopTitleFlash('focus-halfway');
    };
  }, []);

  // Load active session — only when authentication is ready
  const loadSession = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    try {
      const s = await getActiveFocusSession();
      if (requestId !== loadRequestIdRef.current) return;
      if (s && s.status === 'active') {
        const savedPausedMs = readSavedPause(s.id, s.current_task_index);
        if (savedPausedMs !== null) {
          setIsPaused(true);
          setPausedRemainingMs(savedPausedMs);
        } else {
          setIsPaused(false);
          setPausedRemainingMs(null);
        }
      } else {
        setIsPaused(false);
        setPausedRemainingMs(null);
      }
      setSession(s);
    } catch {
      if (requestId !== loadRequestIdRef.current) return;
      setSession(null);
      setIsPaused(false);
      setPausedRemainingMs(null);
    }
  }, []);

  // Re-run loading when the authenticated user changes or becomes available
  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      ++loadRequestIdRef.current;
      setSession(null);
      setIsPaused(false);
      setPausedRemainingMs(null);
      notifiedKeyRef.current = null;
      halfwayKeyRef.current = null;
      setExpiredTask(null);
      setCompletionAlertTask(null);
      setHalfwayAlertTask(null);
      stopRepeatingCompletionChime();
      stopTitleFlash('focus-complete');
      stopTitleFlash('focus-halfway');
      return;
    }
    loadSession();
  }, [profile, authLoading, loadSession]);

  // Compute remaining time: frozen when paused, otherwise from saved deadline
  const remainingMs = isPaused && pausedRemainingMs !== null
    ? pausedRemainingMs
    : session?.task_deadline_at
      ? Math.max(0, new Date(session.task_deadline_at).getTime() - now)
      : 0;

  const isAtZero = !isPaused && remainingMs <= 0;

  const currentTask: FocusSessionTask | null =
    session && session.current_task_index < session.tasks.length
      ? session.tasks[session.current_task_index]
      : null;

  // Detect 50% halfway mark and fire gentle chime, tab title flash, & OS desktop notification once per task/session
  useEffect(() => {
    if (!session || session.status !== 'active' || !currentTask || !session.task_deadline_at || isPaused) {
      return;
    }

    const totalMs = (currentTask.hours * 60 + currentTask.minutes) * 60_000;
    if (totalMs <= 0) return;

    const halfwayMs = totalMs / 2;
    if (remainingMs > 0 && remainingMs <= halfwayMs) {
      const key = `${session.id}:${session.current_task_index}`;
      if (halfwayKeyRef.current !== key && !hasHalfwayFired(session.id, session.current_task_index)) {
        halfwayKeyRef.current = key;
        markHalfwayFired(session.id, session.current_task_index);
        setHalfwayAlertTask(currentTask);

        playHalfwayChime();
        startTitleFlash('⏳ Halfway there!', 'focus-halfway', 10_000);
        sendDesktopNotification('⏳ Halfway there!', {
          body: `50% time remaining on "${currentTask.title}".`,
          tag: `focus-halfway-${key}`,
        });
      }
    }
  }, [session, currentTask, isPaused, remainingMs]);

  // Detect task expiration (00:00) and fire completion alerts
  useEffect(() => {
    if (!session || session.status !== 'active' || !currentTask || !session.task_deadline_at || isPaused) {
      if (!session || session.status !== 'active') {
        setExpiredTask(null);
        setCompletionAlertTask(null);
        stopRepeatingCompletionChime();
        stopTitleFlash('focus-complete');
      }
      return;
    }

    const deadlineMs = new Date(session.task_deadline_at).getTime();
    const isExpired = now >= deadlineMs;
    const notifyKey = `${session.id}:${session.current_task_index}:${session.task_deadline_at}`;

    if (isExpired) {
      if (notifiedKeyRef.current !== notifyKey && !hasExpiredAck(notifyKey)) {
        notifiedKeyRef.current = notifyKey;
        setExpiredTask(currentTask);
        setCompletionAlertTask(currentTask);

        startRepeatingCompletionChime();
        startTitleFlash('⏰ FOCUS DONE!', 'focus-complete');
        sendDesktopNotification('⏰ FOCUS DONE!', {
          body: `"${currentTask.title}" — Focus timer finished!`,
          tag: `focus-expired-${session.id}-${session.current_task_index}`,
          requireInteraction: true,
        });
      }
    } else {
      if (notifiedKeyRef.current === notifyKey) {
        notifiedKeyRef.current = null;
      }
      setExpiredTask(null);
      setCompletionAlertTask(null);
      stopRepeatingCompletionChime();
      stopTitleFlash('focus-complete');
    }
  }, [session, currentTask, isPaused, now]);

  const acknowledgeCompletionAlert = useCallback(() => {
    const s = sessionRef.current;
    if (s && s.task_deadline_at) {
      const notifyKey = `${s.id}:${s.current_task_index}:${s.task_deadline_at}`;
      markExpiredAck(notifyKey);
    }
    stopRepeatingCompletionChime();
    stopTitleFlash('focus-complete');
    setCompletionAlertTask(null);
    setExpiredTask(null);
  }, []);

  const acknowledgeHalfwayAlert = useCallback(() => {
    stopTitleFlash('focus-halfway');
    setHalfwayAlertTask(null);
  }, []);

  const dismissExpiredPopup = useCallback(() => {
    acknowledgeCompletionAlert();
  }, [acknowledgeCompletionAlert]);

  const startSession = useCallback(async (tasks: FocusSessionTask[]) => {
    if (tasks.length === 0) return;

    unlockAudio();
    void requestNotificationPermission();

    const existing = await getActiveFocusSession();
    if (existing) {
      const savedPausedMs = readSavedPause(existing.id, existing.current_task_index);
      if (savedPausedMs !== null) {
        setIsPaused(true);
        setPausedRemainingMs(savedPausedMs);
      } else {
        setIsPaused(false);
        setPausedRemainingMs(null);
      }
      setSession(existing);
      return existing;
    }

    const startedAt = new Date().toISOString();
    const totalMinutes = tasks[0].hours * 60 + tasks[0].minutes;
    const deadline = new Date(Date.now() + totalMinutes * 60_000).toISOString();

    try {
      const s = await createFocusSession(tasks, startedAt, deadline);
      notifiedKeyRef.current = null;
      halfwayKeyRef.current = null;
      setIsPaused(false);
      setPausedRemainingMs(null);
      setExpiredTask(null);
      setCompletionAlertTask(null);
      setNow(Date.now());
      setSession(s);
      return s;
    } catch (err) {
      const recovered = await getActiveFocusSession();
      if (recovered) {
        setSession(recovered);
        return recovered;
      }
      throw err;
    }
  }, []);

  const pauseSession = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.status !== 'active' || isPaused || !s.task_deadline_at) return;
    const exactRemainingMs = Math.max(0, new Date(s.task_deadline_at).getTime() - Date.now());
    if (exactRemainingMs <= 0) return;

    unlockAudio();
    writeSavedPause(s.id, s.current_task_index, exactRemainingMs);
    setPausedRemainingMs(exactRemainingMs);
    setIsPaused(true);
  }, [isPaused]);

  const resumeSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.status !== 'active' || !isPaused || pausedRemainingMs === null) return;

    unlockAudio();
    const newDeadline = new Date(Date.now() + pausedRemainingMs).toISOString();
    const updated = await updateFocusSession(s.id, {
      task_deadline_at: newDeadline,
    });
    clearSavedPause(s.id);
    setIsPaused(false);
    setPausedRemainingMs(null);
    setNow(Date.now());
    setSession(updated);
  }, [isPaused, pausedRemainingMs]);

  const cancelSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;

    stopRepeatingCompletionChime();
    stopTitleFlash('focus-complete');
    stopTitleFlash('focus-halfway');
    clearSessionLocalState(s);

    await deleteFocusSession(s.id);
    notifiedKeyRef.current = null;
    halfwayKeyRef.current = null;
    setIsPaused(false);
    setPausedRemainingMs(null);
    setExpiredTask(null);
    setCompletionAlertTask(null);
    setSession(null);
  }, []);

  const advanceToNextTask = useCallback(async (outcome: 'completed' | 'skipped') => {
    const s = sessionRef.current;
    if (!s || !currentTask) return;

    stopRepeatingCompletionChime();
    stopTitleFlash('focus-complete');
    stopTitleFlash('focus-halfway');
    clearSavedPause(s.id);

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
      halfwayKeyRef.current = null;
      setIsPaused(false);
      setPausedRemainingMs(null);
      setExpiredTask(null);
      setCompletionAlertTask(null);
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
    halfwayKeyRef.current = null;
    setIsPaused(false);
    setPausedRemainingMs(null);
    setExpiredTask(null);
    setCompletionAlertTask(null);
    setNow(Date.now());
    setSession(updated);
  }, [currentTask]);

  const postpone = useCallback(async (extraMinutes: number) => {
    const s = sessionRef.current;
    if (!s || !s.task_deadline_at) return;

    stopRepeatingCompletionChime();
    stopTitleFlash('focus-complete');

    const baseDeadline = new Date(s.task_deadline_at).getTime();
    const nowMs = Date.now();
    const startMs = baseDeadline < nowMs ? nowMs : baseDeadline;
    const newDeadline = new Date(startMs + extraMinutes * 60_000).toISOString();
    const updated = await updateFocusSession(s.id, {
      task_deadline_at: newDeadline,
    });
    clearSavedPause(s.id);
    notifiedKeyRef.current = null;
    setIsPaused(false);
    setPausedRemainingMs(null);
    setExpiredTask(null);
    setCompletionAlertTask(null);
    setNow(Date.now());
    setSession(updated);
  }, []);

  const dismissSession = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;

    stopRepeatingCompletionChime();
    stopTitleFlash('focus-complete');
    stopTitleFlash('focus-halfway');
    clearSessionLocalState(s);

    await updateFocusSession(s.id, { status: 'completed' });
    notifiedKeyRef.current = null;
    halfwayKeyRef.current = null;
    setIsPaused(false);
    setPausedRemainingMs(null);
    setExpiredTask(null);
    setCompletionAlertTask(null);
    setSession(null);
  }, []);

  return {
    session,
    currentTask,
    remainingMs,
    isAtZero,
    isPaused,
    now,
    expiredTask,
    completionAlertTask,
    halfwayAlertTask,
    acknowledgeCompletionAlert,
    acknowledgeHalfwayAlert,
    dismissExpiredPopup,
    startSession,
    pauseSession,
    resumeSession,
    cancelSession,
    advanceToNextTask,
    postpone,
    dismissSession,
    reloadSession: loadSession,
  };
}
