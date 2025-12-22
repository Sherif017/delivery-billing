'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  Loader2,
  Search,
  ArrowLeft,
  FileText,
  Clock,
  ChevronRight,
  UploadCloud,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

type UploadRow = {
  id: string;
  filename: string;
  status: string;
  total_deliveries: number | null;
  total_clients: number | null;
  total_amount: number | null;
  created_at: string;
};

function isAllowedFile(file: File) {
  const name = (file?.name ?? '').toLowerCase();
  return name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv');
}

function formatDate(v: string) {
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

function formatMoney(v: number | null | undefined) {
  return Number(v ?? 0).toFixed(2) + ' €';
}

export default function UploadsPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [query, setQuery] = useState('');

  const [dragOver, setDragOver] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    loadUploads();
  }, []);

  const loadUploads = async () => {
    try {
      setLoading(true);
      const res = await api.get('/upload/my-uploads');
      setUploads(res.data?.uploads ?? []);
    } catch (e) {
      console.error('Erreur historique uploads:', e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uploads;
    return uploads.filter(
      (u) =>
        (u.filename ?? '').toLowerCase().includes(q) ||
        (u.id ?? '').toLowerCase().includes(q),
    );
  }, [uploads, query]);

  const goToNextStep = (u: UploadRow) => {
    if (u.status === 'distances_done') router.push(`/pricing/${u.id}`);
    else router.push(`/process/${u.id}`);
  };

  const startUpload = async (file: File) => {
    setUploadError(null);
    setUploadOk(null);

    if (!isAllowedFile(file)) {
      setUploadError('Format non supporté. Importez un fichier .xlsx, .xls ou .csv.');
      return;
    }

    try {
      setUploading(true);
      setUploadOk('Upload en cours…');

      const form = new FormData();
      form.append('file', file);

      const res = await api.post('/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const uploadId: string | undefined =
        res.data?.upload_id ??
        res.data?.upload?.id ??
        res.data?.id;

      if (!uploadId) {
        console.error('UPLOAD RESPONSE DATA =>', res.data);
        setUploadError(
          "Upload OK mais l'API n'a pas renvoyé d'upload_id. Vérifie la réponse dans la console.",
        );
        return;
      }

      const needsValidation = !!res.data?.needs_validation;

      setUploadOk('Upload OK ✅ Redirection…');

      await loadUploads();

      if (needsValidation) {
        router.push(`/process/${uploadId}`);
      } else {
        router.push(`/process/${uploadId}`);
      }
    } catch (e: any) {
      console.error('Erreur upload:', e);
      setUploadError(
        e?.response?.data?.message || "Erreur lors de l'import du fichier.",
      );
      setUploadOk(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-6 font-medium"
          type="button"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>

        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-gray-900">
            Importer & historique
          </h1>
          <p className="text-gray-700 mt-2">
            Importez un fichier Excel/CSV, puis reprenez le flux (distances → tarification → factures).
          </p>
        </div>

        {/* Upload box */}
        <div
          className={[
            'bg-white rounded-2xl shadow-xl border p-5 mb-6 transition',
            dragOver ? 'border-indigo-400 ring-4 ring-indigo-100' : 'border-blue-100',
          ].join(' ')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) startUpload(file);
          }}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900">
                  Importer un fichier
                </div>
                <div className="text-sm text-gray-600">
                  Glissez-déposez un fichier ici ou cliquez sur “Choisir un fichier”.
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Formats acceptés : <span className="font-semibold">.xlsx</span>,{' '}
                  <span className="font-semibold">.xls</span>,{' '}
                  <span className="font-semibold">.csv</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) startUpload(file);
                  if (inputRef.current) inputRef.current.value = '';
                }}
              />

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shadow-lg disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Import…
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-5 h-5" />
                    Choisir un fichier
                  </>
                )}
              </button>
            </div>
          </div>

          {(uploadOk || uploadError) && (
            <div className="mt-4">
              {uploadOk && (
                <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                  <div>{uploadOk}</div>
                </div>
              )}
              {uploadError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-start gap-2 mt-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  <div className="whitespace-pre-line">{uploadError}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Format attendu du fichier */}
        <div className="bg-white rounded-2xl shadow-xl border border-blue-100 p-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-gray-900">
                Format attendu du fichier
              </div>

              <p className="mt-2 text-sm text-gray-700">
                Le fichier doit contenir <strong>au minimum</strong> les colonnes suivantes
                (la première ligne doit contenir les en-têtes) :
              </p>

              <ul className="mt-3 grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {[
                  'Représentant du client',
                  'Numéro',
                  'Rue',
                  'Code postal',
                  'Ville',
                  'Pays',
                ].map((c) => (
                  <li
                    key={c}
                    className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 font-medium"
                  >
                    {c}
                  </li>
                ))}
              </ul>

              <div className="mt-3 text-sm text-gray-700">
                ✔️ L’ordre des colonnes n’a aucune importance<br />
                ✔️ Les colonnes supplémentaires ne posent aucun problème
              </div>

              <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
                <strong>CSV :</strong> séparateur <code>;</code>, première ligne = en-têtes.
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Astuce : commencez avec un petit fichier (5–10 lignes) pour valider le format.
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-xl border border-blue-100 p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher par nom de fichier ou ID…"
                className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>
            <div className="text-sm text-gray-600 font-medium whitespace-nowrap">
              {filtered.length} / {uploads.length}
            </div>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl shadow-xl border border-blue-100 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600">
            <h2 className="text-white font-bold text-lg">Mes imports</h2>
          </div>

          {loading ? (
            <div className="p-10 text-center">
              <Loader2 className="w-10 h-10 animate-spin mx-auto text-blue-600 mb-3" />
              <div className="text-gray-700 font-medium">Chargement…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-5xl mb-3">📁</div>
              <div className="text-gray-900 font-bold text-xl">Aucun import</div>
              <div className="text-gray-700 mt-2">Importe un fichier pour démarrer.</div>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => goToNextStep(u)}
                  className="w-full text-left px-6 py-4 hover:bg-blue-50 transition-colors flex items-center justify-between gap-4"
                  title="Ouvrir"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <div className="font-semibold text-gray-900 truncate">
                        {u.filename}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatDate(u.created_at)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 font-medium">
                        {u.status}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 font-semibold">
                        {u.total_deliveries ?? 0} livraisons
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-900 font-semibold">
                        {u.total_clients ?? 0} clients
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 font-semibold">
                        {formatMoney(u.total_amount)}
                      </span>
                      <span className="text-xs text-gray-400 truncate">
                        ID: {u.id}
                      </span>
                    </div>
                  </div>

                  <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
