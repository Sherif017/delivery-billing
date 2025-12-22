'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import api from '@/lib/api';

type Client = {
  id: string;
  name: string;
};

export default function InvoicePreviewPage() {
  const params = useParams();
  const router = useRouter();

  const uploadId = params.uploadId as string;
  const clientId = params.clientId as string;

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [html, setHtml] = useState<string>('');
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filename = useMemo(() => {
    const base = (client?.name || clientId)
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '_');

    return `facture_${base || clientId}.pdf`;
  }, [client?.name, clientId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1) récupérer le nom client (pour afficher + nommer le fichier)
        const clientsRes = await api.get(`/upload/${uploadId}/clients`);
        const found = (clientsRes.data?.clients ?? []).find(
          (c: Client) => c.id === clientId,
        );
        setClient(found ?? { id: clientId, name: clientId });

        // 2) récupérer l'HTML depuis le backend (route confirmée dans ton controller)
        const htmlRes = await api.get(`/invoice/${uploadId}/${clientId}/html`, {
          responseType: 'text',
        });

        setHtml(typeof htmlRes.data === 'string' ? htmlRes.data : String(htmlRes.data ?? ''));
      } catch (e: any) {
        console.error('Erreur chargement aperçu facture:', e);
        setError(e?.response?.data?.message || "Erreur lors du chargement de l'aperçu");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [uploadId, clientId]);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const response = await api.get(`/invoice/${uploadId}/${clientId}`, {
        responseType: 'blob',
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Erreur téléchargement PDF:', e);
      alert(e?.response?.data?.message || 'Erreur lors du téléchargement du PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-700 font-medium">Chargement de la facture...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => router.push(`/dashboard/${uploadId}`)}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-4 font-medium"
            type="button"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour au dashboard
          </button>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">🧾 Aperçu facture (HTML)</h1>
              <p className="text-gray-700 mt-1">
                Client : <span className="font-semibold">{client?.name ?? clientId}</span>
                <span className="text-gray-500"> • ID: {clientId.slice(0, 8)}…</span>
              </p>
            </div>

            <button
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              type="button"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Télécharger le PDF
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-white border-2 border-red-200 rounded-xl p-5 shadow-lg mb-6">
            <div className="text-red-700 font-bold mb-1">Erreur</div>
            <div className="text-gray-900">{error}</div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 text-sm text-gray-700 font-medium">
            Rendu exact (HTML backend)
          </div>

          <div className="p-4 md:p-6">
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </main>
  );
}
