import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  CalendarDays,
  Calendar,
  List,
  ListTodo,
  Timer,
  MessageSquare,
  Contact,
  Search,
  Calculator,
  Shield,
  Users,
  Building2,
  ScrollText,
  Bell,
  FileText,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export type SidebarActiveView = 'monthly' | 'daily' | 'allAppointments' | 'tasks';
export type SidebarActiveModal =
  | 'search'
  | 'userManagement'
  | 'companyManagement'
  | 'customerDirectory'
  | 'auditLog'
  | 'exportCSV'
  | 'reminderStatus'
  | 'taskDetails'
  | 'messageStatus'
  | null;

interface AppSidebarProps {
  activeView: SidebarActiveView;
  activeModal: SidebarActiveModal;
  isFocusOpen: boolean;
  isFocusActive?: boolean;
  isFocusPaused?: boolean;
  onSelectView: (view: 'monthly' | 'daily' | 'allAppointments') => void;
  onOpenTasks: () => void;
  onOpenFocus: () => void;
  onOpenMessageStatus: () => void;
  onOpenCustomerDirectory: () => void;
  onOpenSearch: () => void;
  onOpenUserManagement: () => void;
  onOpenCompanyManagement: () => void;
  onOpenAuditLog: () => void;
  onOpenReminderStatus: () => void;
  onOpenExport: () => void;
  messageFailureCount: number;
}

function detectIsEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const isEmbedded = window.self !== window.top;
    return isEmbedded || new URLSearchParams(window.location.search).get('embedded') === 'true';
  } catch {
    return true;
  }
}

