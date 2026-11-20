import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getCustomers,
  saveCustomer,
  deleteCustomer,
  searchCustomers,
  getCompanies,
  getProfiles,
  getAppointments,
  findMatchingCustomer,
  mergeCustomers,
  isCustomerVisibleForCompany,
  getCustomerRole,
  setCustomerRoleTag,
  parseCsvText,
  detectHeaderMapping,
  buildCsvImportPreview,
  batchImportCustomers,
} from '@/lib/store';
import { useAuth } from '@/context/AuthContext';
import { Customer, Company, Profile, CustomerRole, CUSTOMER_ROLES, Appointment } from '@/types';
import { formatPhoneNumber, isValidPhoneNumber, isValidEmail, isDummyPhoneNumber } from '@/lib/dateUtils';
import { X, Plus, Pencil, Trash2, Users, Search, Loader2, Phone, Mail, MessageCircle, Building2, UserCircle, Globe, GitMerge, Download, MapPin, Cake, Upload, Send, FileSpreadsheet, CheckCircle2, AlertTriangle, History } from 'lucide-react';
import { CustomerHistoryModal } from '@/components/CustomerHistoryModal';
import { supabase } from '@/lib/supabase';

interface CustomerDirectoryProps {
  onClose: () => void;
  onDataChange?: () => void;
  onOpenAppointment?: (appointment: Appointment) => void;
  dataVersion?: number;
}

type ScopeFilter = 'company_and_global' | 'company_only' | 'global_only';

const ROLE_BADGE_STYLES: Record<CustomerRole, string> = {
  Taxpayer: 'bg-teal-50 text-teal-700 border-teal-200',
  Spouse: 'bg-violet-50 text-violet-700 border-violet-200',
  Dependent: 'bg-amber-50 text-amber-700 border-amber-200',
  Other: 'bg-slate-100 text-slate-600 border-slate-200',
};

