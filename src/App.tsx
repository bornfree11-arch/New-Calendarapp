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
import { addDays, parseDateISO } from '@/lib/dateUtils';
import { Loader2 } from 'lucide-react';

type View = 'monthly' | 'daily' | 'tasks';
type Modal = 'search' | 'userManagement' | 'companyManagement' | 'auditLog' | 'exportCSV' | 'reminderStatus' | 'taskDetails' | null;

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

      {view === 'monthly' && (
        <MonthlyView
          onSelectDate={handleSelectDate}
          onOpenSearch={() => setModal('search')}
          onOpenUserManagement={() => setModal('userManagement')}
          onOpenCompanyManagement={() => setModal('companyManagement')}
          onOpenAuditLog={() => setModal('auditLog')}
          onOpenReminderStatus={() => setModal('reminderStatus')}
          onOpenExport={() => setModal('exportCSV')}
          onOpenTasks={() => setView('tasks')}
          onOpenTask={(id) => { setTaskModalId(id); setTaskModalIsNew(false); }}
          onNewTask={() => { setTaskModalId(null); setTaskModalIsNew(true); }}
          dataVersion={dataVersion}
        />
      )}

      {view === 'tasks' && (
        <TasksScreen
          onBackToCalendar={() => setView('monthly')}
          onSignOut={() => signOut()}
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
          onOpenTasks={() => setView('tasks')}
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

      {modal === 'auditLog' && profile.role === 'admin' && (
        <AuditLog onClose={() => setModal(null)} />
      )}

      {modal === 'exportCSV' && profile.role === 'admin' && (
        <ExportCSV profiles={profiles} companies={companies} onClose={() => setModal(null)} />
      )}

      {modal === 'reminderStatus' && profile.role === 'admin' && (
        <ReminderStatus onClose={() => setModal(null)} />
      )}

      {(taskModalIsNew || taskModalId) && (
        <TaskDetailsModal
          taskId={taskModalId}
          isNew={taskModalIsNew}
          onClose={() => { setTaskModalId(null); setTaskModalIsNew(false); }}
          onChanged={() => setDataVersion(v => v + 1)}
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
