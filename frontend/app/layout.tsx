'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { LogOut, Loader2, BadgeCheck } from 'lucide-react';
import './globals.css';

type Profile = {
  id: string;
  email: string | null;
  credits_remaining: number;
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Pages publiques d’auth (ne doivent pas afficher le header + pas de redirect loop)
  const isAuthPage = pathname === '/login' || pathname === '/register';

  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      setLoadingProfile(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      // ✅ Pas connecté
      if (!user) {
        setEmail(null);
        setProfile(null);
        setLoadingProfile(false);

        // ✅ IMPORTANT : ne pas rediriger si on est déjà sur /login ou /register
        if (!isAuthPage) {
          router.push('/login');
        }
        return;
      }

      // ✅ Connecté
      setEmail(user.email ?? null);

      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,credits_remaining')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Erreur chargement profile:', error);
        setProfile(null);
      } else {
        setProfile(data as Profile);
      }

      setLoadingProfile(false);
    };

    loadUser();
  }, [router, isAuthPage]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      setEmail(null);
      setProfile(null);
      router.push('/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const isLoggedIn = !!email;

  return (
    <html lang="fr">
      <body className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* ✅ HEADER GLOBAL : seulement si connecté ET pas sur /login|/register */}
        {!isAuthPage && isLoggedIn && (
          <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-blue-100">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => router.push('/')}
                role="button"
                tabIndex={0}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center shadow">
                  <BadgeCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">
                    Plateforme Livraison
                  </div>
                  <div className="text-xs text-gray-600">
                    Distances · Tarification · Factures
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 border">
                  <div className="text-xs text-gray-600">
                    <div className="font-semibold text-gray-900">
                      {email ?? '—'}
                    </div>
                    <div className="mt-0.5">
                      {loadingProfile ? (
                        <span className="inline-flex items-center gap-2 text-gray-600">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Chargement crédits…
                        </span>
                      ) : (
                        <span className="text-gray-700">
                          Crédits :{' '}
                          <span className="font-semibold text-gray-900">
                            {profile?.credits_remaining ?? '—'}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border hover:bg-gray-50 text-gray-800 font-semibold disabled:opacity-60"
                  title="Déconnexion"
                  type="button"
                >
                  {loggingOut ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Déconnexion…
                    </>
                  ) : (
                    <>
                      <LogOut className="w-4 h-4" />
                      Déconnexion
                    </>
                  )}
                </button>
              </div>
            </div>
          </header>
        )}

        {/* CONTENU */}
        <main className={isAuthPage ? '' : 'max-w-7xl mx-auto px-6 py-8'}>
          {children}
        </main>
      </body>
    </html>
  );
}
