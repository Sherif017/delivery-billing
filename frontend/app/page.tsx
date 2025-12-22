'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import {
  UploadCloud,
  Route,
  Calculator,
  FileText,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [loadingSession, setLoadingSession] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setIsLoggedIn(!!user);
      } finally {
        setLoadingSession(false);
      }
    };
    load();
  }, []);

  // (Optionnel) éviter un flash "Se connecter" quand on est connecté
  if (loadingSession) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-blue-100">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="h-10 w-56 rounded-xl bg-white/60 animate-pulse" />
          <div className="mt-10 grid lg:grid-cols-2 gap-10 items-start">
            <div className="space-y-4">
              <div className="h-6 w-64 rounded-lg bg-white/60 animate-pulse" />
              <div className="h-12 w-full rounded-xl bg-white/60 animate-pulse" />
              <div className="h-12 w-5/6 rounded-xl bg-white/60 animate-pulse" />
              <div className="h-12 w-4/6 rounded-xl bg-white/60 animate-pulse" />
            </div>
            <div className="h-80 rounded-2xl bg-white/60 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-blue-100">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg">
              <Route className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xl font-black tracking-tight text-slate-900">
                KILOMATE
              </div>
              <div className="text-sm text-slate-600">
                Du trajet à la facture, automatiquement
              </div>
            </div>
          </div>

          {/* ✅ CTA en haut : on garde 1 seul bouton utile */}
          <button
            onClick={() => router.push('/uploads')}
            type="button"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shadow-lg"
          >
            Importer un fichier
            <UploadCloud className="w-5 h-5" />
          </button>
        </div>

        {/* CONTENT */}
        <div className="mt-10 grid lg:grid-cols-2 gap-10 items-start">
          {/* LEFT */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 border border-white text-sm text-slate-700 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
              Import Excel/CSV → Distances → Tarifs → PDF
            </div>

            {/* ✅ Si connecté : on supprime le gros pitch / marketing */}
            {!isLoggedIn ? (
              <>
                <h1 className="mt-5 text-4xl md:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                  Importez vos trajets,
                  <span className="text-indigo-700"> générez vos factures</span>{' '}
                  en quelques clics.
                </h1>

                <p className="mt-5 text-lg text-slate-700 leading-relaxed">
                  Avec <span className="font-semibold text-slate-900">KILOMATE</span>, vous n’avez qu’à{' '}
                  <span className="font-semibold">charger un fichier Excel ou CSV</span> de vos trajets de livraison
                  (clients, adresses…). La plateforme calcule les distances, applique votre tarification
                  et génère automatiquement une facture par client.
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-5 text-2xl md:text-3xl font-black tracking-tight text-slate-900">
                  Votre espace KILOMATE
                </h2>
                <p className="mt-3 text-slate-700">
                  Importez un fichier, appliquez votre tarification, puis générez vos factures.
                </p>
              </>
            )}

            {/* CTA */}
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => router.push('/uploads')}
                type="button"
                className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-lg"
              >
                Importer un fichier (Excel / CSV)
                <UploadCloud className="w-5 h-5" />
              </button>

              {/* ✅ “Se connecter” uniquement si pas connecté */}
              {!isLoggedIn && (
                <button
                  onClick={() => router.push('/login')}
                  type="button"
                  className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-white/80 border border-white text-slate-900 font-semibold hover:bg-white shadow-sm"
                >
                  Se connecter
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="mt-6 text-sm text-slate-600">
              Formats : <span className="font-semibold text-slate-900">.xlsx</span>,{' '}
              <span className="font-semibold text-slate-900">.csv</span> • Factures :{' '}
              <span className="font-semibold text-slate-900">PDF</span> (par client) • Export ZIP
            </div>
          </div>

          {/* RIGHT: flow card */}
          <div className="bg-white/70 backdrop-blur rounded-2xl shadow-xl border border-white p-6">
            <div className="text-sm font-bold text-indigo-700">Le flux KILOMATE</div>
            <div className="mt-4 space-y-3">
              <Step
                icon={<UploadCloud className="w-5 h-5" />}
                title="1. Import"
                desc="Chargez votre fichier Excel/CSV de trajets."
              />
              <Step
                icon={<Route className="w-5 h-5" />}
                title="2. Distances"
                desc="KILOMATE calcule automatiquement les distances."
              />
              <Step
                icon={<Calculator className="w-5 h-5" />}
                title="3. Tarification"
                desc="Définissez vos tranches (HT/TVA) et appliquez."
              />
              <Step
                icon={<FileText className="w-5 h-5" />}
                title="4. Factures"
                desc="Téléchargez un PDF par client ou un ZIP complet."
              />
            </div>

            <div className="mt-6 rounded-xl bg-indigo-50 border border-indigo-100 p-4">
              <div className="text-sm font-bold text-slate-900">Astuce</div>
              <div className="text-sm text-slate-700 mt-1">
                Testez d’abord avec un petit fichier (10 lignes) pour valider le rendu, puis traitez tout le mois.
              </div>
            </div>
          </div>
        </div>

        {/* ✅ Features : utiles surtout hors login ; si connecté on peut les garder ou les alléger */}
        {!isLoggedIn && (
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            <Feature
              title="Pensé pour la livraison"
              desc="Trajets, clients, adresses, distances : tout est structuré pour la facturation transport."
            />
            <Feature
              title="Tarification flexible"
              desc="Tranches de km, TVA, “et +”… configurez une fois, réutilisez."
            />
            <Feature
              title="Factures prêtes à envoyer"
              desc="PDF par client + export ZIP. Aperçu HTML disponible."
            />
          </div>
        )}

        <div className="mt-12 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} KILOMATE — Du trajet à la facture, automatiquement
        </div>
      </div>
    </main>
  );
}

function Step({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-4">
      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
        {icon}
      </div>
      <div>
        <div className="font-bold text-slate-900">{title}</div>
        <div className="text-sm text-slate-700 mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-2xl shadow-lg border border-white p-6">
      <div className="text-lg font-bold text-slate-900">{title}</div>
      <div className="mt-2 text-sm text-slate-700 leading-relaxed">{desc}</div>
    </div>
  );
}
