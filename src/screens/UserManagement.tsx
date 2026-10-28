import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getProfiles, saveProfile, deleteProfile } from '@/lib/store';
import { Profile, COLOR_PALETTE, isLightColor } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { formatPhoneNumber, isValidPhoneNumber, getInitials } from '@/lib/dateUtils';
import { X, UserPlus, Mail, Ban, CheckCircle2, Pencil, Loader2, Trash2 } from 'lucide-react';

interface UserManagementProps {
  onClose: () => void;
  onDataChange?: () => void;
}

export function UserManagement({ onClose, onDataChange }: UserManagementProps) {
  const { profile: currentUser, refreshProfile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const u = await getProfiles();
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const activeColors = new Set(users.filter(u => u.status === 'active').map(u => u.calendar_color));

  async function handleToggleStatus(user: Profile) {
    if (user.id === currentUser?.id) {
      setError('You cannot deactivate your own account.');
      return;
    }
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    setActionLoading(true);
    try {
      await saveProfile({ ...user, status: newStatus }, currentUser?.id || null);
      await loadUsers();
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteUser(user: Profile) {
    if (user.id === currentUser?.id) {
      setError('You cannot delete your own account.');
      return;
    }
    setActionLoading(true);
    try {
      await deleteProfile(user.id, currentUser?.id || null);
      setDeletingUser(null);
      await loadUsers();
      onDataChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">User Management</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition"
            >
              <UserPlus className="w-4 h-4" />
              Add User
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

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading users...
            </div>
          ) : (
            <div className="space-y-2">
              {users.map(user => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <div
                    key={user.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition ${
                      user.status === 'inactive' ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-100 bg-white hover:border-slate-200'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isLightColor(user.calendar_color) ? 'text-slate-800' : 'text-white'}`}
                      style={{ backgroundColor: user.calendar_color }}
                    >
                      {getInitials(user.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800 text-sm flex items-center gap-2">
                        {user.full_name}
                        {user.role === 'admin' && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded font-medium">ADMIN</span>
                        )}
                        {isSelf && <span className="text-[10px] text-slate-400">(You)</span>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{user.email}</div>
                      {user.phone && <div className="text-xs text-slate-400">{user.phone}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(user)}
                        disabled={isSelf || actionLoading}
                        className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition disabled:opacity-30"
                        title={user.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      >
                        {user.status === 'active' ? <Ban className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => setDeletingUser(user)}
                        disabled={isSelf || actionLoading}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-30"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showAddForm && (
        <AddUserForm
          activeColors={activeColors}
          onClose={() => setShowAddForm(false)}
          onSaved={() => { setShowAddForm(false); loadUsers(); onDataChange?.(); }}
        />
      )}

      {editingUser && (
        <EditUserForm
          user={editingUser}
          activeColors={activeColors}
          currentUserId={currentUser?.id || ''}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); loadUsers(); refreshProfile(); onDataChange?.(); }}
        />
      )}

      {deletingUser && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">Delete User</h2>
              <button onClick={() => setDeletingUser(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-slate-600">
                Are you sure you want to delete <strong>{deletingUser.full_name}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
              <button
                onClick={() => handleDeleteUser(deletingUser)}
                disabled={actionLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm"
              >
                {actionLoading ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => setDeletingUser(null)}
                className="px-6 py-2.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddUserForm({ activeColors, onClose, onSaved }: {
  activeColors: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile: adminUser } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE.find(c => !activeColors.has(c.value))?.value || COLOR_PALETTE[0].value);
  const [role, setRole] = useState<'admin' | 'coworker'>('coworker');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const adminClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) { setError('Full name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!isValidPhoneNumber(phone)) { setError('Please enter a valid US phone number.'); return; }

    setSaving(true);
    try {
      const { data: authData, error: authError } = await adminClient.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create account.');

      await saveProfile({
        id: authData.user.id,
        email: email.trim(),
        full_name: fullName.trim(),
        phone,
        notes: '',
        calendar_color: color,
        role,
        status: 'active',
      }, adminUser?.id || null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Add New User</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <FormField label="Full Name *" value={fullName} onChange={setFullName} placeholder="Jane Smith" />
          <FormField label="Email *" value={email} onChange={setEmail} type="email" placeholder="jane@company.com" />
          <FormField label="Temporary Password *" value={password} onChange={setPassword} type="password" placeholder="At least 6 characters" />
          <FormField label="Phone" value={phone} onChange={(v) => setPhone(formatPhoneNumber(v))} type="tel" placeholder="(555) 123-4567" />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Calendar Color</label>
            <div className="grid grid-cols-6 gap-2">
              {COLOR_PALETTE.map(c => {
                const taken = activeColors.has(c.value);
                const selected = color === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    disabled={taken}
                    onClick={() => setColor(c.value)}
                    className={`w-10 h-10 rounded-full transition relative ${
                      selected ? 'ring-2 ring-offset-2 ring-slate-700' : ''
                    } ${taken ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c.value }}
                    title={taken ? `${c.name} (taken)` : c.name}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" checked={role === 'coworker'} onChange={() => setRole('coworker')} className="text-teal-600" />
                Coworker
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" checked={role === 'admin'} onChange={() => setRole('admin')} className="text-teal-600" />
                Administrator
              </label>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Creating...' : 'Create User'}
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

function EditUserForm({ user, activeColors, currentUserId, onClose, onSaved }: {
  user: Profile;
  activeColors: Set<string>;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile: adminUser } = useAuth();
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone || '');
  const [notes, setNotes] = useState(user.notes);
  const [color, setColor] = useState(user.calendar_color);
  const [role, setRole] = useState<'admin' | 'coworker'>(user.role);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const availableColors = new Set(activeColors);
  availableColors.delete(user.calendar_color);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) { setError('Full name is required.'); return; }
    if (phone && !isValidPhoneNumber(phone)) { setError('Please enter a valid US phone number.'); return; }

    setSaving(true);
    try {
      await saveProfile({
        ...user,
        full_name: fullName.trim(),
        phone: phone || null,
        notes,
        calendar_color: color,
        role,
      }, adminUser?.id || null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Edit User</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{user.email}</div>
          <FormField label="Full Name *" value={fullName} onChange={setFullName} />
          <FormField label="Phone" value={phone} onChange={(v) => setPhone(formatPhoneNumber(v))} type="tel" placeholder="(555) 123-4567" />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Calendar Color</label>
            <div className="grid grid-cols-6 gap-2">
              {COLOR_PALETTE.map(c => {
                const taken = availableColors.has(c.value);
                const selected = color === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    disabled={taken}
                    onClick={() => setColor(c.value)}
                    className={`w-10 h-10 rounded-full transition ${
                      selected ? 'ring-2 ring-offset-2 ring-slate-700' : ''
                    } ${taken ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c.value }}
                    title={taken ? `${c.name} (taken)` : c.name}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" checked={role === 'coworker'} onChange={() => setRole('coworker')} className="text-teal-600" />
                Coworker
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" checked={role === 'admin'} onChange={() => setRole('admin')} className="text-teal-600" />
                Administrator
              </label>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving...' : 'Save Changes'}
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

function FormField({ label, value, onChange, type = 'text', placeholder }: {
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
