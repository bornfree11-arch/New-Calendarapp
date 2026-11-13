import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  getProfiles,
  getCompanies,
  getTypeMappings,
  deleteAppointment as storeDeleteAppointment,
} from '@/lib/store';
import { Appointment, Profile, Company, AppointmentTypeMapping } from '@/types';
import { getUnacknowledgedFailureCount } from '@/lib/store';
import { SetupScreen } from '@/screens/SetupScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { MonthlyView } from '@/screens/MonthlyView';
import { DailyView } from '@/screens/DailyView';
import { AppointmentForm } from '@/components/AppointmentForm';
import { AppointmentDetails } from '@/components/AppointmentDetails';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { SearchModal } from '@/components/SearchModal';
import { UserManagement } from '@/screens/UserManagement';
import { CompanyManagement } from '@/screens/CompanyManagement';
import { AuditLog } from '@/screens/AuditLog';
import { ExportCSV } from '@/screens/ExportCSV';
import { ReminderStatus } from '@/screens/ReminderStatus';
import { ResetPasswordScreen } from '@/screens/ResetPasswordScreen';
import { TasksScreen } from '@/screens/TasksScreen';
import { TaskDetailsModal } from '@/components/TaskDetailsModal';
import { MessageStatusCenter } from '@/screens/MessageStatusCenter';
import { CustomerDirectory } from '@/screens/CustomerDirectory';
import { FocusModeWindow } from '@/screens/FocusModeWindow';
import { AppHeader } from '@/components/AppHeader';
import { TimerExpiredPopup } from '@/components/TimerExpiredPopup';
import { useFocusSession } from '@/lib/useFocusSession';
import { useAppointmentAlerts } from '@/lib/useAppointmentAlerts';
import { getNotificationPermission, requestNotificationPermission } from '@/lib/alerts';
import { addDays, parseDateISO, formatDateISO, formatTime12 } from '@/lib/dateUtils';
import { Loader2, Clock, VolumeX, BellRing, X } from 'lucide-react';

type View = 'monthly' | 'daily' | 'tasks';
type Modal = 'search' | 'userManagement' | 'companyManagement' | 'customerDirectory' | 'auditLog' | 'exportCSV' | 'reminderStatus' | 'taskDetails' | 'messageStatus' | null;

