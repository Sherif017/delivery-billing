'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Search,
  Users,
  Route,
  Euro,
  AlertCircle,
} from 'lucide-react';
import api, { downloadFile } from '@/lib/api';

type ClientOverview = {
  id: string;
  name: string;
  deliveriesCount: number;
  totalDistance: number;
  totalHT: number;
  totalTTC: number;
  nonPriced: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams();

  const uploadId = useMemo(() => {
    const raw = (params as any)?.id;
    if (Array.isArray(raw)) return raw[0];
    return raw ?? '';
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientOverview[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingClient, setDownloadingClient] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!uploadId) return;

      setLoading(true);
      setError(null);

      try {
        // ✅ logique inchangée : on lit juste le endpoint existant
        const res = await api.get(`/invoice/${encodeURIComponent(uploadId)}/clients`);
        setClients((res.data?.clients ?? []) as ClientOverview[]);
      } catch (e: any) {
        setError(e?.response?.data?.message || e?.message || 'Erreur chargement dashboard');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [uploadId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => (c.name ?? '').toLowerCase().includes(q));
  }, [clients, query]);

  const totals = useMemo(() => {
    const sum = (arr: ClientOverview[], key: keyof ClientOverview) =>
      arr.reduce((a, c) => a + Number(c[key] ?? 0), 0);

    const deliveriesCount = sum(filtered, 'deliveriesCount');
    const totalDistance = sum(filtered, 'totalDistance');
    const totalHT = sum(filtered, 'totalHT');
    const totalTTC = sum(filtered, 'totalTTC');
    const nonPriced = sum(filtered, 'nonPriced');

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      clientsCount: filtered.length,
      deliveriesCount,
      totalDistance: round2(totalDistance),
      totalHT: round2(totalHT),
      totalTTC: round2(totalTTC),
      nonPriced,
    };
  }, [filtered]);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(n || 0));

  const fmtKm = (n: number) =>
    new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(n || 0));

  const downloadZip = async () => {
    if (!uploadId) return;
    setDownloadingZip(true);
    try {
      await downloadFile(
        `/invoice/${encodeURIComponent(uploadId)}/zip`,
        `factures_${uploadId}.zip`,
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const downloadClientPdf = async (clientId: string, clientName: string) => {
    if (!uploadId) return;
    setDownloadingClient(clientId);
    try {
      await downloadFile(
        `/invoice/${encodeURIComponent(uploadId)}/${encodeURIComponent(clientId)}`,
        `facture_${(clientName || clientId).replace(/\s+/g, '_')}.pdf`,
      );
    } finally {
      setDownloadingClient(null);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
              type="button"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour
            </button>

            <h1 className="text-3xl font-bold text-gray-900 mb-1">Dashboard</h1>
            <p className="text-gray-600">
              Upload : <span className="font-mono break-all">{uploadId}</span>
            </p>
          </div>

          <button
            onClick={downloadZip}
            disabled={downloadingZip}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            type="button"
            title="Télécharger toutes les factures"
          >
            {downloadingZip ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                ZIP…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Télécharger tout (ZIP)
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Totaux (comme au début) */}
        <div className="grid md:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Clients"
            value={`${totals.clientsCount}`}
            sub={`${clients.length} au total`}
          />
          <StatCard
            icon={<Route className="w-5 h-5" />}
            label="Distance"
            value={`${fmtKm(totals.totalDistance)} km`}
            sub={`${totals.deliveriesCount} courses`}
          />
          <StatCard
            icon={<Euro className="w-5 h-5" />}
            label="Total HT"
            value={`${fmtMoney(totals.totalHT)} €`}
            sub="Somme des clients"
          />
          <StatCard
            icon={<Euro className="w-5 h-5" />}
            label="Total TTC"
            value={`${fmtMoney(totals.totalTTC)} €`}
            sub="Somme des clients"
          />
          <StatCard
            icon={<AlertCircle className="w-5 h-5" />}
            label="Non tarifées"
            value={`${totals.nonPriced}`}
            sub="Courses sans prix"
          />
        </div>

        {/* Recherche + liste */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un client…"
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-gray-900 bg-white"
              />
            </div>
          </div>

          {loading ? (
            <div className="py-10 flex items-center justify-center text-gray-600">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-gray-600">Aucun client.</div>
          ) : (
            <div className="space-y-4">
              {filtered.map((c) => (
                <div
                  key={c.id}
                  className="border rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 w-full">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {c.name || c.id}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {c.deliveriesCount} course(s) • Non tarifées : {c.nonPriced}
                        </div>
                      </div>

                      <button
                        onClick={() => downloadClientPdf(c.id, c.name)}
                        disabled={downloadingClient === c.id}
                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border hover:bg-gray-50 disabled:opacity-60"
                        type="button"
                        title="Télécharger la facture PDF du client"
                      >
                        {downloadingClient === c.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            PDF…
                          </>
                        ) : (
                          <>
                            <FileText className="w-4 h-4" />
                            PDF
                          </>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                      <div>
                        <div className="text-gray-500">Distance</div>
                        <div className="font-semibold text-gray-900">
                          {fmtKm(c.totalDistance)} km
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500">Total HT</div>
                        <div className="font-semibold text-gray-900">
                          {fmtMoney(c.totalHT)} €
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500">Total TTC</div>
                        <div className="font-semibold text-gray-900">
                          {fmtMoney(c.totalTTC)} €
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500">Courses</div>
                        <div className="font-semibold text-gray-900">
                          {c.deliveriesCount}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-5 border">
      <div className="flex items-center gap-2 text-gray-600">
        {icon}
        <div className="text-sm font-semibold">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-600">{sub}</div>
    </div>
  );
}
