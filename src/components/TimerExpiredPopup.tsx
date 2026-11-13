import { useState } from 'react';
import { FocusSessionTask } from '@/types';
import { useNotificationPermission, unlockAudio } from '@/lib/alerts';
import {
  X,
  Clock,
  PlusCircle,
  SkipForward,
  Bell,
  BellOff,
} from 'lucide-react';

interface TimerExpiredPopupProps {
  task: FocusSessionTask;
  onPostpone: (minutes: number) => void;
  onSkip: () => void;
  onDismiss: () => void;
  onOpenFocus: () => void;
}

export function TimerExpiredPopup({ task, onPostpone, onSkip, onDismiss, onOpenFocus }: TimerExpiredPopupProps) {
  const [showPostponeOptions, setShowPostponeOptions] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');
  const { permission: notifPermission, requestPermission } = useNotificationPermission();

  async function handleEnableNotifications() {
    await requestPermission();
  }

  function handlePostpone(minutes: number) {
    unlockAudio();
    onPostpone(minutes);
    onDismiss();
  }

  function handleSkip() {
    unlockAudio();
    onSkip();
    onDismiss();
  }

  const canNotify = notifPermission !== 'unsupported';
  const notifGranted = notifPermission === 'granted';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Red header */}
        <div className="bg-gradient-to-r from-red-600 to-red-700 px-5 py-4 relative">
          <button
            onClick={onDismiss}
            className="absolute top-2 right-2 p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 text-white">
            <Clock className="w-5 h-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Time Expired</span>
          </div>
          <p className="text-white text-lg font-bold mt-1 pr-8">
            {task.title}
          </p>
          <p className="text-red-100 text-sm mt-0.5">
            The allotted time for this task has ended.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Desktop notification permission prompt */}
          {canNotify && !notifGranted && (
            <div className="mb-4 flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              {notifPermission === 'denied' ? (
                <>
                  <BellOff className="w-5 h-5 text-slate-400 shrink-0" />
                  <p className="text-xs text-slate-500">
                    Desktop notifications are blocked. You'll still see this in-app popup when time expires.
                  </p>
                </>
              ) : (
                <>
                  <Bell className="w-5 h-5 text-teal-600 shrink-0" />
                  <p className="text-xs text-slate-600 flex-1">
                    Get a desktop alert even when this tab is in the background.
                  </p>
                  <button
                    onClick={handleEnableNotifications}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition shrink-0"
                  >
                    Enable
                  </button>
                </>
              )}
            </div>
          )}

          <p className="text-sm text-slate-600 mb-4">
            Choose an action for this task, or open Focus to continue working.
          </p>

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={() => setShowPostponeOptions(s => !s)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 rounded-xl transition"
            >
              <PlusCircle className="w-4 h-4" />
              Postpone — Add More Time
            </button>

            {showPostponeOptions && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {[15, 30, 45, 60].map(m => (
                    <button
                      key={m}
                      onClick={() => handlePostpone(m)}
                      className="px-3 py-1.5 text-sm font-medium bg-white text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition"
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
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(e.target.value)}
                    placeholder="Custom"
                    className="w-24 px-2 py-1.5 text-sm border border-slate-300 rounded-lg text-center focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition"
                  />
                  <span className="text-xs text-slate-500">minutes</span>
                  <button
                    onClick={() => {
                      const m = parseInt(customMinutes);
                      if (m > 0) handlePostpone(m);
                    }}
                    disabled={!customMinutes || parseInt(customMinutes) <= 0}
                    className="px-3 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleSkip}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 rounded-xl transition"
            >
              <SkipForward className="w-4 h-4" />
              Skip Task
            </button>

            <button
              onClick={() => { onOpenFocus(); onDismiss(); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-xl transition"
            >
              <Clock className="w-4 h-4" />
              Open Focus Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
