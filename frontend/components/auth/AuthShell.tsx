'use client';

import React from 'react';
import {
  Route,
  UploadCloud,
  Calculator,
  FileText,
  BadgeCheck,
  Sparkles,
} from 'lucide-react';

export default function AuthShell({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-blue-100">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          {/* Left: Pitch */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg">
                <Route className="w-6 h-6" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-slate-900">
                  KILOMATE
                </div>
                <div className="text-sm text-slate-600">
                  Du trajet à la facture, automatiquement
                </div>
              </div>
            </div>

            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 border border-white text-sm text-slate-700 shadow-sm">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Import Excel/CSV → Distances → Tarifs → Factures PDF
              </div>

              <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-900 leading-tight">
                Importez vos trajets,
                <span className="text-indigo-700"> générez vos factures</span>.
              </h1>

              <p className="mt-4 text-lg text-slate-700 leading-relaxed">
                Chargez un fichier <span className="font-semibold text-slate-900">Excel</span> ou{' '}
                <span className="font-semibold text-slate-900">CSV</span> contenant vos trajets de livraison
                (clients, adresses…). KILOMATE calcule les distances, applique votre tarification et génère une
                facture par client.
              </p>
            </div>

            {/* Steps */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Step
                icon={<UploadCloud className="w-5 h-5" />}
                title="Import Excel / CSV"
                desc="Déposez votre fichier de trajets."
              />
              <Step
                icon={<Route className="w-5 h-5" />}
                title="Distances"
                desc="Calcul automatique des km."
              />
              <Step
                icon={<Calculator className="w-5 h-5" />}
                title="Tarification"
                desc="Tranches km + HT/TVA."
              />
              <Step
                icon={<FileText className="w-5 h-5" />}
                title="Factures PDF"
                desc="1 PDF par client + ZIP."
              />
            </div>

            {/* Credits */}
            <div className="rounded-2xl border border-indigo-100 bg-white/70 backdrop-blur p-5 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <BadgeCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-slate-900">
                    Crédits gratuits pour tester
                  </div>
                  <div className="text-sm text-slate-700 mt-1">
                    À l’inscription, vous recevez des crédits pour faire vos premiers imports et générer des factures
                    gratuitement. Idéal pour tester avec un petit fichier.
                  </div>
                </div>
              </div>
            </div>

            <div className="text-sm text-slate-600">
              Formats supportés : <span className="font-semibold text-slate-900">.xlsx</span>,{' '}
              <span className="font-semibold text-slate-900">.csv</span> • Factures :{' '}
              <span className="font-semibold text-slate-900">PDF</span>
            </div>
          </div>

          {/* Right: Form container */}
          <div className="bg-white/80 backdrop-blur rounded-2xl shadow-xl border border-white overflow-hidden">
            <div className="px-6 py-6 bg-gradient-to-r from-indigo-600 to-blue-600">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-2xl font-black text-white">{title}</div>
                  <div className="text-indigo-100 text-sm mt-1">{subtitle}</div>
                </div>
                {badge ? <div className="shrink-0">{badge}</div> : null}
              </div>
            </div>

            <div className="p-6">{children}</div>
          </div>
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
        <div className="font-bold text-slate-900 text-sm">{title}</div>
        <div className="text-xs text-slate-600 mt-1">{desc}</div>
      </div>
    </div>
  );
}