function AppContent() {
  const { profile, loading, passwordRecovery, clearPasswordRecovery, signOut } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [view, setView] = useState<View>('monthly');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [formState, setFormState] = useState<{
    open: boolean;
    appointment: Appointment | null;
    date: Date | null;
    startTime: string | null;
  }>({ open: false, appointment: null, date: null, startTime: null });
  const [detailsAppointment, setDetailsAppointment] = useState<Appointment | null>(null);
  const [deleteAppointment, setDeleteAppointment] = useState<Appointment | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [typeMappings, setTypeMappings] = useState<AppointmentTypeMapping[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [dataError, setDataError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [taskModalId, setTaskModalId] = useState<string | null>(null);
  const [taskModalIsNew, setTaskModalIsNew] = useState(false);
  const [taskModalDefaultDueDate, setTaskModalDefaultDueDate] = useState<string | undefined>(undefined);
  const [messageFailureCount, setMessageFailureCount] = useState(0);
  const [focusOpen, setFocusOpen] = useState(false);
  const focusSession = useFocusSession({ profile, authLoading: loading });
  const { upcomingAlerts, dismissUpcomingAlert } = useAppointmentAlerts({
    profile,
    authLoading: loading,
    dataVersion,
  });

  const loadReferenceData = useCallback(async () => {
    try {
      setDataError('');
      const [p, c, m] = await Promise.all([
        getProfiles(),
        getCompanies(),
        getTypeMappings(),
      ]);
      setProfiles(p);
      setCompanies(c);
      setTypeMappings(m);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load data.');
    }
  }, []);

  useEffect(() => {
    if (!profile) {
      setNeedsSetup(false);
      return;
    }
    setNeedsSetup(false);
    loadReferenceData();
  }, [profile, dataVersion, loadReferenceData]);

  // Load unacknowledged failure count and subscribe to realtime changes
  useEffect(() => {
    if (!profile) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadCount() {
      try {
        const count = await getUnacknowledgedFailureCount();
        setMessageFailureCount(count);
      } catch {
        // Best-effort — don't surface errors for the indicator
      }
    }

    loadCount();

    channel = supabase
      .channel('delivery-alerts-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_alerts' },
        () => { loadCount(); }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'reminder_attempts' },
        () => { loadCount(); }
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [profile]);

  // Check if an admin already exists before showing onboarding
  useEffect(() => {
    if (loading) return;
    if (profile) return;
    (async () => {
      const { data, error } = await supabase.rpc('admin_exists');
      if (!error && data === false) {
        setNeedsSetup(true);
      }
    })();
  }, [loading, profile]);

  // Surface the password-recovery screen when Supabase emits the event
  useEffect(() => {
    if (passwordRecovery) setShowResetPassword(true);
  }, [passwordRecovery]);

  // Request OS browser notification permission upfront when authenticated app loads
  useEffect(() => {
    if (loading || !profile) return;
    if (getNotificationPermission() === 'default') {
      void requestNotificationPermission();
    }
  }, [loading, profile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (showResetPassword) {
    return (
      <ResetPasswordScreen
        onDone={() => {
          setShowResetPassword(false);
          clearPasswordRecovery();
        }}
        onBackToLogin={() => {
          supabase.auth.signOut();
          setShowResetPassword(false);
          clearPasswordRecovery();
        }}
      />
    );
  }

  if (!profile) {
    if (needsSetup) {
      return <SetupScreen />;
    }
    return <LoginScreen onSetup={() => setNeedsSetup(true)} />;
  }

  const profileMap = new Map(profiles.map(p => [p.id, p]));
  const companyMap = new Map(companies.map(c => [c.id, c]));

  function handleSelectDate(date: Date) {
    setSelectedDate(date);
    setView('daily');
  }

  function handleSlotClick(date: Date, startTime: string) {
    setFormState({ open: true, appointment: null, date, startTime });
    setDetailsAppointment(null);
  }

  function handleAppointmentClick(appointment: Appointment) {
    setDetailsAppointment(appointment);
  }

  function handleEditAppointment() {
    if (detailsAppointment) {
      setFormState({
        open: true,
        appointment: detailsAppointment,
        date: parseDateISO(detailsAppointment.appointment_date),
        startTime: detailsAppointment.start_time,
      });
      setDetailsAppointment(null);
    }
  }

  async function handleDeleteAppointment() {
    if (!deleteAppointment) return;
    setDeleteLoading(true);
    try {
      await storeDeleteAppointment(deleteAppointment.id, profile?.id || null);
      setDeleteAppointment(null);
      setDetailsAppointment(null);
      setDataVersion(v => v + 1);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to delete appointment.');
    } finally {
      setDeleteLoading(false);
    }
  }

  function handleFormClose() {
    setFormState({ open: false, appointment: null, date: null, startTime: null });
  }

  function handleFormSaved() {
    setFormState({ open: false, appointment: null, date: null, startTime: null });
    setDataVersion(v => v + 1);
  }

  function handleSearchResultClick(appointment: Appointment) {
    setModal(null);
    const apptDate = parseDateISO(appointment.appointment_date);
    setSelectedDate(apptDate);
    setDetailsAppointment(appointment);
    setView('daily');
  }

  return (
    <>
      {dataError && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-sm px-4 py-2 text-center">
          {dataError}
        </div>
      )}

      <AppHeader
        onOpenSearch={() => setModal('search')}
        onOpenUserManagement={() => setModal('userManagement')}
        onOpenCompanyManagement={() => setModal('companyManagement')}
        onOpenCustomerDirectory={() => setModal('customerDirectory')}
        onOpenAuditLog={() => setModal('auditLog')}
        onOpenReminderStatus={() => setModal('reminderStatus')}
        onOpenExport={() => setModal('exportCSV')}
        onOpenTasks={() => setView('tasks')}
        onOpenMessageStatus={() => setModal('messageStatus')}
        messageFailureCount={messageFailureCount}
        focusSession={focusSession.session}
        focusCurrentTask={focusSession.currentTask}
        focusRemainingMs={focusSession.remainingMs}
        focusIsPaused={focusSession.isPaused}
        onOpenFocus={() => setFocusOpen(true)}
      />

      {(focusSession.halfwayAlertTask || focusSession.completionAlertTask || upcomingAlerts.length > 0) && (
        <div className="sticky top-14 z-20">
          {focusSession.halfwayAlertTask && (
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white border-b border-amber-700 shadow-md">
              <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Clock className="w-5 h-5 shrink-0 animate-pulse" />
                  <div className="min-w-0">
                    <span className="text-sm font-bold">
                      HALFWAY WARNING
                    </span>{' '}
                    <span className="text-sm text-amber-100">
                      ⏳ Halfway through &ldquo;{focusSession.halfwayAlertTask.title}&rdquo;!
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFocusOpen(true)}
                    className="px-3 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg transition"
                  >
                    Open Focus
                  </button>
                  <button
                    onClick={() => focusSession.acknowledgeHalfwayAlert()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-amber-800 hover:bg-amber-50 rounded-lg transition shadow-sm"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {focusSession.completionAlertTask && (
            <div className="bg-gradient-to-r from-red-600 to-red-700 text-white border-b border-red-800 shadow-md">
              <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Clock className="w-5 h-5 shrink-0 animate-pulse" />
                  <div className="min-w-0">
                    <span className="text-sm font-bold">
                      FOCUS DONE!
                    </span>{' '}
                    <span className="text-sm text-red-100">
                      Timer finished for &ldquo;{focusSession.completionAlertTask.title}&rdquo;.
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFocusOpen(true)}
                    className="px-3 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg transition"
                  >
                    Open Focus
                  </button>
                  <button
                    onClick={() => focusSession.acknowledgeCompletionAlert()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-red-700 hover:bg-red-50 rounded-lg transition shadow-sm"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    Acknowledge &amp; Silence
                  </button>
                </div>
              </div>
            </div>
          )}

          {upcomingAlerts.map((alert) => {
            const assignedProfile = profileMap.get(alert.appointment.assigned_to);
            return (
              <div
                key={alert.appointment.id}
                className="bg-amber-50 border-b border-amber-200 text-amber-950 shadow-sm"
              >
                <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <BellRing className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="text-sm min-w-0">
                      <span className="font-semibold">
                        Upcoming Appointment in {alert.minutesUntil > 0 ? `${alert.minutesUntil} min` : '10 min'}:
                      </span>{' '}
                      <span className="font-medium">{alert.appointment.client_name}</span>{' '}
                      at <span className="font-semibold">{formatTime12(alert.appointment.start_time)}</span>
                      <span className="text-amber-700 text-xs ml-2">
                        ({alert.appointment.appointment_type}
                        {assignedProfile ? ` · ${assignedProfile.full_name}` : ''})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setSelectedDate(parseDateISO(alert.appointment.appointment_date));
                        setDetailsAppointment(alert.appointment);
                      }}
                      className="px-2.5 py-1 text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 rounded-lg transition"
                    >
                      View
                    </button>
                    <button
                      onClick={() => dismissUpcomingAlert(alert.appointment.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200/70 rounded-lg transition"
                      title="Dismiss alert"
                    >
                      <X className="w-3.5 h-3.5" />
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'monthly' && (
        <MonthlyView
          onSelectDate={handleSelectDate}
          onOpenTasks={() => setView('tasks')}
          onOpenTask={(id) => { setTaskModalId(id); setTaskModalIsNew(false); }}
          onNewTask={() => { setTaskModalDefaultDueDate(formatDateISO(new Date())); setTaskModalId(null); setTaskModalIsNew(true); }}
          dataVersion={dataVersion}
        />
      )}

      {view === 'tasks' && (
        <TasksScreen
          onBackToCalendar={() => setView('monthly')}
          onSignOut={() => signOut()}
          onOpenFocus={() => setFocusOpen(true)}
        />
      )}

      {view === 'daily' && (
        <DailyView
          date={selectedDate}
          onBackToMonthly={() => setView('monthly')}
          onPrevDay={() => setSelectedDate(addDays(selectedDate, -1))}
          onNextDay={() => setSelectedDate(addDays(selectedDate, 1))}
          onSlotClick={handleSlotClick}
          onAppointmentClick={handleAppointmentClick}
          onTaskClick={(id) => { setTaskModalId(id); setTaskModalIsNew(false); }}
          onAddTask={(defaultDate) => { setTaskModalDefaultDueDate(formatDateISO(defaultDate)); setTaskModalId(null); setTaskModalIsNew(true); }}
          dataVersion={dataVersion}
        />
      )}

      {formState.open && formState.date && (
        <AppointmentForm
          appointment={formState.appointment}
          initialDate={formState.date}
          initialStartTime={formState.startTime}
          profiles={profiles}
          companies={companies}
          typeMappings={typeMappings}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}

      {detailsAppointment && (
        <AppointmentDetails
          appointment={detailsAppointment}
          profile={profileMap.get(detailsAppointment.assigned_to)}
          company={detailsAppointment.company_id ? companyMap.get(detailsAppointment.company_id) || null : null}
          onEdit={handleEditAppointment}
          onDelete={() => { setDeleteAppointment(detailsAppointment); setDetailsAppointment(null); }}
          onClose={() => setDetailsAppointment(null)}
        />
      )}

      {deleteAppointment && (
        <DeleteConfirmDialog
          appointment={deleteAppointment}
          profile={profileMap.get(deleteAppointment.assigned_to)}
          onConfirm={handleDeleteAppointment}
          onCancel={() => setDeleteAppointment(null)}
          loading={deleteLoading}
        />
      )}

      {modal === 'search' && (
        <SearchModal
          profiles={profiles}
          onClose={() => setModal(null)}
          onResultClick={handleSearchResultClick}
        />
      )}

      {modal === 'userManagement' && profile.role === 'admin' && (
        <UserManagement onClose={() => setModal(null)} onDataChange={() => setDataVersion(v => v + 1)} />
      )}

      {modal === 'companyManagement' && profile.role === 'admin' && (
        <CompanyManagement onClose={() => setModal(null)} onDataChange={() => setDataVersion(v => v + 1)} />
      )}

      {modal === 'customerDirectory' && (
        <CustomerDirectory onClose={() => setModal(null)} onDataChange={() => setDataVersion(v => v + 1)} />
      )}

      {modal === 'auditLog' && profile.role === 'admin' && (
        <AuditLog onClose={() => setModal(null)} />
      )}

      {modal === 'exportCSV' && profile.role === 'admin' && (
        <ExportCSV profiles={profiles} companies={companies} onClose={() => setModal(null)} />
      )}

      {modal === 'reminderStatus' && profile.role === 'admin' && (
        <ReminderStatus onClose={() => setModal(null)} />
      )}

      {modal === 'messageStatus' && profile.role === 'admin' && (
        <MessageStatusCenter onClose={() => setModal(null)} />
      )}

      {(taskModalIsNew || taskModalId) && (
        <TaskDetailsModal
          taskId={taskModalId}
          isNew={taskModalIsNew}
          defaultDueDate={taskModalDefaultDueDate}
          onClose={() => { setTaskModalId(null); setTaskModalIsNew(false); setTaskModalDefaultDueDate(undefined); }}
          onChanged={() => setDataVersion(v => v + 1)}
        />
      )}

      {focusOpen && (
        <FocusModeWindow
          onClose={() => setFocusOpen(false)}
          focusSession={focusSession}
        />
      )}

      {focusSession.expiredTask && !focusOpen && (
        <TimerExpiredPopup
          task={focusSession.expiredTask}
          onPostpone={(m) => focusSession.postpone(m)}
          onSkip={() => focusSession.advanceToNextTask('skipped')}
          onDismiss={focusSession.dismissExpiredPopup}
          onOpenFocus={() => setFocusOpen(true)}
        />
      )}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
