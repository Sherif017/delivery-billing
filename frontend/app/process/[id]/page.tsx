'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Save,
  ChevronRight,
} from 'lucide-react';

type UploadStatus =
  | 'ready'
  | 'pending_validation'
  | 'processing'
  | 'distances_done'
  | 'failed'
  | string;

type Upload = {
  id: string;
  filename?: string | null;
  status: UploadStatus;
  total_deliveries?: number | null;
  created_at?: string;
};

type InvalidAddressRow = {
  id: string;
  original_number: string | null;
  original_street: string | null;
  original_postal_code: string | null;
  original_city: string | null;
  original_country: string | null;
  corrected_number: string | null;
  corrected_street: string | null;
  corrected_postal_code: string | null;
  corrected_city: string | null;
  corrected_country: string | null;
  full_address: string | null;
  issues: string[] | any;
  is_valid: boolean;
};

function normalizeIssues(issues: any): string[] {
  if (!issues) return [];
  if (Array.isArray(issues)) return issues.map((x) => String(x));
  if (typeof issues === 'string') return [issues];
  try {
    return [JSON.stringify(issues)];
  } catch {
    return ['Adresse invalide'];
  }
}

function safeText(v: any) {
  const s = String(v ?? '').trim();
  return s.length ? s : '';
}

