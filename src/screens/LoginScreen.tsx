import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { CalendarClock, Mail, Lock, ArrowLeft } from 'lucide-react';

interface LoginScreenProps {
  onSetup?: () => void;
}

export function LoginScreen({ onSetup }: LoginScreenProps) {
  const { refreshProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (resetError) throw resetError;
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-2xl mb-4 shadow-lg">
            <CalendarClock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            {forgotMode ? 'Reset Password' : 'Shared Calendar'}
          </h1>
          <p className="text-slate-500 mt-2">
            {forgotMode
              ? 'Enter your email to receive a password reset link.'
              : 'Sign in to manage appointments and schedules.'}
          </p>
        </div>

        {forgotSent ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <p className="text-slate-700">
              If an account exists for {email}, a password reset link has been sent.
              Check your email and follow the instructions to reset your password.
            </p>
            <button
              onClick={() => { setForgotMode(false); setForgotSent(false); }}
              className="mt-6 text-teal-600 hover:text-teal-700 font-medium text-sm"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form
            onSubmit={forgotMode ? handleForgotPassword : handleLogin}
            className="bg-white rounded-2xl shadow-xl p-8 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                  placeholder="you@company.com"
                  autoFocus
                />
              </div>
            </div>

            {!forgotMode && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition"
                    placeholder="Enter your password"
                  />
                </div>
              </div>
            )}

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
              {loading ? 'Please wait...' : forgotMode ? 'Send Reset Link' : 'Sign In'}
            </button>

            {forgotMode ? (
              <button
                type="button"
                onClick={() => setForgotMode(false)}
                className="w-full flex items-center justify-center gap-1 text-slate-500 hover:text-slate-700 font-medium text-sm transition"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setForgotMode(true)}
                  className="w-full text-teal-600 hover:text-teal-700 font-medium text-sm transition"
                >
                  Forgot password?
                </button>
                {onSetup && (
                  <button
                    type="button"
                    onClick={onSetup}
                    className="w-full text-slate-500 hover:text-slate-700 font-medium text-sm transition"
                  >
                    First time setup
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
