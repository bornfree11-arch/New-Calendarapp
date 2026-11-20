import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPermission } from '@/lib/alerts';
import { getInitials } from '@/lib/dateUtils';
import {
  CalendarDays,
  LogOut,
  Bell,
  BellOff,
  Timer,
  Pause,
} from 'lucide-react';
import { FocusSession, FocusSessionTask, isLightColor } from '@/types';

interface AppHeaderProps {
  focusSession?: FocusSession | null;
  focusCurrentTask?: FocusSessionTask | null;
  focusRemainingMs?: number;
  focusIsPaused?: boolean;
  onOpenFocus?: () => void;
}

export function AppHeader({
  focusSession,
  focusCurrentTask,
  focusRemainingMs,
  focusIsPaused,
  onOpenFocus,
}: AppHeaderProps) {
  const { profile, signOut } = useAuth();
  const [showBlockedHelp, setShowBlockedHelp] = useState(false);
  const { permission: notifPermission, requestPermission } = useNotificationPermission();

  const avatarBg = profile?.calendar_color || '#0D9488';
  const avatarLight = isLightColor(avatarBg);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 w-full">
      <div className="h-14 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 min-w-0">
        {/* Left: App Logo & Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 bg-teal-600 rounded-lg flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-white shrink-0" />
          </div>
          <h1 className="text-sm sm:text-base font-semibold text-slate-800 truncate">
            Shared Calendar
          </h1>
        </div>

        {/* Right: Active Focus Timer, Alerts Utility, User Profile & Log Out */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 min-w-0">
          {focusSession && focusCurrentTask && focusSession.status === 'active' && onOpenFocus && (
            <button
              type="button"
              onClick={onOpenFocus}
              className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 text-xs sm:text-sm font-medium border rounded-lg transition shrink-0 whitespace-nowrap ${
                focusIsPaused
                  ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                  : 'bg-teal-50 border-teal-200 hover:bg-teal-100'
              }`}
              title={`Open Focus session: ${focusCurrentTask.title}`}
            >
              <Timer className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${focusIsPaused ? 'text-amber-600' : 'text-teal-600'}`} />
              <span className={`hidden md:inline truncate max-w-[130px] shrink-0 ${focusIsPaused ? 'text-amber-900' : 'text-teal-800'}`}>
                {focusCurrentTask.title}
              </span>
              {focusIsPaused && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-800 shrink-0 whitespace-nowrap">
                  <Pause className="w-2.5 h-2.5 shrink-0" />
                  Paused
                </span>
              )}
              <span
                className={`font-mono text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${
                  focusIsPaused
                    ? 'text-amber-800 bg-amber-100'
                    : (focusRemainingMs ?? 0) <= 0
                      ? 'text-red-700 bg-red-100'
                      : 'text-teal-700 bg-teal-100'
                }`}
              >
                {formatCountdown(focusRemainingMs ?? 0)}
              </span>
            </button>
          )}

          {(notifPermission === 'default' || notifPermission === 'denied') && (
            <div className="relative shrink-0 whitespace-nowrap">
              {notifPermission === 'default' ? (
                <button
                  type="button"
                  onClick={() => { void requestPermission(); }}
                  className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition shrink-0 whitespace-nowrap"
                  title="Enable desktop notifications for Focus timers and upcoming appointments"
                >
                  <Bell className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">Enable Alerts</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowBlockedHelp((v) => !v)}
                  className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition shrink-0 whitespace-nowrap"
                  title="Desktop notifications are blocked in browser settings"
                >
                  <BellOff className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">Alerts Blocked</span>
                </button>
              )}
              {showBlockedHelp && notifPermission === 'denied' && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBlockedHelp(false)} />
                  <div className="absolute right-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-40 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800 mb-1">Desktop Alerts Blocked</p>
                    <p>Enable Notifications in your browser&apos;s site permissions (lock icon in the address bar) to receive OS desktop alerts. In-app banners and sound chimes remain active.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {profile && (
            <div
              className="flex items-center gap-2 pl-1.5 pr-1 sm:pr-2 py-1 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0"
              title={`${profile.full_name} (${profile.role})`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                  avatarLight ? 'text-slate-800' : 'text-white'
                }`}
                style={{ backgroundColor: avatarBg }}
              >
                {getInitials(profile.full_name || profile.email || 'U')}
              </span>
              <span className="hidden sm:inline text-xs font-medium text-slate-700 truncate max-w-[140px]">
                {profile.full_name}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => signOut()}
            title="Log Out"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition shrink-0 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
