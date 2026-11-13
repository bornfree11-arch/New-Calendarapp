import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPermission } from '@/lib/alerts';
import {
  CalendarDays,
  LogOut,
  Search,
  Users,
  Building2,
  FileText,
  ScrollText,
  Bell,
  BellOff,
  ChevronDown,
  ListTodo,
  Calculator,
  MessageSquare,
  Timer,
  Contact,
  Pause,
} from 'lucide-react';
import { FocusSession, FocusSessionTask } from '@/types';

interface AppHeaderProps {
  onOpenSearch: () => void;
  onOpenUserManagement: () => void;
  onOpenCompanyManagement: () => void;
  onOpenCustomerDirectory: () => void;
  onOpenAuditLog: () => void;
  onOpenReminderStatus: () => void;
  onOpenExport: () => void;
  onOpenTasks: () => void;
  onOpenMessageStatus: () => void;
  messageFailureCount: number;
  focusSession?: FocusSession | null;
  focusCurrentTask?: FocusSessionTask | null;
  focusRemainingMs?: number;
  focusIsPaused?: boolean;
  onOpenFocus?: () => void;
}

export function AppHeader({
  onOpenSearch,
  onOpenUserManagement,
  onOpenCompanyManagement,
  onOpenCustomerDirectory,
  onOpenAuditLog,
  onOpenReminderStatus,
  onOpenExport,
  onOpenTasks,
  onOpenMessageStatus,
  messageFailureCount,
  focusSession,
  focusCurrentTask,
  focusRemainingMs,
  focusIsPaused,
  onOpenFocus,
}: AppHeaderProps) {
  const { profile, signOut } = useAuth();
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showBlockedHelp, setShowBlockedHelp] = useState(false);
  const { permission: notifPermission, requestPermission } = useNotificationPermission();
  const isAdmin = profile?.role === 'admin';

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center shrink-0">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-base font-semibold text-slate-800 truncate hidden sm:block">
            Shared Calendar
          </h1>
          {focusSession && focusCurrentTask && focusSession.status === 'active' && onOpenFocus && (
            <button
              onClick={onOpenFocus}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-lg transition shrink-0 ${
                focusIsPaused
                  ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                  : 'bg-teal-50 border-teal-200 hover:bg-teal-100'
              }`}
              title="Open Focus session"
            >
              <Timer className={`w-4 h-4 shrink-0 ${focusIsPaused ? 'text-amber-600' : 'text-teal-600'}`} />
              <span className={`truncate max-w-[140px] ${focusIsPaused ? 'text-amber-900' : 'text-teal-800'}`}>
                {focusCurrentTask.title}
              </span>
              {focusIsPaused && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-800">
                  <Pause className="w-2.5 h-2.5" />
                  Paused
                </span>
              )}
              <span className={`font-mono text-xs font-semibold px-1.5 py-0.5 rounded ${
                focusIsPaused
                  ? 'text-amber-800 bg-amber-100'
                  : (focusRemainingMs ?? 0) <= 0
                    ? 'text-red-700 bg-red-100'
                    : 'text-teal-700 bg-teal-100'
              }`}>
                {formatCountdown(focusRemainingMs ?? 0)}
              </span>
            </button>
          )}

          {(notifPermission === 'default' || notifPermission === 'denied') && (
            <div className="relative shrink-0">
              {notifPermission === 'default' ? (
                <button
                  onClick={() => { void requestPermission(); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition"
                  title="Enable desktop notifications for Focus timers and upcoming appointments"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Enable Alerts</span>
                </button>
              ) : (
                <button
                  onClick={() => setShowBlockedHelp(v => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition"
                  title="Desktop notifications are blocked in browser settings"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Alerts Blocked</span>
                </button>
              )}
              {showBlockedHelp && notifPermission === 'denied' && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBlockedHelp(false)} />
                  <div className="absolute left-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-40 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800 mb-1">Desktop Alerts Blocked</p>
                    <p>Enable Notifications in your browser&apos;s site permissions (lock icon in the address bar) to receive OS desktop alerts. In-app banners and sound chimes remain active.</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
  onClick={onOpenTasks}
  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
>
  <ListTodo className="w-4 h-4" />
  <span className="hidden sm:inline">Tasks</span>
</button>

<button
  onClick={onOpenFocus}
  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50 rounded-lg transition"
  title="Open Focus Mode"
>
  <Timer className="w-4 h-4" />
  <span className="hidden sm:inline">Focus</span>
</button>

          <button
            onClick={onOpenMessageStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition relative"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Msg Status</span>
            {messageFailureCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center">
                <span className="w-3 h-3 bg-red-500 rounded-full ring-2 ring-white" />
                {messageFailureCount > 0 && messageFailureCount <= 9 && (
                  <span className="absolute -top-1 -right-1 text-[9px] font-bold text-white bg-red-600 rounded-full w-4 h-4 flex items-center justify-center">
                    {messageFailureCount}
                  </span>
                )}
              </span>
            )}
          </button>

          <button
            onClick={onOpenCustomerDirectory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <Contact className="w-4 h-4" />
            <span className="hidden sm:inline">Customers</span>
          </button>

          <button
            onClick={onOpenSearch}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">Search</span>
          </button>

          <button
            onClick={() => {
              const win = window.open('https://payroll-tracker-florida-4059.ai.studio/', 'payrollTracker');
              if (win) win.focus();
              else alert('Popup was blocked. Please allow popups for this site to open the Payroll Tracker.');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <Calculator className="w-4 h-4" />
            <span className="hidden sm:inline">Payroll</span>
          </button>

          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => setShowAdminMenu(!showAdminMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                <span className="hidden sm:inline">Admin</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              {showAdminMenu && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setShowAdminMenu(false)}
                  />
                  <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-40 py-1.5">
                    <AdminMenuItem icon={<Users className="w-4 h-4" />} label="User Management" onClick={() => { onOpenUserManagement(); setShowAdminMenu(false); }} />
                    <AdminMenuItem icon={<Building2 className="w-4 h-4" />} label="Company Management" onClick={() => { onOpenCompanyManagement(); setShowAdminMenu(false); }} />
                    <AdminMenuItem icon={<ScrollText className="w-4 h-4" />} label="Audit Log" onClick={() => { onOpenAuditLog(); setShowAdminMenu(false); }} />
                    <AdminMenuItem icon={<Bell className="w-4 h-4" />} label="Reminder Status" onClick={() => { onOpenReminderStatus(); setShowAdminMenu(false); }} />
                    <AdminMenuItem icon={<FileText className="w-4 h-4" />} label="Export CSV" onClick={() => { onOpenExport(); setShowAdminMenu(false); }} />
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function AdminMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition text-left"
    >
      {icon}
      {label}
    </button>
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