export function AppSidebar({
  activeView,
  activeModal,
  isFocusOpen,
  isFocusActive = false,
  isFocusPaused = false,
  onSelectView,
  onOpenTasks,
  onOpenFocus,
  onOpenMessageStatus,
  onOpenCustomerDirectory,
  onOpenSearch,
  onOpenUserManagement,
  onOpenCompanyManagement,
  onOpenAuditLog,
  onOpenReminderStatus,
  onOpenExport,
  messageFailureCount,
}: AppSidebarProps) {
  const { profile } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(() => detectIsEmbedded());
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const isAdminModalActive =
    activeModal === 'userManagement' ||
    activeModal === 'companyManagement' ||
    activeModal === 'auditLog' ||
    activeModal === 'reminderStatus' ||
    activeModal === 'exportCSV';

  function handlePayrollClick() {
    if (collapsed) setShowAdminMenu(false);
    const win = window.open('https://payroll-tracker-florida-4059.ai.studio/', 'payrollTracker');
    if (win) win.focus();
    else alert('Popup was blocked. Please allow popups for this site to open the Payroll Tracker.');
  }

  function closeCollapsedFlyout() {
    if (collapsed) setShowAdminMenu(false);
  }

  return (
    <aside
      aria-label="Primary Navigation"
      className={`sticky top-14 self-start min-h-[calc(100vh-3.5rem)] bg-white border-r border-slate-200 shrink-0 z-20 flex flex-col transition-[width] duration-200 ease-in-out select-none ${
        collapsed ? 'w-14' : 'w-48'
      }`}
    >
      {/* Top Collapse / Expand Toggle */}
      <div
        className={`flex items-center border-b border-slate-100 p-2 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 pl-2 truncate">
            Navigation
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setCollapsed((prev) => !prev);
            setShowAdminMenu(false);
          }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? undefined : 'Collapse sidebar'}
          className="group relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition shrink-0"
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
          {collapsed && <RailTooltip label="Expand menu" />}
        </button>
      </div>

      {/* Main Navigation Rail Items */}
      <nav className="flex-1 p-2 space-y-0.5">
        <RailItem
          icon={<CalendarDays className="w-4 h-4 shrink-0" />}
          label="Monthly"
          collapsed={collapsed}
          active={activeView === 'monthly'}
          onClick={() => {
            closeCollapsedFlyout();
            onSelectView('monthly');
          }}
        />
        <RailItem
          icon={<Calendar className="w-4 h-4 shrink-0" />}
          label="Daily"
          collapsed={collapsed}
          active={activeView === 'daily'}
          onClick={() => {
            closeCollapsedFlyout();
            onSelectView('daily');
          }}
        />
        <RailItem
          icon={<List className="w-4 h-4 shrink-0" />}
          label="All Appointments"
          collapsed={collapsed}
          active={activeView === 'allAppointments'}
          onClick={() => {
            closeCollapsedFlyout();
            onSelectView('allAppointments');
          }}
        />
        <RailItem
          icon={<ListTodo className="w-4 h-4 shrink-0" />}
          label="Tasks"
          collapsed={collapsed}
          active={activeView === 'tasks'}
          onClick={() => {
            closeCollapsedFlyout();
            onOpenTasks();
          }}
        />

        <div className="my-1.5 border-t border-slate-100 mx-1" />

        <RailItem
          icon={<Timer className="w-4 h-4 shrink-0" />}
          label="Focus"
          collapsed={collapsed}
          active={isFocusOpen}
          statusDot={
            isFocusActive
              ? isFocusPaused
                ? 'bg-amber-500'
                : 'bg-teal-500 animate-pulse'
              : undefined
          }
          onClick={() => {
            closeCollapsedFlyout();
            onOpenFocus();
          }}
        />
        <RailItem
          icon={<MessageSquare className="w-4 h-4 shrink-0" />}
          label="Msg Status"
          collapsed={collapsed}
          active={activeModal === 'messageStatus'}
          badgeCount={messageFailureCount}
          onClick={() => {
            closeCollapsedFlyout();
            onOpenMessageStatus();
          }}
        />
        <RailItem
          icon={<Contact className="w-4 h-4 shrink-0" />}
          label="Customers"
          collapsed={collapsed}
          active={activeModal === 'customerDirectory'}
          onClick={() => {
            closeCollapsedFlyout();
            onOpenCustomerDirectory();
          }}
        />
        <RailItem
          icon={<Search className="w-4 h-4 shrink-0" />}
          label="Search"
          collapsed={collapsed}
          active={activeModal === 'search'}
          onClick={() => {
            closeCollapsedFlyout();
            onOpenSearch();
          }}
        />
        <RailItem
          icon={<Calculator className="w-4 h-4 shrink-0" />}
          label="Payroll"
          collapsed={collapsed}
          active={false}
          onClick={handlePayrollClick}
        />

        {isAdmin && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAdminMenu((v) => !v)}
              aria-expanded={showAdminMenu}
              aria-label="Admin"
              className={`group relative w-full flex items-center rounded-lg text-sm transition ${
                collapsed ? 'justify-center px-0 py-2' : 'justify-between px-2.5 py-2'
              } ${
                isAdminModalActive || showAdminMenu
                  ? 'bg-teal-50 text-teal-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 min-w-0'}`}>
                <Shield className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">Admin</span>}
              </span>
              {!collapsed &&
                (showAdminMenu ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                ))}
              {collapsed && !showAdminMenu && <RailTooltip label="Admin" />}
            </button>

            {/* Collapsed mode: floating flyout menu to the right */}
            {showAdminMenu && collapsed && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowAdminMenu(false)}
                />
                <div className="absolute left-full top-0 ml-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5">
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
                    Admin
                  </div>
                  <AdminFlyoutItem
                    icon={<Users className="w-4 h-4 shrink-0" />}
                    label="User Management"
                    active={activeModal === 'userManagement'}
                    onClick={() => {
                      onOpenUserManagement();
                      setShowAdminMenu(false);
                    }}
                  />
                  <AdminFlyoutItem
                    icon={<Building2 className="w-4 h-4 shrink-0" />}
                    label="Company Management"
                    active={activeModal === 'companyManagement'}
                    onClick={() => {
                      onOpenCompanyManagement();
                      setShowAdminMenu(false);
                    }}
                  />
                  <AdminFlyoutItem
                    icon={<ScrollText className="w-4 h-4 shrink-0" />}
                    label="Audit Log"
                    active={activeModal === 'auditLog'}
                    onClick={() => {
                      onOpenAuditLog();
                      setShowAdminMenu(false);
                    }}
                  />
                  <AdminFlyoutItem
                    icon={<Bell className="w-4 h-4 shrink-0" />}
                    label="Reminder Status"
                    active={activeModal === 'reminderStatus'}
                    onClick={() => {
                      onOpenReminderStatus();
                      setShowAdminMenu(false);
                    }}
                  />
                  <AdminFlyoutItem
                    icon={<FileText className="w-4 h-4 shrink-0" />}
                    label="Export CSV"
                    active={activeModal === 'exportCSV'}
                    onClick={() => {
                      onOpenExport();
                      setShowAdminMenu(false);
                    }}
                  />
                </div>
              </>
            )}

            {/* Expanded mode: inline collapsible submenu */}
            {showAdminMenu && !collapsed && (
              <div className="mt-0.5 ml-3 pl-2 border-l border-slate-200 space-y-0.5">
                <AdminInlineItem
                  icon={<Users className="w-3.5 h-3.5 shrink-0" />}
                  label="User Management"
                  active={activeModal === 'userManagement'}
                  onClick={onOpenUserManagement}
                />
                <AdminInlineItem
                  icon={<Building2 className="w-3.5 h-3.5 shrink-0" />}
                  label="Company Management"
                  active={activeModal === 'companyManagement'}
                  onClick={onOpenCompanyManagement}
                />
                <AdminInlineItem
                  icon={<ScrollText className="w-3.5 h-3.5 shrink-0" />}
                  label="Audit Log"
                  active={activeModal === 'auditLog'}
                  onClick={onOpenAuditLog}
                />
                <AdminInlineItem
                  icon={<Bell className="w-3.5 h-3.5 shrink-0" />}
                  label="Reminder Status"
                  active={activeModal === 'reminderStatus'}
                  onClick={onOpenReminderStatus}
                />
                <AdminInlineItem
                  icon={<FileText className="w-3.5 h-3.5 shrink-0" />}
                  label="Export CSV"
                  active={activeModal === 'exportCSV'}
                  onClick={onOpenExport}
                />
              </div>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}

interface RailItemProps {
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  active: boolean;
  badgeCount?: number;
  statusDot?: string;
  onClick: () => void;
}

function RailItem({
  icon,
  label,
  collapsed,
  active,
  badgeCount = 0,
  statusDot,
  onClick,
}: RailItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`group relative w-full flex items-center rounded-lg text-sm transition ${
        collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-2'
      } ${
        active
          ? 'bg-teal-50 text-teal-700 font-medium'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      <span className="relative shrink-0 flex items-center justify-center">
        {icon}
        {collapsed && statusDot && (
          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white ${statusDot}`} />
        )}
        {collapsed && badgeCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-600 text-white text-[9px] font-bold rounded-full ring-2 ring-white flex items-center justify-center">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </span>

      {!collapsed && (
        <>
          <span className="truncate flex-1 text-left">{label}</span>
          {statusDot && (
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
          )}
          {badgeCount > 0 && (
            <span className="ml-auto bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
        </>
      )}

      {collapsed && (
        <RailTooltip label={badgeCount > 0 ? `${label} (${badgeCount})` : label} />
      )}
    </button>
  );
}

function AdminFlyoutItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition text-left ${
        active
          ? 'bg-teal-50 text-teal-700 font-medium'
          : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function AdminInlineItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition text-left ${
        active
          ? 'bg-teal-50 text-teal-700 font-medium'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function RailTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 absolute left-full ml-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap shadow-lg z-50"
    >
      {label}
    </span>
  );
}
