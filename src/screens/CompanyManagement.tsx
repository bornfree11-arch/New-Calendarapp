import { useState, useEffect, useCallback } from 'react';
import { getCompanies, saveCompany, getTypeMappings, updateTypeMapping } from '@/lib/store';
import { useAuth } from '@/context/AuthContext';
import { Company, AppointmentTypeMapping, APPOINTMENT_TYPES } from '@/types';
import { formatPhoneNumber, isValidPhoneNumber } from '@/lib/dateUtils';
import { X, Plus, Pencil, Building2, Ban, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface CompanyManagementProps {
  onClose: () => void;
  onDataChange?: () => void;
}

export function CompanyManagement({ onClose, onDataChange }: CompanyManagementProps) {
  const { profile: currentUser } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mappings, setMappings] = useState<AppointmentTypeMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [c, m] = await Promise.all([getCompanies(), getTypeMappings()]);
      setCompanies(c);
      setMappings(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleToggleActive(company: Company) {
    setActionLoading(true);
    try {
      await saveCompany({ ...company, is_active: !company.is_active }, currentUser?.id || null);
      await loadData();
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update company.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMappingChange(type: string, companyId: string | null) {
    setActionLoading(true);
    try {
      await updateTypeMapping(type, companyId, currentUser?.id || null);
      await loadData();
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update mapping.');
    } finally {
      setActionLoading(false);
    }
  }

  const activeCompanies = companies.filter(c => c.is_active);
  const unassignedTypes = APPOINTMENT_TYPES.filter(
    type => !mappings.find(m => m.appointment_type === type)?.company_id
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Company Management</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              Add Company
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {unassignedTypes.length > 0 && !loading && (
          <div className="mx-6 mt-4 bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <div className="font-semibold">Setup incomplete</div>
              <div className="mt-1">
                The following appointment types have no company assigned: {unassignedTypes.join(', ')}.
                Client reminders for these types will not be sent until a company is assigned.
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading ? (
            <div className="text-center py-8 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading...
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Companies</h3>
                {companies.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                    No companies yet. Click "Add Company" to create one.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {companies.map(company => (
                      <div
                        key={company.id}
                        className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition ${
                          company.is_active ? 'border-slate-100 bg-white hover:border-slate-200' : 'border-slate-200 bg-slate-50 opacity-60'
                        }`}
                      >
                        <Building2 className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 text-sm">{company.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {company.address_line1}
                            {company.address_line2 && `, ${company.address_line2}`}
                          </div>
                          <div className="text-xs text-slate-500">
                            {company.city}, {company.state} {company.zip_code}
                          </div>
                          {company.phone && <div className="text-xs text-slate-400 mt-0.5">{company.phone}</div>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setEditingCompany(company)}
                            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(company)}
                            disabled={actionLoading}
                            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition disabled:opacity-30"
                            title={company.is_active ? 'Deactivate' : 'Reactivate'}
                          >
                            {company.is_active ? <Ban className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Appointment Type → Company Mapping</h3>
                <div className="space-y-2">
                  {APPOINTMENT_TYPES.map(type => {
                    const mapping = mappings.find(m => m.appointment_type === type);
                    const assignedCompany = companies.find(c => c.id === mapping?.company_id);
                    return (
                      <div key={type} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-slate-100 bg-white">
                        <div className="text-sm font-medium text-slate-700 w-32 shrink-0">{type}</div>
                        <select
                          value={mapping?.company_id || ''}
                          onChange={(e) => handleMappingChange(type, e.target.value || null)}
                          disabled={actionLoading}
                          className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none disabled:opacity-50"
                        >
                          <option value="">No company assigned</option>
                          {activeCompanies.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        {assignedCompany && (
                          <div className="text-xs text-slate-400 shrink-0 hidden sm:block">
                            {assignedCompany.city}, {assignedCompany.state}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {(showAddForm || editingCompany) && (
        <CompanyForm
          company={editingCompany}
          onClose={() => { setShowAddForm(false); setEditingCompany(null); }}
          onSaved={() => { setShowAddForm(false); setEditingCompany(null); loadData(); onDataChange?.(); }}
        />
      )}
    </div>
  );
}

function CompanyForm({ company, onClose, onSaved }: {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile: currentUser } = useAuth();
  const [name, setName] = useState(company?.name || '');
  const [addr1, setAddr1] = useState(company?.address_line1 || '');
  const [addr2, setAddr2] = useState(company?.address_line2 || '');
  const [city, setCity] = useState(company?.city || '');
  const [state, setState] = useState(company?.state || '');
  const [zip, setZip] = useState(company?.zip_code || '');
  const [phone, setPhone] = useState(company?.phone || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('Company name is required.'); return; }
    if (!addr1.trim()) { setError('Address is required.'); return; }
    if (!city.trim()) { setError('City is required.'); return; }
    if (!state.trim()) { setError('State is required.'); return; }
    if (!zip.trim()) { setError('ZIP code is required.'); return; }
    if (phone && !isValidPhoneNumber(phone)) { setError('Please enter a valid US phone number.'); return; }

    setSaving(true);
    try {
      await saveCompany({
        ...(company?.id ? { id: company.id } : {}),
        name: name.trim(),
        address_line1: addr1.trim(),
        address_line2: addr2.trim(),
        city: city.trim(),
        state: state.trim(),
        zip_code: zip.trim(),
        phone: phone || null,
        is_active: company?.is_active ?? true,
      }, currentUser?.id || null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">{company ? 'Edit Company' : 'Add Company'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3">
          <Field label="Company Name *" value={name} onChange={setName} />
          <Field label="Address Line 1 *" value={addr1} onChange={setAddr1} />
          <Field label="Address Line 2" value={addr2} onChange={setAddr2} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="City *" value={city} onChange={setCity} />
            <Field label="State *" value={state} onChange={setState} />
            <Field label="ZIP *" value={zip} onChange={setZip} />
          </div>
          <Field label="Phone" value={phone} onChange={(v) => setPhone(formatPhoneNumber(v))} type="tel" placeholder="(555) 123-4567" />

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

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
      />
    </div>
  );
}
