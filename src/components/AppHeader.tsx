import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  CalendarDays,
  LogOut,
  Search,
  Users,
  Building2,
  FileText,
  ScrollText,
  Bell,
  ChevronDown,
  ListTodo,
  Calculator,
} from 'lucide-react';

interface AppHeaderProps {
  onOpenSearch: () => void;
  onOpenUserManagement: () => void;
  onOpenCompanyManagement: () => void;
  onOpenAuditLog: () => void;
  onOpenReminderStatus: () => void;
  onOpenExport: () => void;
  onOpenTasks: () => void;
}

export function AppHeader({
  onOpenSearch,
  onOpenUserManagement,
  onOpenCompanyManagement,
  onOpenAuditLog,
  onOpenReminderStatus,
  onOpenExport,
  onOpenTasks,
}: AppHeaderProps) {
  const { profile, signOut } = useAuth();
  const [showAdminMenu, setShowAdminMenu] = useState(false);
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
