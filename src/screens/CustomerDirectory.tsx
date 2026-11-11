import { useState, useEffect, useCallback } from 'react';
import { getCustomers, saveCustomer, deleteCustomer, searchCustomers, getCompanies, getProfiles } from '@/lib/store';
import { useAuth } from '@/context/AuthContext';
import { Customer, Company, Profile } from '@/types';
import { formatPhoneNumber, isValidPhoneNumber, isValidEmail } from '@/lib/dateUtils';
import { X, Plus, Pencil, Trash2, Users, Search, Loader2, Phone, Mail, MessageCircle, Building2, UserCircle, Globe } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface CustomerDirectoryProps {
  onClose: () => void;
  onDataChange?: () => void;
}

export function CustomerDirectory({ onClose, onDataChange }: CustomerDirectoryProps) {
  const { profile: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState<string>('');
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const loadData = useCallback(async (query?: string) => {
    setLoading(true);
    setError('');
    try {
      const [result, comps, profs] = await Promise.all([
        query && query.trim() ? searchCustomers(query) : getCustomers(),
        getCompanies(),
        getProfiles(),
      ]);
      setCustomers(result);
      setCompanies(comps);
      setProfiles(profs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, loadData]);

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

  const companyName = (id: string | null) => companies.find(c => c.id === id)?.name || '—';
  const employeeName = (id: string | null) => profiles.find(p => p.id === id)?.full_name || '—';

  const filteredCustomers = customers.filter(c => {
    if (filterCompanyId && c.company_id !== filterCompanyId && !c.is_global) return false;
    if (filterEmployeeId && c.assigned_user_id !== filterEmployeeId) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-slate-800">Customer Directory</h2>
          </div>
          <div className="flex items-center gap-2">
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Filter by Company</label>
              <select
                value={filterCompanyId}
                onChange={(e) => setFilterCompanyId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white"
              >
                <option value="">All companies</option>
                {companies.filter(c => c.is_active).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
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
        </div>

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
              {searchQuery || filterCompanyId || filterEmployeeId ? 'No customers match your filters.' : 'No customers yet. Click "Add Customer" to create one.'}
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
                      {customer.is_global && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                          <Globe className="w-3 h-3" /> Global
                        </span>
                      )}
                      {customer.send_whatsapp && customer.phone && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium">
                          <MessageCircle className="w-3 h-3" /> WhatsApp
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
                        <Building2 className="w-3 h-3" /> {customer.is_global ? 'All companies' : companyName(customer.company_id)}
                      </span>
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
          companies={companies}
          profiles={profiles}
          onClose={() => { setShowAddForm(false); setEditingCustomer(null); }}
          onSaved={() => { setShowAddForm(false); setEditingCustomer(null); loadData(searchQuery); onDataChange?.(); }}
        />
      )}
    </div>
  );
}

function CustomerForm({ customer, companies, profiles, onClose, onSaved }: {
  customer: Customer | null;
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
  const [companyId, setCompanyId] = useState<string>(customer?.company_id || '');
  const [assignedUserId, setAssignedUserId] = useState<string>(customer?.assigned_user_id || '');
  const [isGlobal, setIsGlobal] = useState(customer?.is_global ?? false);
  const [sendWhatsapp, setSendWhatsapp] = useState(customer?.send_whatsapp ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) { setError('Customer name is required.'); return; }
    if (phone && !isValidPhoneNumber(phone)) { setError('Please enter a valid US phone number.'); return; }
    if (email && !isValidEmail(email)) { setError('Please enter a valid email address.'); return; }

    setSaving(true);
    try {
      await saveCustomer({
        ...(customer?.id ? { id: customer.id } : {}),
        full_name: fullName.trim(),
        phone: phone || '',
        email: email || '',
        notes: notes,
        tags: customer?.tags || [],
        company_id: companyId || null,
        assigned_user_id: assignedUserId || null,
        is_global: isGlobal,
        send_whatsapp: sendWhatsapp,
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
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={isGlobal}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none bg-white disabled:opacity-50"
            >
              <option value="">No company assigned</option>
              {companies.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isGlobal}
              onChange={(e) => setIsGlobal(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm text-slate-700 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-blue-600" />
              Global Customer (Shared across all companies)
            </span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sendWhatsapp}
              onChange={(e) => setSendWhatsapp(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm text-slate-700 flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-green-600" />
              Send WhatsApp Reminders
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
