'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Gift, Loader2, UserPlus } from 'lucide-react';
import AuthShell from '@/components/auth/AuthShell';

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const emailOk = email.trim().length > 3;
  const passwordOk = password.length >= 6;
  const passwordsMatch = password === confirmPassword;
  const isValid = emailOk && passwordOk && passwordsMatch;

  const freeCreditsLabel = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_FREE_CREDITS;
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return `${n} crédits offerts`;
    return 'Crédits offerts';
  }, []);

  const badge = (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 text-indigo-700 text-xs font-bold border border-white shadow-sm">
      <Gift className="w-4 h-4" />
      🎁 {freeCreditsLabel}
    </div>
  );

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!emailOk) {
      setErrorMsg('Email invalide.');
      return;
    }
    if (!passwordOk) {
      setErrorMsg('Mot de passe trop court (minimum 6 caractères).');
      return;
    }
    if (!passwordsMatch) {
      setErrorMsg('Les mots de passe ne correspondent pas.');
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setSuccessMsg(
        "Compte créé ! Si la confirmation email est activée, vérifiez votre boîte mail puis connectez-vous.",
      );

      setTimeout(() => router.push('/login'), 900);
    } catch (err: any) {
      setErrorMsg(err?.message || "Erreur lors de la création du compte.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Testez KILOMATE gratuitement avec des crédits offerts."
      badge={badge}
    >
      <form onSubmit={handleRegister} className="space-y-4">
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3 text-sm">
            {successMsg}
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
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
          />
          <p className="text-xs text-slate-500 mt-1">Minimum 6 caractères.</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1">
            Confirmer le mot de passe
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
          />
          {!passwordsMatch && confirmPassword.length > 0 && (
            <p className="text-xs text-red-600 mt-1">
              Les mots de passe ne correspondent pas.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !isValid}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Création…
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              Créer mon compte
            </>
          )}
        </button>

        <div className="text-sm text-slate-700 text-center pt-2">
          Déjà un compte ?{' '}
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="font-semibold text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
          >
            Se connecter
          </button>
        </div>

        <p className="text-xs text-slate-500 text-center pt-2">
          Les crédits gratuits sont attribués automatiquement à la création du compte.
        </p>
      </form>
    </AuthShell>
  );
}