export default function ProcessPage() {
  const params = useParams();
  const router = useRouter();
  const uploadId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [invalidRows, setInvalidRows] = useState<InvalidAddressRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const [draft, setDraft] = useState<
    Record<
      string,
      {
        number: string;
        street: string;
        postalCode: string;
        city: string;
        country: string;
      }
    >
  >({});

  const loadAll = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;

    try {
      if (!silent) setRefreshing(true);
      setErrorMsg(null);

      const statusRes = await api.get(`/upload/${uploadId}/status`);
      const u: Upload = statusRes.data?.upload;
      setUpload(u);

      const invRes = await api.get(`/upload/${uploadId}/invalid-addresses`);
      const rows: InvalidAddressRow[] = invRes.data?.addresses ?? [];
      setInvalidRows(rows);

      setDraft((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          if (!next[r.id]) {
            next[r.id] = {
              number: safeText(r.corrected_number ?? r.original_number),
              street: safeText(r.corrected_street ?? r.original_street),
              postalCode: safeText(r.corrected_postal_code ?? r.original_postal_code),
              city: safeText(r.corrected_city ?? r.original_city),
              country: safeText(r.corrected_country ?? r.original_country) || 'France',
            };
          }
        }
        return next;
      });

      // ✅ Si distances terminées -> go pricing (PAS dashboard !)
      if (u?.status === 'distances_done') {
        console.log('✅ Distances calculées, redirection vers pricing...');
        router.push(`/pricing/${uploadId}`);
        return;
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.response?.data?.message || "Impossible de charger l'état de l'upload.");
    } finally {
      if (!silent) setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const hasInvalid = invalidRows.length > 0;

  const canStart = useMemo(() => {
    const st = upload?.status;
    if (!st) return false;
    if (starting) return false;
    if (st === 'processing') return false;

    if (st === 'pending_validation') {
      return invalidRows.length === 0;
    }
    return true;
  }, [upload?.status, starting, invalidRows.length]);

  const startPolling = () => {
    setPolling(true);
  };

  useEffect(() => {
    if (!polling) return;

    const t = setInterval(async () => {
      try {
        const res = await api.get(`/upload/${uploadId}/status`);
        const u: Upload = res.data?.upload;
        setUpload(u);

        const invRes = await api.get(`/upload/${uploadId}/invalid-addresses`);
        const rows: InvalidAddressRow[] = invRes.data?.addresses ?? [];
        setInvalidRows(rows);

        if (u?.status === 'distances_done') {
          setPolling(false);
          router.push(`/pricing/${uploadId}`);
        }

        if (u?.status === 'pending_validation') {
          setPolling(false);
        }

        if (u?.status === 'failed') {
          setPolling(false);
          setErrorMsg('Le traitement a échoué (status=failed). Réessaye ou vérifie les logs backend.');
        }
      } catch (e) {
        // Ignore les erreurs en polling
      }
    }, 2000);

    return () => clearInterval(t);
  }, [polling, uploadId, router]);

  const handleStartProcess = async () => {
    setErrorMsg(null);

    try {
      setStarting(true);

      const res = await api.post(`/upload/${uploadId}/process`);
      
      if (res.data?.success === false && res.data?.invalid_count) {
        await loadAll();
        return;
      }

      startPolling();
      await loadAll({ silent: true });
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.response?.data?.message || 'Impossible de lancer le calcul des distances.');
      await loadAll({ silent: true });
    } finally {
      setStarting(false);
    }
  };

  const handleSaveRow = async (row: InvalidAddressRow) => {
    const d = draft[row.id];
    if (!d) return;

    const payload = {
      number: d.number?.trim() || '',
      street: d.street?.trim() || '',
      postalCode: d.postalCode?.trim() || '',
      city: d.city?.trim() || '',
      country: d.country?.trim() || 'France',
    };

    if (!payload.street || !payload.postalCode || !payload.city) {
      setErrorMsg("Adresse incomplète : renseigne au moins rue, code postal et ville.");
      return;
    }

    try {
      setSavingRowId(row.id);
      setErrorMsg(null);

      const res = await api.patch(`/upload/${uploadId}/fix-address/${row.id}`, payload);

      await loadAll();

      if (res.data?.all_valid === true) {
        await handleStartProcess();
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.response?.data?.message || "Erreur lors de l'enregistrement de l'adresse.");
    } finally {
      setSavingRowId(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-700 font-medium">Chargement…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>

        <div className="bg-white rounded-2xl shadow-xl border border-blue-100 p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900">
                {upload?.status === 'processing' ? '⚙️ Calcul des distances' : '📍 Traitement du fichier'}
              </h1>
              <div className="mt-3 space-y-1 text-sm">
                <div className="text-gray-700">
                  <span className="font-semibold">Fichier :</span>{' '}
                  {upload?.filename || 'Sans nom'}
                </div>
                <div className="text-gray-700">
                  <span className="font-semibold">Status :</span>{' '}
                  <span className="font-mono">{upload?.status ?? '—'}</span>
                </div>
                <div className="text-gray-700">
                  <span className="font-semibold">Livraisons :</span>{' '}
                  {upload?.total_deliveries ?? '—'}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {upload?.status !== 'processing' && (
                <button
                  type="button"
                  onClick={() => loadAll()}
                  disabled={refreshing}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white border hover:bg-gray-50 text-gray-800 font-medium disabled:opacity-60"
                >
                  {refreshing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Rafraîchissement…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5" />
                      Rafraîchir
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={handleStartProcess}
                disabled={!canStart}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                title={
                  upload?.status === 'pending_validation' && hasInvalid
                    ? 'Corrige les adresses invalides pour débloquer le calcul'
                    : undefined
                }
              >
                {starting || polling ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Calcul en cours…
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-5 h-5" />
                    Lancer le calcul
                  </>
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="whitespace-pre-line">{errorMsg}</div>
            </div>
          )}

          {upload?.status === 'processing' && (
            <div className="mt-5 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Loader2 className="w-5 h-5 animate-spin flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-lg">Calcul en cours via Google Maps API…</div>
                  <div className="mt-2 text-sm">
                    Cette opération peut prendre plusieurs minutes selon le nombre de livraisons.
                  </div>
                  <div className="mt-2 text-sm">
                    La page se rafraîchit automatiquement et vous redirigera vers la tarification une fois terminé.
                  </div>
                </div>
              </div>
            </div>
          )}

          {upload?.status === 'pending_validation' && hasInvalid && (
            <div className="mt-5 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold text-lg">Adresses à corriger</div>
                  <div className="mt-2 text-sm">
                    Certaines adresses sont invalides. Corrige-les ci-dessous pour débloquer le calcul.
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    Dès que toutes les adresses seront valides, le calcul se lancera automatiquement.
                  </div>
                </div>
              </div>
            </div>
          )}

          {upload?.status === 'pending_validation' && !hasInvalid && (
            <div className="mt-5 bg-green-50 border border-green-200 text-green-800 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Plus d'adresses invalides ✅</div>
                  <div className="mt-1 text-sm">
                    Tu peux maintenant lancer le calcul des distances avec le bouton ci-dessus.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bloc correction */}
        {upload?.status === 'pending_validation' && hasInvalid && (
          <div className="bg-white rounded-2xl shadow-xl border border-blue-100 p-6">
            <div className="flex items-center gap-2 mb-6">
              <MapPin className="w-6 h-6 text-indigo-600" />
              <h2 className="text-2xl font-bold text-gray-900">Adresses à corriger</h2>
              <span className="ml-2 px-3 py-1 bg-amber-100 text-amber-900 text-sm font-semibold rounded-full">
                {invalidRows.length}
              </span>
            </div>

            <div className="space-y-4">
              {invalidRows.map((row) => {
                const d = draft[row.id] ?? {
                  number: '',
                  street: '',
                  postalCode: '',
                  city: '',
                  country: 'France',
                };

                const issues = normalizeIssues(row.issues);

                return (
                  <div key={row.id} className="border-2 border-gray-200 rounded-2xl p-5 bg-gray-50 hover:border-indigo-300 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
                          Adresse détectée
                        </div>
                        <div className="text-base font-medium text-gray-900">
                          {(row.full_address ?? '').trim() || '—'}
                        </div>

                        {issues.length > 0 && (
                          <div className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-3">
                            <div className="font-bold mb-1.5 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />
                              Problèmes détectés
                            </div>
                            <ul className="list-disc pl-5 space-y-1">
                              {issues.slice(0, 6).map((it, idx) => (
                                <li key={idx}>{it}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                      <Field
                        label="N°"
                        value={d.number}
                        onChange={(v) =>
                          setDraft((p) => ({ ...p, [row.id]: { ...d, number: v } }))
                        }
                      />
                      <Field
                        label="Rue *"
                        value={d.street}
                        onChange={(v) =>
                          setDraft((p) => ({ ...p, [row.id]: { ...d, street: v } }))
                        }
                        className="md:col-span-2"
                      />
                      <Field
                        label="Code postal *"
                        value={d.postalCode}
                        onChange={(v) =>
                          setDraft((p) => ({ ...p, [row.id]: { ...d, postalCode: v } }))
                        }
                      />
                      <Field
                        label="Ville *"
                        value={d.city}
                        onChange={(v) =>
                          setDraft((p) => ({ ...p, [row.id]: { ...d, city: v } }))
                        }
                      />
                      <Field
                        label="Pays"
                        value={d.country}
                        onChange={(v) =>
                          setDraft((p) => ({ ...p, [row.id]: { ...d, country: v } }))
                        }
                      />
                    </div>

                    <div className="mt-4 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveRow(row)}
                        disabled={savingRowId === row.id}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60 shadow-md"
                      >
                        {savingRowId === row.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Enregistrement…
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            Sauvegarder
                            <ChevronRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-gray-900 font-medium"
      />
    </div>
  );
}