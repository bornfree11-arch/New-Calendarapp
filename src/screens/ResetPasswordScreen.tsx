import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { CalendarClock, Lock, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';

interface ResetPasswordScreenProps {
  onDone: () => void;
  onBackToLogin: () => void;
}

export function ResetPasswordScreen({ onDone, onBackToLogin }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSessionReady(!!session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) setSessionReady(true);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => onDone(), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestNewLink(email: string) {
    await supabase.auth.resetPasswordForEmail(email);
  }

  // Expired / invalid link
  if (sessionReady === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-500 rounded-2xl mb-4 shadow-lg">
              <AlertCircle className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Link Expired</h1>
            <p className="text-slate-500 mt-2">
              This password reset link is no longer valid. Request a new one below.
            </p>
          </div>
          <RequestNewLinkForm onSubmit={handleRequestNewLink} onBackToLogin={onBackToLogin} />
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-2xl mb-4">
              <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">Password Updated</h1>
            <p className="text-slate-600">Your password has been changed. Taking you to your calendar…</p>
          </div>
        </div>
      </div>
    );
  }

  if (sessionReady === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <CalendarClock className="w-8 h-8 text-teal-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-2xl mb-4 shadow-lg">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Set New Password</h1>
          <p className="text-slate-500 mt-2">Choose a new password for your account.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="At least 6 characters"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                placeholder="Re-enter your new password"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition shadow-sm"
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function RequestNewLinkForm({
  onSubmit,
  onBackToLogin,
}: {
  onSubmit: (email: string) => void;
  onBackToLogin: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(email.trim());
    setSent(true);
  }

  if (sent) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
        <p className="text-slate-700">
          If an account exists for {email}, a new reset link has been sent. Check your email.
        </p>
        <button
          onClick={onBackToLogin}
          className="mt-6 w-full flex items-center justify-center gap-1 text-slate-500 hover:text-slate-700 font-medium text-sm transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-8 space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
          placeholder="you@company.com"
          autoFocus
        />
      </div>
      <button
        type="submit"
        className="w-full bg-teal-600 hover:bg-teal-700 text-white font-medium py-2.5 rounded-lg transition shadow-sm"
      >
        Send New Reset Link
      </button>
      <button
        type="button"
        onClick={onBackToLogin}
        className="w-full flex items-center justify-center gap-1 text-slate-500 hover:text-slate-700 font-medium text-sm transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back to sign in
      </button>
    </form>
  );
}