function formatBirthDateDisplay(dob: string): string {
  const parsed = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dob;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CustomerDirectory({ onClose, onDataChange, onOpenAppointment, dataVersion = 0 }: CustomerDirectoryProps) {
  const { profile: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('company_and_global');
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<'all' | 'es' | 'en'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'Taxpayer' | 'Spouse' | 'Dependent'>('all');
  const [sortMode, setSortMode] = useState<'name' | 'birthday'>('name');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ created: number; linked: number; skipped: number } | null>(null);
  const [csvImportSummary, setCsvImportSummary] = useState<{ inserted: number; updated: number; failed: number } | null>(null);
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [showResendSyncModal, setShowResendSyncModal] = useState(false);
  const [mergingCustomerId, setMergingCustomerId] = useState<string | null>(null);
  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null);
  const [confirmDeleteCustomerId, setConfirmDeleteCustomerId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [comps, profs] = await Promise.all([getCompanies(), getProfiles()]);
        if (!active) return;
        setCompanies(comps);
        setProfiles(profs);

        const currentProfile = profs.find(p => p.id === currentUser?.id) || currentUser;
        const userDefaultCompanyId = currentProfile?.default_company_id;
        const defaultCompanyExists = userDefaultCompanyId && comps.some(c => c.id === userDefaultCompanyId);

        const firstActive = comps.find(c => c.is_active)?.id || comps[0]?.id || '';
        const initialCompany = defaultCompanyExists ? userDefaultCompanyId! : firstActive;

        setSelectedCompanyId(prev => prev || initialCompany);
        setRefsLoaded(true);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load companies.');
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [currentUser]);

  const loadData = useCallback(async (query?: string) => {
    if (!refsLoaded) return;
    setLoading(true);
    setError('');
    try {
      const companyScope = selectedCompanyId || null;
      const result = query && query.trim()
        ? await searchCustomers(query, companyScope)
        : await getCustomers(companyScope);
      setCustomers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  }, [refsLoaded, selectedCompanyId]);

  useEffect(() => {
    if (!refsLoaded) return;
    const timer = setTimeout(() => {
      loadData(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCompanyId, refsLoaded, loadData]);

  async function handleDelete(customer: Customer) {
    setActionLoading(true);
    setError('');
    try {
      await deleteCustomer(customer.id, currentUser?.id || null);
      setConfirmDeleteCustomerId(null);
      await loadData(searchQuery);
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete customer.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInlineReassign(customer: Customer, newUserId: string) {
    setReassigningId(customer.id);
    try {
      await supabase
        .from('customers')
        .update({ assigned_user_id: newUserId || null, updated_at: new Date().toISOString() })
        .eq('id', customer.id);
      await loadData(searchQuery);
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign customer.');
    } finally {
      setReassigningId(null);
    }
  }

  async function handleImportFromAppointments() {
    if (!selectedCompanyId) {
      setError('Please select an active company before importing from appointments.');
      return;
    }
    setImporting(true);
    setError('');
    setImportSummary(null);
    try {
      const appointments = await getAppointments();
      const companyAppointments = appointments.filter(a => a.company_id === selectedCompanyId);
      let created = 0;
      let linked = 0;
      let skipped = 0;

      for (const appt of companyAppointments) {
        const name = (appt.client_name || '').trim();
        if (!name) { skipped++; continue; }

        const phoneDigits = (appt.client_phone || '').replace(/\D/g, '');
        const hasRealPhone = phoneDigits.length === 10 && !isDummyPhoneNumber(phoneDigits);
        const phone = hasRealPhone ? appt.client_phone : '';
        const email = (appt.client_email || '').trim();

        const existing = await findMatchingCustomer(name, phone, email, selectedCompanyId);
        if (existing) {
          if (appt.customer_id !== existing.id) {
            const { error: updErr } = await supabase
              .from('appointments')
              .update({ customer_id: existing.id, updated_at: new Date().toISOString() })
              .eq('id', appt.id);
            if (!updErr) linked++;
            else skipped++;
          } else {
            skipped++;
          }
        } else {
          const { data: newCustomer, error: createErr } = await supabase
            .from('customers')
            .insert({
              full_name: name,
              phone: phone || '',
              email: email || '',
              notes: '',
              tags: [],
              company_id: selectedCompanyId,
              assigned_user_id: appt.assigned_to || null,
              is_global: false,
              send_whatsapp: hasRealPhone && appt.send_whatsapp,
              created_by: currentUser?.id || null,
            })
            .select('*')
            .single<Customer>();
          if (createErr) { skipped++; continue; }
          created++;
          const { error: updErr } = await supabase
            .from('appointments')
            .update({ customer_id: newCustomer.id, updated_at: new Date().toISOString() })
            .eq('id', appt.id);
          if (updErr) skipped++;
        }
      }

      setImportSummary({ created, linked, skipped });
      await loadData(searchQuery);
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import from appointments.');
    } finally {
      setImporting(false);
    }
  }

  const activeCompanies = companies.filter(c => c.is_active);
  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null;
  const companyName = (id: string | null) => companies.find(c => c.id === id)?.name || '—';

  const filteredCustomers = customers.filter(c => {
    if (!isCustomerVisibleForCompany(c, selectedCompanyId || null)) return false;
    if (scopeFilter === 'company_only') {
      if (!selectedCompanyId || c.company_id !== selectedCompanyId || c.is_global) return false;
    } else if (scopeFilter === 'global_only') {
      if (!c.is_global && c.company_id !== null) return false;
    }
    if (filterEmployeeId && c.assigned_user_id !== filterEmployeeId) return false;

    if (languageFilter !== 'all') {
      const lang = (c.preferred_language || 'es').toLowerCase();
      if (lang !== languageFilter) return false;
    }

    if (roleFilter !== 'all') {
      const r = getCustomerRole(c.tags);
      if (r.toLowerCase() !== roleFilter.toLowerCase()) return false;
    }

    return true;
  });

  const isFiltered = Boolean(
    searchQuery.trim() ||
    filterEmployeeId ||
    scopeFilter !== 'company_and_global' ||
    languageFilter !== 'all' ||
    roleFilter !== 'all'
  );

  function handleClearFilters() {
    setSearchQuery('');
    setFilterEmployeeId('');
    setScopeFilter('company_and_global');
    setLanguageFilter('all');
    setRoleFilter('all');
  }

  function getBirthdayDaysAway(dobStr: string | null): number {
    if (!dobStr) return Infinity;
    const parts = dobStr.split('-');
    if (parts.length < 3) return Infinity;
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (Number.isNaN(month) || Number.isNaN(day)) return Infinity;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let target = new Date(today.getFullYear(), month, day);
    target.setHours(0, 0, 0, 0);

    if (target < today) {
      target = new Date(today.getFullYear() + 1, month, day);
      target.setHours(0, 0, 0, 0);
    }

    const diffTime = target.getTime() - today.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  function getBirthdayCountdownLabel(days: number): string {
    if (days === 0) return 'Today!';
    if (days === 1) return 'Tomorrow';
    return `In ${days} days`;
  }

  const filteredAndSortedCustomers = useMemo(() => {
    const list = [...filteredCustomers];
    if (sortMode === 'birthday') {
      list.sort((a, b) => {
        const daysA = getBirthdayDaysAway(a.date_of_birth);
        const daysB = getBirthdayDaysAway(b.date_of_birth);
        if (daysA !== daysB) return daysA - daysB;
        return a.full_name.localeCompare(b.full_name);
      });
    } else {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name));
    }
    return list;
  }, [filteredCustomers, sortMode]);

  const scopeIndicatorText = (() => {
    if (scopeFilter === 'global_only') return 'Showing: Global Only';
    if (scopeFilter === 'company_only') {
      return `Showing: ${selectedCompany?.name || 'No Company'} Only`;
    }
    return selectedCompany
      ? `Showing: ${selectedCompany.name} + Global`
      : 'Showing: Global Only';
  })();

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-4 max-h-[90vh] flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <Users className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Customer Directory</h2>
            <span className="text-xs font-medium px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
              {isFiltered ? `Showing ${filteredAndSortedCustomers.length} of ${customers.length} customers` : `${customers.length} customers`}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setShowCsvImportModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition"
              title="Import customers from a CSV export"
            >
              <Upload className="w-4 h-4" />
              Import CSV
            </button>
            <button
              onClick={() => setShowResendSyncModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition"
              title="Sync visible customers with valid emails to Resend Contacts"
            >
              <Send className="w-4 h-4" />
              Sync to Resend
            </button>
            <button
              onClick={handleImportFromAppointments}
              disabled={importing || !selectedCompanyId}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
              title="Scan appointments for the active company and create/link customer records"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Import from Appointments
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              Add Customer
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, phone, or email..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Active Company</label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
              >
                {activeCompanies.length === 0 ? (
                  <option value="">No active companies</option>
                ) : (
                  activeCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Filter by Employee</label>
              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
              >
                <option value="">All employees</option>
                {profiles.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Language</label>
              <select
                value={languageFilter}
                onChange={(e) => setLanguageFilter(e.target.value as 'all' | 'es' | 'en')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
              >
                <option value="all">All</option>
                <option value="es">ES</option>
                <option value="en">EN</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contact Role</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'all' | 'Taxpayer' | 'Spouse' | 'Dependent')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
              >
                <option value="all">All</option>
                <option value="Taxpayer">Taxpayer</option>
                <option value="Spouse">Spouse</option>
                <option value="Dependent">Dependent</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200">
                {scopeFilter === 'global_only' ? (
                  <Globe className="w-3.5 h-3.5 text-blue-600" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-teal-600" />
                )}
                {scopeIndicatorText}
              </span>

              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setScopeFilter('company_and_global')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    scopeFilter === 'company_and_global'
                      ? 'bg-white text-teal-700 font-medium shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  Company + Global
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter('company_only')}
                  disabled={!selectedCompanyId}
                  className={`px-2.5 py-1 rounded-md transition disabled:opacity-40 ${
                    scopeFilter === 'company_only'
                      ? 'bg-white text-teal-700 font-medium shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  Company Only
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter('global_only')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    scopeFilter === 'global_only'
                      ? 'bg-white text-teal-700 font-medium shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  Global Only
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-500 font-medium">Sort:</span>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as 'name' | 'birthday')}
                  className="px-2 py-1 border border-slate-200 rounded-md text-xs bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-teal-500"
                >
                  <option value="name">Name (A–Z)</option>
                  <option value="birthday">Upcoming Birthday</option>
                </select>
              </div>
              {isFiltered && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-xs text-teal-700 hover:text-teal-800 font-medium underline px-2 py-1"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        {importSummary && (
          <div className="mx-6 mt-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <strong>Import complete.</strong> Created {importSummary.created} new customer{importSummary.created !== 1 ? 's' : ''}, linked {importSummary.linked} appointment{importSummary.linked !== 1 ? 's' : ''} to existing customers, and skipped {importSummary.skipped} appointment{importSummary.skipped !== 1 ? 's' : ''} (already linked or no name).
            </div>
            <button onClick={() => setImportSummary(null)} className="text-blue-500 hover:text-blue-700 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {csvImportSummary && (
          <div className="mx-6 mt-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <strong>CSV Import complete.</strong> New: {csvImportSummary.inserted}, Updated: {csvImportSummary.updated}{csvImportSummary.failed > 0 ? ` (${csvImportSummary.failed} failed)` : ''}.
            </div>
            <button onClick={() => setCsvImportSummary(null)} className="text-emerald-600 hover:text-emerald-800 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading...
            </div>
          ) : filteredAndSortedCustomers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
              {isFiltered
                ? 'No customers match your filters.'
                : 'No customers for this company yet. Click "Add Customer" to create one.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAndSortedCustomers.map(customer => (
                <div
                  key={customer.id}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg border border-slate-100 bg-white hover:border-slate-200 transition"
                >
                  <div className="w-9 h-9 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center text-sm font-semibold shrink-0">
                    {customer.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 text-sm">{customer.full_name}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-slate-100 text-slate-700 border-slate-200">
                        {(customer.preferred_language || 'es').toUpperCase()}
                      </span>
                      {(() => {
                        const role = getCustomerRole(customer.tags);
                        return (
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 border rounded-full font-medium ${ROLE_BADGE_STYLES[role]}`}>
                            {role}
                          </span>
                        );
                      })()}
                      {(customer.is_global || customer.company_id === null) && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200/70 rounded-full font-medium">
                          <Globe className="w-3 h-3" /> Global
                        </span>
                      )}
                      {customer.send_whatsapp && customer.phone && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium">
                          <MessageCircle className="w-3 h-3" /> WhatsApp
                        </span>
                      )}
                      {customer.date_of_birth && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full font-medium">
                          <Cake className="w-3 h-3" />
                          {formatBirthDateDisplay(customer.date_of_birth)}
                          {sortMode === 'birthday' && (() => {
                            const days = getBirthdayDaysAway(customer.date_of_birth);
                            if (days === Infinity) return null;
                            const lbl = getBirthdayCountdownLabel(days);
                            return (
                              <span className="ml-1 px-1.5 py-0.2 bg-purple-200 text-purple-900 rounded text-[10px] font-bold">
                                {lbl}
                              </span>
                            );
                          })()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                      {customer.phone && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {customer.phone}
                        </span>
                      )}
                      {customer.email && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {customer.email}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {(customer.is_global || customer.company_id === null) ? 'Global (All companies)' : companyName(customer.company_id)}
                      </span>
                      {(customer.city || customer.state) && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {[customer.city, customer.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <UserCircle className="w-3 h-3 text-slate-400" />
                      <select
                        value={customer.assigned_user_id || ''}
                        onChange={(e) => handleInlineReassign(customer, e.target.value)}
                        disabled={reassigningId === customer.id}
                        className="text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-600 focus:ring-1 focus:ring-teal-400 focus:border-transparent outline-none bg-white disabled:opacity-50"
                      >
                        <option value="">Unassigned</option>
                        {profiles.filter(p => p.status === 'active').map(p => (
                          <option key={p.id} value={p.id}>{p.full_name}</option>
                        ))}
                      </select>
                      {reassigningId === customer.id && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                    </div>
                    {customer.notes && (
                      <div className="text-xs text-slate-400 mt-1 line-clamp-2">{customer.notes}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {confirmDeleteCustomerId === customer.id ? (
                      <div className="flex items-center gap-1 bg-red-50 p-1.5 rounded-lg border border-red-200">
                        <span className="text-xs font-medium text-red-700 px-1">Confirm delete?</span>
                        <button
                          onClick={() => handleDelete(customer)}
                          disabled={actionLoading}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded transition flex items-center gap-1"
                        >
                          {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteCustomerId(null)}
                          disabled={actionLoading}
                          className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setHistoryCustomer(customer)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition"
                          title="View Customer History (Appointments, Emails & WhatsApp)"
                        >
                          <History className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">History</span>
                        </button>
                        <button
                          onClick={() => setMergingCustomerId(customer.id)}
                          className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
                          title="Merge another customer into this one"
                        >
                          <GitMerge className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingCustomer(customer)}
                          className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => setConfirmDeleteCustomerId(customer.id)}
                            disabled={actionLoading}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-30"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(showAddForm || editingCustomer) && (
        <CustomerForm
          customer={editingCustomer}
          selectedCompanyId={selectedCompanyId}
          companies={companies}
          profiles={profiles}
          onClose={() => { setShowAddForm(false); setEditingCustomer(null); }}
          onSaved={() => { setShowAddForm(false); setEditingCustomer(null); loadData(searchQuery); onDataChange?.(); }}
        />
      )}

      {mergingCustomerId && (
        <MergeModal
          keepCustomer={customers.find(c => c.id === mergingCustomerId)!}
          allCustomers={customers}
          onClose={() => setMergingCustomerId(null)}
          onMerged={() => { setMergingCustomerId(null); loadData(searchQuery); onDataChange?.(); }}
        />
      )}

      {showCsvImportModal && (
        <CsvImportModal
          selectedCompanyId={selectedCompanyId}
          companies={companies}
          profiles={profiles}
          currentUser={currentUser}
          onClose={() => setShowCsvImportModal(false)}
          onImported={(result) => {
            setShowCsvImportModal(false);
            setCsvImportSummary(result);
            loadData(searchQuery);
            onDataChange?.();
          }}
        />
      )}

      {showResendSyncModal && (
        <ResendSyncModal
          visibleCustomers={filteredCustomers}
          scopeLabel={scopeIndicatorText}
          onClose={() => setShowResendSyncModal(false)}
        />
      )}

      {historyCustomer && (
        <CustomerHistoryModal
          customer={historyCustomer}
          companies={companies}
          profiles={profiles}
          onClose={() => setHistoryCustomer(null)}
          onOpenAppointment={onOpenAppointment}
          dataVersion={dataVersion}
        />
      )}
    </div>
  );
}

function MergeModal({ keepCustomer, allCustomers, onClose, onMerged }: {
  keepCustomer: Customer;
  allCustomers: Customer[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const { profile: currentUser } = useAuth();
  const [duplicateId, setDuplicateId] = useState<string>('');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');

  const candidates = allCustomers.filter(c => c.id !== keepCustomer.id);

  async function handleMerge() {
    if (!duplicateId) { setError('Please select a customer to merge in.'); return; }
    setMerging(true);
    setError('');
    try {
      await mergeCustomers(keepCustomer.id, duplicateId, currentUser?.id || null);
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge customers.');
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Merge Customers</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-4 py-3">
            Merging <strong>{keepCustomer.full_name}</strong> will keep this record and absorb contact info, address, birthday, and notes from the duplicate. All appointments linked to the duplicate will be reassigned here, and the duplicate will be deleted.
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select duplicate to merge in</label>
            <select
              value={duplicateId}
              onChange={(e) => setDuplicateId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
            >
              <option value="">Choose a customer…</option>
              {candidates.map(c => (
                <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` · ${c.phone}` : ''}{c.email ? ` · ${c.email}` : ''}</option>
              ))}
            </select>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleMerge}
              disabled={merging || !duplicateId}
              className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {merging && <Loader2 className="w-4 h-4 animate-spin" />}
              {merging ? 'Merging...' : 'Merge'}
            </button>
            <button onClick={onClose} className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerForm({ customer, selectedCompanyId, companies, profiles, onClose, onSaved }: {
  customer: Customer | null;
  selectedCompanyId: string;
  companies: Company[];
  profiles: Profile[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile: currentUser } = useAuth();
  const [fullName, setFullName] = useState(customer?.full_name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [notes, setNotes] = useState(customer?.notes || '');
  const [companyId, setCompanyId] = useState<string>(customer?.company_id || selectedCompanyId || '');
  const [assignedUserId, setAssignedUserId] = useState<string>(
    customer?.assigned_user_id || (customer ? '' : currentUser?.id || '')
  );
  const [isGlobal, setIsGlobal] = useState(customer ? (customer.is_global || customer.company_id === null) : false);
  const [sendWhatsapp, setSendWhatsapp] = useState(customer?.send_whatsapp ?? true);
  const [role, setRole] = useState<CustomerRole>(getCustomerRole(customer?.tags));
  const [preferredLanguage, setPreferredLanguage] = useState<'es' | 'en'>(customer?.preferred_language || 'es');
  const [dateOfBirth, setDateOfBirth] = useState<string>(customer?.date_of_birth || '');
  const [addressLine1, setAddressLine1] = useState(customer?.address_line1 || '');
  const [addressLine2, setAddressLine2] = useState(customer?.address_line2 || '');
  const [city, setCity] = useState(customer?.city || '');
  const [stateVal, setStateVal] = useState(customer?.state || '');
  const [zipCode, setZipCode] = useState(customer?.zip_code || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const whatsappDisabled = !phone || isDummyPhoneNumber(phone);

  const availableCompanies = companies.filter(
    c => c.is_active || (customer?.company_id && c.id === customer.company_id),
  );

  useEffect(() => {
    if (whatsappDisabled && sendWhatsapp) {
      setSendWhatsapp(false);
    }
  }, [whatsappDisabled, sendWhatsapp]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) { setError('Customer name is required.'); return; }
    if (phone && !isValidPhoneNumber(phone)) { setError('Please enter a valid US phone number.'); return; }
    if (email && !isValidEmail(email)) { setError('Please enter a valid email address.'); return; }
    if (!isGlobal && !companyId) {
      setError('Please select a company or enable Global Customer.');
      return;
    }

    setSaving(true);
    try {
      await saveCustomer({
        ...(customer?.id ? { id: customer.id } : {}),
        full_name: fullName.trim(),
        phone: phone || '',
        email: email || '',
        notes: notes,
        tags: setCustomerRoleTag(customer?.tags, role),
        company_id: isGlobal ? null : (companyId || null),
        assigned_user_id: assignedUserId || null,
        is_global: isGlobal,
        send_whatsapp: sendWhatsapp,
        address_line1: addressLine1 || '',
        address_line2: addressLine2 || '',
        city: city || '',
        state: stateVal || '',
        zip_code: zipCode || '',
        date_of_birth: dateOfBirth || null,
        preferred_language: preferredLanguage,
      }, currentUser?.id || null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">{customer ? 'Edit Customer' : 'Add Customer'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              placeholder="client@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contact Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as CustomerRole)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
              >
                {CUSTOMER_ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Birth Date</label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Preferred Language</label>
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as 'es' | 'en')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
            >
              <option value="es">ES - Spanish</option>
              <option value="en">EN - English</option>
            </select>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Mailing Address</span>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                placeholder="Address Line 1"
              />
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                placeholder="Address Line 2 (optional)"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="City"
                />
                <input
                  type="text"
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="State"
                />
              </div>
              <input
                type="text"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                placeholder="ZIP Code"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={isGlobal}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white disabled:opacity-50"
            >
              <option value="">Select a company...</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {isGlobal && (
              <p className="text-xs text-blue-600 mt-1">Visible across all companies while Global Customer is enabled.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Employee</label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
            >
              <option value="">Unassigned</option>
              {profiles.filter(p => p.status === 'active').map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer select-none">
            <span className="text-sm text-slate-700 flex items-center gap-2 font-medium">
              <Globe className="w-4 h-4 text-blue-600 shrink-0" />
              Global Customer (visible across all companies)
            </span>
            <input
              type="checkbox"
              checked={isGlobal}
              onChange={(e) => setIsGlobal(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
            />
          </label>
          <label className={`flex items-center gap-2.5 select-none ${whatsappDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={sendWhatsapp}
              disabled={whatsappDisabled}
              onChange={(e) => setSendWhatsapp(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm text-slate-700 flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-green-600" />
              Send WhatsApp Reminders
              {whatsappDisabled && <span className="text-xs text-slate-400">(requires valid phone)</span>}
            </span>
          </label>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none resize-none"
              placeholder="Optional notes about this customer..."
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CsvImportModal({ selectedCompanyId, companies, profiles, currentUser, onClose, onImported }: {
  selectedCompanyId: string;
  companies: Company[];
  profiles: Profile[];
  currentUser: Profile | null;
  onClose: () => void;
  onImported: (result: { inserted: number; updated: number; failed: number }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [columnMapping, setColumnMapping] = useState<{
    clientName: string;
    birthDate: string;
    address: string;
    phone: string;
    type: string;
    email: string;
    language: string;
    assignedTo: string;
  }>({
    clientName: '',
    birthDate: '',
    address: '',
    phone: '',
    type: '',
    email: '',
    language: '',
    assignedTo: '',
  });

  const [targetCompanyId, setTargetCompanyId] = useState<string>(selectedCompanyId || '');
  const [importAsGlobal, setImportAsGlobal] = useState(false);
  const [onlyWithValidEmail, setOnlyWithValidEmail] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [existingCustomers, setExistingCustomers] = useState<Customer[]>([]);
  const [loadingScope, setLoadingScope] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const availableCompanies = companies.filter(c => c.is_active || c.id === selectedCompanyId);
  const hasValidTarget = importAsGlobal || Boolean(targetCompanyId);

  const autoMapping = useMemo(() => detectHeaderMapping(parsedHeaders), [parsedHeaders]);
  const showColumnMappingDropdown = parsedHeaders.length > 0 && !autoMapping.isClientNameAutoMatched;

  useEffect(() => {
    if (parsedHeaders.length > 0) {
      if (!autoMapping.isClientNameAutoMatched) {
        setColumnMapping(m => ({
          clientName: m.clientName || parsedHeaders[0] || '',
          birthDate: m.birthDate || autoMapping.birthDate || '',
          address: m.address || autoMapping.address || '',
          phone: m.phone || autoMapping.phone || '',
          type: m.type || autoMapping.type || '',
          email: m.email || autoMapping.email || '',
          language: m.language || autoMapping.language || '',
          assignedTo: m.assignedTo || autoMapping.assignedTo || '',
        }));
      } else {
        setColumnMapping({
          clientName: autoMapping.clientName,
          birthDate: autoMapping.birthDate,
          address: autoMapping.address,
          phone: autoMapping.phone,
          type: autoMapping.type,
          email: autoMapping.email,
          language: autoMapping.language,
          assignedTo: autoMapping.assignedTo,
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMapping]);

  useEffect(() => {
    let active = true;
    if (!hasValidTarget) {
      setExistingCustomers([]);
      return;
    }
    setLoadingScope(true);
    setError('');
    getCustomers(importAsGlobal ? null : targetCompanyId)
      .then((rows) => {
        if (!active) return;
        setExistingCustomers(rows);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load existing customers for duplicate check.');
      })
      .finally(() => {
        if (active) setLoadingScope(false);
      });
    return () => { active = false; };
  }, [targetCompanyId, importAsGlobal, hasValidTarget]);

  function handleFileProcess(file: File) {
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const { headers, rows } = parseCsvText(text);
        if (headers.length === 0 || rows.length === 0) {
          setParsedHeaders([]);
          setParsedRows([]);
          setError('The selected CSV file appears to be empty or has no data rows.');
          return;
        }
        setParsedHeaders(headers);
        setParsedRows(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
      }
    };
    reader.onerror = () => {
      setError('Could not read the selected file.');
    };
    reader.readAsText(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileProcess(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
  }

  const preview = useMemo(() => {
    if (parsedRows.length === 0) return null;
    return buildCsvImportPreview({
      rows: parsedRows,
      existingCustomers,
      onlyWithValidEmail,
      targetCompanyId: importAsGlobal ? null : (targetCompanyId || null),
      isGlobal: importAsGlobal,
      profiles,
      currentUserId: currentUser?.id || null,
      columnMapping,
    });
  }, [parsedRows, existingCustomers, onlyWithValidEmail, targetCompanyId, importAsGlobal, profiles, currentUser, columnMapping]);

  async function handleConfirmImport() {
    if (!hasValidTarget) {
      setError('Please select a Target Company or enable Import as Global Customers.');
      return;
    }
    if (!preview || (preview.readyToImport.length === 0 && preview.readyToUpdate.length === 0)) {
      setError('There are no rows ready to import or update.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const result = await batchImportCustomers(preview.readyToImport, preview.readyToUpdate, currentUser?.id || null);
      onImported({ inserted: result.inserted, updated: result.updated, failed: result.failed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import customers from CSV.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-800">Import Customers from CSV</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
                Target Company
              </label>
              <select
                value={targetCompanyId}
                onChange={(e) => setTargetCompanyId(e.target.value)}
                disabled={importAsGlobal}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white disabled:opacity-50"
              >
                <option value="">Select a target company...</option>
                {availableCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white cursor-pointer select-none">
              <span className="text-sm text-slate-700 flex items-center gap-2 font-medium">
                <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                Import as Global Customers (is_global = true)
              </span>
              <input
                type="checkbox"
                checked={importAsGlobal}
                onChange={(e) => setImportAsGlobal(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
              />
            </label>

            <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white cursor-pointer select-none">
              <div>
                <span className="text-sm text-slate-700 font-medium block">
                  Import only rows with a valid Email address
                </span>
                <span className="text-xs text-slate-500">
                  Optional. Unchecked by default to support phone-only / WhatsApp customers.
                </span>
              </div>
              <input
                type="checkbox"
                checked={onlyWithValidEmail}
                onChange={(e) => setOnlyWithValidEmail(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
              />
            </label>

            {!hasValidTarget && (
              <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                Select a Target Company or enable Global Customers to proceed with import.
              </div>
            )}
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer transition ${
                isDragging
                  ? 'border-indigo-600 bg-indigo-50/70 scale-[1.01]'
                  : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40'
              }`}
            >
              <Upload className="w-6 h-6 text-indigo-600 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-700">
                {fileName ? `Selected: ${fileName}` : 'Choose a .csv file or drag & drop here'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Supports columns: Birth Date, Client Name, Address, Phone Number, Type, Email
              </div>
            </div>
          </div>

          {showColumnMappingDropdown && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2">
              <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                Client Name column not automatically matched. Please map your CSV columns below:
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Client Name *</label>
                  <select
                    value={columnMapping.clientName}
                    onChange={(e) => setColumnMapping(m => ({ ...m, clientName: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select column...</option>
                    {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Phone Number</label>
                  <select
                    value={columnMapping.phone}
                    onChange={(e) => setColumnMapping(m => ({ ...m, phone: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select column...</option>
                    {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Email</label>
                  <select
                    value={columnMapping.email}
                    onChange={(e) => setColumnMapping(m => ({ ...m, email: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select column...</option>
                    {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Birth Date</label>
                  <select
                    value={columnMapping.birthDate}
                    onChange={(e) => setColumnMapping(m => ({ ...m, birthDate: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select column...</option>
                    {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Address</label>
                  <select
                    value={columnMapping.address}
                    onChange={(e) => setColumnMapping(m => ({ ...m, address: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select column...</option>
                    {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Type / Role</label>
                  <select
                    value={columnMapping.type}
                    onChange={(e) => setColumnMapping(m => ({ ...m, type: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Select column...</option>
                    {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {loadingScope && (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking existing customers in scope for matching/updates...
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  Detected {parsedHeaders.length} columns ({parsedHeaders.slice(0, 2).join(', ')}{parsedHeaders.length > 2 ? '...' : ''}) · {preview.totalRows} CSV rows
                </span>
                <span>Match: Phone + Full Name (Auto-Updates Existing)</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-emerald-700">New</div>
                  <div className="text-xl font-bold text-emerald-800">{preview.readyToImport.length}</div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-indigo-700">Update</div>
                  <div className="text-xl font-bold text-indigo-800">{preview.readyToUpdate.length}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-amber-700">Skipped (Phone)</div>
                  <div className="text-xl font-bold text-amber-800">{preview.skippedNoValidPhone}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-slate-600">Skipped (Email)</div>
                  <div className="text-xl font-bold text-slate-800">{preview.skippedNoEmail}</div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {CUSTOMER_ROLES.map((r) => (
                  <div key={r} className={`rounded-lg border px-3 py-2 ${ROLE_BADGE_STYLES[r]}`}>
                    <div className="text-xs font-medium">{r}</div>
                    <div className="text-base font-bold">{preview.roleCounts[r]}</div>
                  </div>
                ))}
              </div>

              {preview.skippedNoName > 0 && (
                <div className="text-xs text-slate-500">
                  Also skipped {preview.skippedNoName} row{preview.skippedNoName !== 1 ? 's' : ''} with no Client Name.
                </div>
              )}

              {(preview.readyToImport.length > 0 || preview.readyToUpdate.length > 0) && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 border-b border-slate-200 flex items-center justify-between">
                    <span>Preview (New: {preview.readyToImport.length}, Update: {preview.readyToUpdate.length})</span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {[
                      ...preview.readyToImport.map(r => ({ ...r, action: 'New' as const })),
                      ...preview.readyToUpdate.map(r => ({ ...r, action: 'Update' as const })),
                    ].slice(0, 5).map((row, idx) => (
                      <div key={idx} className="px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-800">{row.full_name}</span>
                          <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[11px] font-medium ${row.action === 'New' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
                            {row.action}
                          </span>
                          <span className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[11px] font-medium ${ROLE_BADGE_STYLES[row.role]}`}>
                            {row.role}
                          </span>
                          <div className="text-slate-500 truncate mt-0.5">
                            {row.email || 'No email'}
                            {row.phone ? ` · ${row.phone}` : ''}
                            {row.date_of_birth ? ` · DOB ${row.date_of_birth}` : ''}
                          </div>
                        </div>
                        {(row.address_line1 || row.address_line2 || row.city || row.state || row.zip_code) && (
                          <div className="text-slate-400 truncate max-w-[260px]">
                            {[row.address_line1, row.address_line2, row.city, row.state, row.zip_code].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={importing || loadingScope || !hasValidTarget || !preview || (preview.readyToImport.length === 0 && preview.readyToUpdate.length === 0)}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center gap-2"
          >
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            {importing ? 'Importing...' : `Import ${preview ? preview.readyToImport.length + preview.readyToUpdate.length : 0} Customers`}
          </button>
        </div>
      </div>
    </div>
  );
}

const RESEND_AUDIENCE_STORAGE_KEY = 'resend_audience_id';
const RESEND_SPANISH_SEGMENT_STORAGE_KEY = 'resend_spanish_segment_id';
const RESEND_ENGLISH_SEGMENT_STORAGE_KEY = 'resend_english_segment_id';

function ResendSyncModal({ visibleCustomers, scopeLabel, onClose }: {
  visibleCustomers: Customer[];
  scopeLabel: string;
  onClose: () => void;
}) {
  const [audienceId, setAudienceId] = useState<string>(() => {
    try {
      return import.meta.env.VITE_RESEND_AUDIENCE_ID || localStorage.getItem(RESEND_AUDIENCE_STORAGE_KEY) || '';
    } catch {
      return import.meta.env.VITE_RESEND_AUDIENCE_ID || '';
    }
  });
  const [spanishSegmentId, setSpanishSegmentId] = useState<string>(() => {
    try {
      return import.meta.env.VITE_RESEND_SEGMENT_SPANISH_ID || localStorage.getItem(RESEND_SPANISH_SEGMENT_STORAGE_KEY) || '';
    } catch {
      return import.meta.env.VITE_RESEND_SEGMENT_SPANISH_ID || '';
    }
  });
  const [englishSegmentId, setEnglishSegmentId] = useState<string>(() => {
    try {
      return import.meta.env.VITE_RESEND_SEGMENT_ENGLISH_ID || localStorage.getItem(RESEND_ENGLISH_SEGMENT_STORAGE_KEY) || '';
    } catch {
      return import.meta.env.VITE_RESEND_SEGMENT_ENGLISH_ID || '';
    }
  });
  const [roleFilter, setRoleFilter] = useState<'all' | 'taxpayers_and_spouses'>('all');
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [error, setError] = useState('');
  const [syncResult, setSyncResult] = useState<{ sent: number; detail: string } | null>(null);

  const visibleWithValidEmail = useMemo(() => {
    return visibleCustomers.filter((c) => {
      const em = (c.email || '').trim();
      return em.length > 0 && isValidEmail(em);
    });
  }, [visibleCustomers]);

  const contactsToSync = useMemo(() => {
    const filtered = roleFilter === 'taxpayers_and_spouses'
      ? visibleWithValidEmail.filter((c) => {
          const r = getCustomerRole(c.tags);
          return r === 'Taxpayer' || r === 'Spouse';
        })
      : visibleWithValidEmail;

    return filtered.map((c) => {
      const parts = (c.full_name || '').trim().split(/\s+/);
      const first_name = parts[0] || '';
      const last_name = parts.slice(1).join(' ');
      return {
        email: c.email.trim().toLowerCase(),
        first_name,
        last_name,
        full_name: (c.full_name || '').trim(),
        role: getCustomerRole(c.tags),
        preferred_language: c.preferred_language || 'es',
        unsubscribed: false,
      };
    });
  }, [visibleWithValidEmail, roleFilter]);

  function handleAudienceChange(val: string) {
    setAudienceId(val);
    try {
      localStorage.setItem(RESEND_AUDIENCE_STORAGE_KEY, val);
    } catch {
      // ignore storage errors
    }
  }

  function handleSpanishSegmentChange(val: string) {
    setSpanishSegmentId(val);
    try {
      localStorage.setItem(RESEND_SPANISH_SEGMENT_STORAGE_KEY, val);
    } catch {
      // ignore storage errors
    }
  }

  function handleEnglishSegmentChange(val: string) {
    setEnglishSegmentId(val);
    try {
      localStorage.setItem(RESEND_ENGLISH_SEGMENT_STORAGE_KEY, val);
    } catch {
      // ignore storage errors
    }
  }

  async function handleSync(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSyncResult(null);

    const trimmedAudienceId = audienceId.trim();
    const trimmedSpanishId = spanishSegmentId.trim();
    const trimmedEnglishId = englishSegmentId.trim();

    if (!trimmedAudienceId) {
      setError('Please enter your Resend Audience ID.');
      return;
    }
    if (contactsToSync.length === 0) {
      setError('There are no visible customers with valid email addresses matching this filter.');
      return;
    }

    try {
      localStorage.setItem(RESEND_AUDIENCE_STORAGE_KEY, trimmedAudienceId);
      if (trimmedSpanishId) localStorage.setItem(RESEND_SPANISH_SEGMENT_STORAGE_KEY, trimmedSpanishId);
      if (trimmedEnglishId) localStorage.setItem(RESEND_ENGLISH_SEGMENT_STORAGE_KEY, trimmedEnglishId);
    } catch {
      // ignore storage errors
    }

    setSyncing(true);
    try {
      const CHUNK_SIZE = 20;
      const totalContacts = contactsToSync.length;
      const totalBatches = Math.ceil(totalContacts / CHUNK_SIZE);

      let totalSynced = 0;
      let totalFailed = 0;
      let totalSpanish = 0;
      let totalEnglish = 0;
      const allWarnings: string[] = [];
      const allErrors: string[] = [];

      for (let i = 0; i < totalBatches; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalContacts);
        const chunk = contactsToSync.slice(start, end);

        setSyncProgress(`Syncing batch ${i + 1} of ${totalBatches} (${end} / ${totalContacts} contacts)...`);

        const { data, error: fnError } = await supabase.functions.invoke('sync-resend-contacts', {
          body: {
            audienceId: trimmedAudienceId,
            spanishSegmentId: trimmedSpanishId,
            englishSegmentId: trimmedEnglishId,
            contacts: chunk,
          },
        });

        if (fnError) {
          allErrors.push(fnError.message || `Batch ${i + 1} invocation failed`);
          continue;
        }
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          allErrors.push(String(data.error));
          continue;
        }

        if (data && typeof data === 'object') {
          if ('synced' in data && typeof data.synced === 'number') totalSynced += data.synced;
          if ('failed' in data && typeof data.failed === 'number') totalFailed += data.failed;
          if ('spanishCount' in data && typeof data.spanishCount === 'number') totalSpanish += data.spanishCount;
          if ('englishCount' in data && typeof data.englishCount === 'number') totalEnglish += data.englishCount;
          if ('warnings' in data && Array.isArray(data.warnings)) allWarnings.push(...data.warnings);
          if ('errors' in data && Array.isArray(data.errors)) allErrors.push(...data.errors);
        }
      }

      let detail = `Synced ${totalSynced} contact${totalSynced !== 1 ? 's' : ''} — ${totalSpanish} Spanish, ${totalEnglish} English`;
      if (totalFailed > 0) {
        detail += `. ${totalFailed} failed`;
      }
      if (allWarnings.length > 0) {
        detail += `. Warning: ${Array.from(new Set(allWarnings)).join(' ')}`;
      }
      if (allErrors.length > 0) {
        detail += `. Errors: ${allErrors.slice(0, 3).join('; ')}`;
      }

      setSyncResult({
        sent: totalContacts,
        detail,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync contacts to Resend.');
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-slate-800" />
            <h2 className="text-lg font-semibold text-slate-800">Sync to Resend Contacts</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSync} className="px-6 py-4 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
            <div className="text-xs font-medium text-slate-500">{scopeLabel}</div>
            <div className="text-sm text-slate-800">
              <strong>{visibleWithValidEmail.length}</strong> of {visibleCustomers.length} visible customer{visibleCustomers.length !== 1 ? 's' : ''} have valid email addresses.
            </div>
            <div className="text-xs text-teal-700 font-medium">
              {contactsToSync.length} contact{contactsToSync.length !== 1 ? 's' : ''} selected to sync
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Resend General Audience ID *</label>
            <input
              type="text"
              value={audienceId}
              onChange={(e) => handleAudienceChange(e.target.value)}
              placeholder="e.g. 78261eea-8f8b-4381-83c6-79fa7120f1cf"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none font-mono"
              required
            />
            <p className="text-xs text-slate-400 mt-1">Remembered automatically in your browser for future syncs.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Spanish Segment ID</label>
              <input
                type="text"
                value={spanishSegmentId}
                onChange={(e) => handleSpanishSegmentChange(e.target.value)}
                placeholder="Optional ID"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">English Segment ID</label>
              <input
                type="text"
                value={englishSegmentId}
                onChange={(e) => handleEnglishSegmentChange(e.target.value)}
                placeholder="Optional ID"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none font-mono"
              />
            </div>
          </div>

          {(!spanishSegmentId.trim() || !englishSegmentId.trim()) && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <strong>Warning:</strong> {!spanishSegmentId.trim() && !englishSegmentId.trim() ? 'Spanish and English segment IDs are' : !spanishSegmentId.trim() ? 'Spanish segment ID is' : 'English segment ID is'} not configured. Contacts will sync to General audience only.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Contacts Filter</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRoleFilter('all')}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${
                  roleFilter === 'all'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                All Roles ({visibleWithValidEmail.length})
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('taxpayers_and_spouses')}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${
                  roleFilter === 'taxpayers_and_spouses'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Taxpayers & Spouses Only
              </button>
            </div>
          </div>

          {syncing && (
            <div className="flex items-center gap-2 text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-4 py-3">
              <Loader2 className="w-4 h-4 text-teal-600 animate-spin shrink-0" />
              <span>{syncProgress || 'Syncing contacts...'}</span>
            </div>
          )}

          {syncResult && (
            <div className="flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{syncResult.detail}</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={syncing || contactsToSync.length === 0 || !audienceId.trim()}
              className="flex-1 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {syncing ? 'Syncing...' : `Sync ${contactsToSync.length} Contact${contactsToSync.length === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm"
            >
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

