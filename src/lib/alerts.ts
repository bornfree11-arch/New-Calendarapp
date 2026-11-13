import { useState, useEffect, useCallback } from 'react';

const NOTIF_STORAGE_KEY = 'calendar_notif_permission_state';
const NOTIF_EVENT_NAME = 'calendar-notif-permission-changed';

export type NotificationStatus = NotificationPermission | 'unsupported';

// ---------------------------------------------------------------------------
// Notification Permission Helpers
// ---------------------------------------------------------------------------

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationStatus {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

function persistPermissionStatus(status: NotificationStatus): void {
  try {
    localStorage.setItem(NOTIF_STORAGE_KEY, status);
  } catch {
    // Ignore storage quota or private-mode errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIF_EVENT_NAME, { detail: status }));
  }
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  if (!isNotificationSupported()) {
    persistPermissionStatus('unsupported');
    return 'unsupported';
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    persistPermissionStatus(Notification.permission);
    return Notification.permission;
  }

  try {
    const result = await Notification.requestPermission();
    persistPermissionStatus(result);
    return result;
  } catch {
    const current = Notification.permission;
    persistPermissionStatus(current);
    return current;
  }
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationStatus>(() => getNotificationPermission());

  useEffect(() => {
    const sync = () => {
      const current = getNotificationPermission();
      setPermission(current);
      persistPermissionStatus(current);
    };

    sync();

    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent<NotificationStatus>).detail;
      setPermission(detail || getNotificationPermission());
    };

    window.addEventListener(NOTIF_EVENT_NAME, handleCustom);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);

    return () => {
      window.removeEventListener(NOTIF_EVENT_NAME, handleCustom);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const requestPermission = useCallback(async () => {
    unlockAudio();
    const res = await requestNotificationPermission();
    setPermission(res);
    return res;
  }, []);

  return { permission, requestPermission };
}

export function sendDesktopNotification(
  title: string,
  options?: { body?: string; tag?: string; requireInteraction?: boolean },
): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(title, {
      body: options?.body,
      tag: options?.tag,
      requireInteraction: options?.requireInteraction ?? false,
    });
    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
      } catch {
        // Ignore focus/close errors
      }
    };
  } catch {
    // Some environments restrict the Notification constructor
  }
}

// ---------------------------------------------------------------------------
// Web Audio API Chimes (No external MP3 dependencies)
// ---------------------------------------------------------------------------

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

interface ToneStep {
  frequency: number;
  startOffsetSec: number;
  durationSec: number;
  gain: number;
  type?: OscillatorType;
}

function playToneSequence(steps: ToneStep[]): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const baseTime = ctx.currentTime + 0.02;
    for (const step of steps) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = step.type ?? 'sine';
      osc.frequency.setValueAtTime(step.frequency, baseTime + step.startOffsetSec);

      const t0 = baseTime + step.startOffsetSec;
      const tEnd = t0 + step.durationSec;

      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, step.gain), t0 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(t0);
      osc.stop(tEnd + 0.02);
    }
  } catch {
    // Ignore audio playback errors if blocked by browser policy
  }
}

/** Gentle two-tone chime for Focus 50% halfway mark */
export function playHalfwayChime(): void {
  playToneSequence([
    { frequency: 523.25, startOffsetSec: 0, durationSec: 0.25, gain: 0.16, type: 'sine' },
    { frequency: 659.25, startOffsetSec: 0.2, durationSec: 0.35, gain: 0.18, type: 'sine' },
  ]);
}

/** Clear alert chime for 10-minute pre-appointment staff alert */
export function playAppointmentChime(): void {
  playToneSequence([
    { frequency: 587.33, startOffsetSec: 0, durationSec: 0.18, gain: 0.22, type: 'triangle' },
    { frequency: 880.0, startOffsetSec: 0.16, durationSec: 0.34, gain: 0.24, type: 'sine' },
  ]);
}

/** Louder 3-note chime for Focus timer completion */
function playCompletionBurst(): void {
  playToneSequence([
    { frequency: 523.25, startOffsetSec: 0, durationSec: 0.2, gain: 0.34, type: 'triangle' },
    { frequency: 659.25, startOffsetSec: 0.18, durationSec: 0.2, gain: 0.36, type: 'triangle' },
    { frequency: 783.99, startOffsetSec: 0.36, durationSec: 0.42, gain: 0.4, type: 'triangle' },
  ]);
}

let completionChimeInterval: number | null = null;

export function startRepeatingCompletionChime(): void {
  if (typeof window === 'undefined') return;
  if (completionChimeInterval !== null) return;
  playCompletionBurst();
  completionChimeInterval = window.setInterval(() => {
    playCompletionBurst();
  }, 2800);
}

export function stopRepeatingCompletionChime(): void {
  if (completionChimeInterval !== null) {
    window.clearInterval(completionChimeInterval);
    completionChimeInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Browser Tab Title Flashing Helpers
// ---------------------------------------------------------------------------

let originalDocumentTitle: string | null = null;
let titleFlashInterval: number | null = null;
let titleFlashTimeout: number | null = null;
let activeFlashKey: string | null = null;

function ensureOriginalTitle(): string {
  if (originalDocumentTitle === null && typeof document !== 'undefined') {
    originalDocumentTitle = document.title || 'Shared Calendar And Appointment Management App';
  }
  return originalDocumentTitle || 'Shared Calendar And Appointment Management App';
}

export function startTitleFlash(message: string, key: string, durationMs?: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const baseTitle = ensureOriginalTitle();

  if (titleFlashInterval !== null) {
    window.clearInterval(titleFlashInterval);
    titleFlashInterval = null;
  }
  if (titleFlashTimeout !== null) {
    window.clearTimeout(titleFlashTimeout);
    titleFlashTimeout = null;
  }

  activeFlashKey = key;
  let showAlert = true;
  document.title = message;

  titleFlashInterval = window.setInterval(() => {
    showAlert = !showAlert;
    document.title = showAlert ? message : baseTitle;
  }, 1000);

  if (durationMs && durationMs > 0) {
    titleFlashTimeout = window.setTimeout(() => {
      if (activeFlashKey === key) {
        stopTitleFlash(key);
      }
    }, durationMs);
  }
}

export function stopTitleFlash(key?: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (key && activeFlashKey && activeFlashKey !== key) return;

  if (titleFlashInterval !== null) {
    window.clearInterval(titleFlashInterval);
    titleFlashInterval = null;
  }
  if (titleFlashTimeout !== null) {
    window.clearTimeout(titleFlashTimeout);
    titleFlashTimeout = null;
  }
  activeFlashKey = null;

  if (originalDocumentTitle !== null) {
    document.title = originalDocumentTitle;
  }
}
