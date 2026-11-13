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
  buildCsvImportPreview,
  batchInsertCustomers,
} from '@/lib/store';
import { useAuth } from '@/context/AuthContext';
import { Customer, Company, Profile, CustomerRole, CUSTOMER_ROLES } from '@/types';
import { formatPhoneNumber, isValidPhoneNumber, isValidEmail, isDummyPhoneNumber } from '@/lib/dateUtils';
import { X, Plus, Pencil, Trash2, Users, Search, Loader2, Phone, Mail, MessageCircle, Building2, UserCircle, Globe, GitMerge, Download, MapPin, Cake, Upload, Send, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface CustomerDirectoryProps {
  onClose: () => void;
  onDataChange?: () => void;
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

export function CustomerDirectory({ onClose, onDataChange }: CustomerDirectoryProps) {
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
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ created: number; linked: number; skipped: number } | null>(null);
  const [csvImportSummary, setCsvImportSummary] = useState<{ inserted: number; failed: number } | null>(null);
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [showResendSyncModal, setShowResendSyncModal] = useState(false);
  const [mergingCustomerId, setMergingCustomerId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [comps, profs] = await Promise.all([getCompanies(), getProfiles()]);
        if (!active) return;
        setCompanies(comps);
        setProfiles(profs);
        const firstActive = comps.find(c => c.is_active)?.id || comps[0]?.id || '';
        setSelectedCompanyId(prev => prev || firstActive);
        setRefsLoaded(true);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load companies.');
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

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
    if (!confirm(`Delete "${customer.full_name}"? This will not delete their appointments but will unlink them.`)) return;
    setActionLoading(true);
    try {
      await deleteCustomer(customer.id, currentUser?.id || null);
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
      if (!c.is_global) return false;
    }
    if (filterEmployeeId && c.assigned_user_id !== filterEmployeeId) return false;
    return true;
  });

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
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Customer Directory</h2>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
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
              <strong>CSV Import complete.</strong> Imported {csvImportSummary.inserted} customer{csvImportSummary.inserted !== 1 ? 's' : ''}{csvImportSummary.failed > 0 ? ` (${csvImportSummary.failed} failed to insert)` : ''}.
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
          ) : filteredCustomers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
              {searchQuery || filterEmployeeId || scopeFilter !== 'company_and_global'
                ? 'No customers match your filters.'
                : 'No customers for this company yet. Click "Add Customer" to create one.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCustomers.map(customer => (
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
                      {(() => {
                        const role = getCustomerRole(customer.tags);
                        return (
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 border rounded-full font-medium ${ROLE_BADGE_STYLES[role]}`}>
                            {role}
                          </span>
                        );
                      })()}
                      {customer.is_global && (
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
                        <Building2 className="w-3 h-3" /> {customer.is_global ? 'Global (All companies)' : companyName(customer.company_id)}
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
                        onClick={() => handleDelete(customer)}
                        disabled={actionLoading}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-30"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
  const [assignedUserId, setAssignedUserId] = useState<string>(customer?.assigned_user_id || '');
  const [isGlobal, setIsGlobal] = useState(customer?.is_global ?? false);
  const [sendWhatsapp, setSendWhatsapp] = useState(customer?.send_whatsapp ?? true);
  const [role, setRole] = useState<CustomerRole>(getCustomerRole(customer?.tags));
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

function CsvImportModal({ selectedCompanyId, companies, onClose, onImported }: {
  selectedCompanyId: string;
  companies: Company[];
  onClose: () => void;
  onImported: (result: { inserted: number; failed: number }) => void;
}) {
  const { profile: currentUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [targetCompanyId, setTargetCompanyId] = useState<string>(selectedCompanyId || '');
  const [importAsGlobal, setImportAsGlobal] = useState(false);
  const [onlyWithValidEmail, setOnlyWithValidEmail] = useState(true);
  const [fileName, setFileName] = useState('');
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [existingCustomers, setExistingCustomers] = useState<Customer[]>([]);
  const [loadingScope, setLoadingScope] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const availableCompanies = companies.filter(c => c.is_active || c.id === selectedCompanyId);
  const hasValidTarget = importAsGlobal || Boolean(targetCompanyId);

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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

  const preview = useMemo(() => {
    if (parsedRows.length === 0) return null;
    return buildCsvImportPreview({
      rows: parsedRows,
      existingCustomers,
      onlyWithValidEmail,
      targetCompanyId: importAsGlobal ? null : (targetCompanyId || null),
      isGlobal: importAsGlobal,
    });
  }, [parsedRows, existingCustomers, onlyWithValidEmail, targetCompanyId, importAsGlobal]);

  async function handleConfirmImport() {
    if (!hasValidTarget) {
      setError('Please select a Target Company or enable Import as Global Customers.');
      return;
    }
    if (!preview || preview.readyToImport.length === 0) {
      setError('There are no new valid rows ready to import.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const result = await batchInsertCustomers(preview.readyToImport, currentUser?.id || null);
      onImported(result);
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
                  Import only rows with a valid Email address (recommended)
                </span>
                <span className="text-xs text-slate-500">
                  Imports Taxpayers and any Spouse/Dependent/Other rows with an email; skips blank-email rows.
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 rounded-xl px-4 py-6 text-center transition"
            >
              <Upload className="w-6 h-6 text-indigo-600 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-700">
                {fileName ? `Selected: ${fileName}` : 'Choose a .csv file to upload'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Supports columns: Birth Date, Client Name, Address, Phone Number, Type, Email
              </div>
            </button>
          </div>

          {loadingScope && (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking existing customers in scope for duplicates...
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Detected {parsedHeaders.length} columns · {preview.totalRows} CSV rows</span>
                <span>Duplicate check: Email + Full Name (case-insensitive)</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-emerald-700">Ready to Import</div>
                  <div className="text-xl font-bold text-emerald-800">{preview.readyToImport.length}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-slate-600">Skipped (No Email)</div>
                  <div className="text-xl font-bold text-slate-800">{preview.skippedNoEmail}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-amber-700">Duplicates Skipped</div>
                  <div className="text-xl font-bold text-amber-800">{preview.duplicatesSkipped}</div>
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

              {preview.readyToImport.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 border-b border-slate-200">
                    Preview (first {Math.min(5, preview.readyToImport.length)} of {preview.readyToImport.length} rows)
                  </div>
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {preview.readyToImport.slice(0, 5).map((row, idx) => (
                      <div key={idx} className="px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-800">{row.full_name}</span>
                          <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[11px] font-medium ${ROLE_BADGE_STYLES[row.role]}`}>
                            {row.role}
                          </span>
                          <div className="text-slate-500 truncate mt-0.5">
                            {row.email || 'No email'}
                            {row.phone ? ` · ${row.phone}` : ''}
                            {row.date_of_birth ? ` · DOB ${row.date_of_birth}` : ''}
                          </div>
                        </div>
                        {(row.address_line1 || row.city || row.state) && (
                          <div className="text-slate-400 truncate max-w-[220px]">
                            {[row.address_line1, row.city, row.state, row.zip_code].filter(Boolean).join(', ')}
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
            disabled={importing || loadingScope || !hasValidTarget || !preview || preview.readyToImport.length === 0}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center gap-2"
          >
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            {importing ? 'Importing...' : `Import ${preview?.readyToImport.length ?? 0} Customer${(preview?.readyToImport.length ?? 0) === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const RESEND_AUDIENCE_STORAGE_KEY = 'resend_audience_id';

function ResendSyncModal({ visibleCustomers, scopeLabel, onClose }: {
  visibleCustomers: Customer[];
  scopeLabel: string;
  onClose: () => void;
}) {
  const [audienceId, setAudienceId] = useState<string>(() => {
    try {
      return localStorage.getItem(RESEND_AUDIENCE_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [roleFilter, setRoleFilter] = useState<'all' | 'taxpayers_and_spouses'>('all');
  const [syncing, setSyncing] = useState(false);
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

  async function handleSync(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSyncResult(null);

    const trimmedAudienceId = audienceId.trim();
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
    } catch {
      // ignore storage errors
    }

    setSyncing(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-resend-contacts', {
        body: {
          audienceId: trimmedAudienceId,
          contacts: contactsToSync,
        },
      });
      if (fnError) {
        throw new Error(fnError.message || 'Failed to invoke sync-resend-contacts.');
      }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }

      const syncedCount =
        data && typeof data === 'object' && 'synced' in data && typeof data.synced === 'number'
          ? data.synced
          : contactsToSync.length;
      const failedCount =
        data && typeof data === 'object' && 'failed' in data && typeof data.failed === 'number'
          ? data.failed
          : 0;

      setSyncResult({
        sent: contactsToSync.length,
        detail: `Synced ${syncedCount} contact${syncedCount !== 1 ? 's' : ''} to Resend${failedCount > 0 ? ` (${failedCount} failed)` : ''}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync contacts to Resend.');
    } finally {
      setSyncing(false);
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Resend Audience ID *</label>
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

