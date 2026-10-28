import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { Profile } from '@/types';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
  profile: Profile | null;
  loading: boolean;
  signOut: () => void;
  refreshProfile: () => void;
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  async function loadProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle<Profile>();
    if (error) return null;
    return data;
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        if (mounted) setLoading(false);
        return;
      }
      const prof = await loadProfile(session.user.id);
      if (mounted) {
        setProfile(prof);
        setLoading(false);
      }
    });

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        if (mounted) setPasswordRecovery(true);
      }
      (async () => {
        if (!session) {
          if (mounted) {
            setProfile(null);
            setLoading(false);
          }
          return;
        }
        const prof = await loadProfile(session.user.id);
        if (mounted) {
          setProfile(prof);
          setLoading(false);
        }
      })();
    });

    return () => { mounted = false; };
  }, []);

  const refreshProfile = useCallback(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const prof = await loadProfile(session.user.id);
        setProfile(prof);
      }
    })();
  }, []);

  const signOut = useCallback(() => {
    supabase.auth.signOut();
    setProfile(null);
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false);
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading, signOut, refreshProfile, passwordRecovery, clearPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
