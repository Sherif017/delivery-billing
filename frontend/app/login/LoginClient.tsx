'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, LogIn } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const raw = searchParams.get('redirect') || '/';
    // sécurité: empêcher redirection externe
    if (!raw.startsWith('/')) return '/';
    return raw;
  }, [searchParams]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isValid = email.trim().length > 3 && password.length >= 6;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!isValid) {
      setErrorMsg('Email ou mot de passe invalide.');
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      router.push(redirectTo);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erreur lors de la connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Connexion"
      subtitle="Accédez à KILOMATE pour importer, calculer et facturer."
    >
      <form onSubmit={handleLogin} className="space-y-4">
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            {errorMsg}
          </div>
        )}

        {redirectTo !== '/' && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-lg p-3 text-sm">
            Connecte-toi pour accéder à{' '}
            <span className="font-semibold">{redirectTo}</span>.
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ex: contact@entreprise.com"
            autoComplete="email"
            className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1">
            Mot de passe
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
          />
          <p className="text-xs text-slate-500 mt-1">Minimum 6 caractères.</p>
        </div>

        <button
          type="submit"
          disabled={loading || !isValid}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connexion…
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              Se connecter
            </>
          )}
        </button>

        <div className="text-sm text-slate-700 text-center pt-2">
          Pas de compte ?{' '}
          <button
            type="button"
            onClick={() => router.push('/register')}
            className="font-semibold text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
          >
            Créer un compte
          </button>
        </div>

        <p className="text-xs text-slate-500 text-center pt-2">
          En vous connectant, vous pourrez suivre vos uploads et vos crédits.
        </p>
      </form>
    </AuthShell>
  );
}
