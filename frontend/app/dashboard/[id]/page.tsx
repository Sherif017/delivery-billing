'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Users,
  Route,
  Euro,
  AlertCircle,
  FileBadge,
  RefreshCcw,
} from 'lucide-react';
import api from '@/lib/api';

type ClientOverview = {
  id: string;
  name: string;
  deliveriesCount: number;
  totalDistance: number;
  totalHT: number;
  totalTTC: number;
  nonPriced: number;
};

type PricingTier = {
  range_start: number;
  range_end: number | null;
  price: number; // ✅ DB = price
  tva_rate: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const params = useParams();

  const uploadId = useMemo(() => {
    const raw = (params as any)?.id;
    if (Array.isArray(raw)) return raw[0] ?? '';
    return raw ?? '';
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientOverview[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [downloadingGlobal, setDownloadingGlobal] = useState(false);

  // ✅ pricing config affichée dans dashboard
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricing, setPricing] = useState<PricingTier[]>([]);
  const [pricingError, setPricingError] = useState<string | null>(null);

  // ✅ Champs “Entreprise” + “Client global” (persistés)
  const storageCompany = useMemo(() => `kilomate_company_name`, []);
  const storageGlobalClient = useMemo(() => `kilomate_global_client_name`, []);

  // ✅ Champs facture globale (persistés)
  const storageCompanyAddress = useMemo(() => `kilomate_company_address`, []);
  const storageInvoiceDate = useMemo(() => `kilomate_invoice_date`, []);
  const storagePaymentMethod = useMemo(() => `kilomate_payment_method`, []);
  const storagePaymentDueDate = useMemo(() => `kilomate_payment_due_date`, []);
  const storageServiceDate = useMemo(() => `kilomate_service_date`, []);
  const storageClientAddress = useMemo(() => `kilomate_client_address`, []);
  const storageRibIban = useMemo(() => `kilomate_rib_iban`, []);
  const storageBic = useMemo(() => `kilomate_bic`, []);
  const storageCompanySiren = useMemo(() => `kilomate_company_siren`, []);
  const storageCompanyVat = useMemo(() => `kilomate_company_vat`, []);

  const [companyName, setCompanyName] = useState('');
  const [globalClientName, setGlobalClientName] = useState('');

  const [companyAddress, setCompanyAddress] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentDueDate, setPaymentDueDate] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [ribIban, setRibIban] = useState('');
  const [bic, setBic] = useState('');
  const [companySiren, setCompanySiren] = useState('');
  const [companyVat, setCompanyVat] = useState('');

  useEffect(() => {
    try {
      const c = localStorage.getItem(storageCompany);
      if (c) setCompanyName(c);

      const g = localStorage.getItem(storageGlobalClient);
      if (g) setGlobalClientName(g);

      const ca = localStorage.getItem(storageCompanyAddress);
      if (ca) setCompanyAddress(ca);

      const id = localStorage.getItem(storageInvoiceDate);
      if (id) setInvoiceDate(id);

      const pm = localStorage.getItem(storagePaymentMethod);
      if (pm) setPaymentMethod(pm);

      const pdd = localStorage.getItem(storagePaymentDueDate);
      if (pdd) setPaymentDueDate(pdd);

      const sd = localStorage.getItem(storageServiceDate);
      if (sd) setServiceDate(sd);

      const clA = localStorage.getItem(storageClientAddress);
      if (clA) setClientAddress(clA);

      const rib = localStorage.getItem(storageRibIban);
      if (rib) setRibIban(rib);

      const b = localStorage.getItem(storageBic);
      if (b) setBic(b);

      const s = localStorage.getItem(storageCompanySiren);
      if (s) setCompanySiren(s);

      const v = localStorage.getItem(storageCompanyVat);
      if (v) setCompanyVat(v);
    } catch {}
  }, [
    storageCompany,
    storageGlobalClient,
    storageCompanyAddress,
    storageInvoiceDate,
    storagePaymentMethod,
    storagePaymentDueDate,
    storageServiceDate,
    storageClientAddress,
    storageRibIban,
    storageBic,
    storageCompanySiren,
    storageCompanyVat,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(storageCompany, companyName);
    } catch {}
  }, [companyName, storageCompany]);
  useEffect(() => {
    try {
      localStorage.setItem(storageGlobalClient, globalClientName);
    } catch {}
  }, [globalClientName, storageGlobalClient]);
  useEffect(() => {
    try {
      localStorage.setItem(storageCompanyAddress, companyAddress);
    } catch {}
  }, [companyAddress, storageCompanyAddress]);
  useEffect(() => {
    try {
      localStorage.setItem(storageInvoiceDate, invoiceDate);
    } catch {}
  }, [invoiceDate, storageInvoiceDate]);
  useEffect(() => {
    try {
      localStorage.setItem(storagePaymentMethod, paymentMethod);
    } catch {}
  }, [paymentMethod, storagePaymentMethod]);
  useEffect(() => {
    try {
      localStorage.setItem(storagePaymentDueDate, paymentDueDate);
    } catch {}
  }, [paymentDueDate, storagePaymentDueDate]);
  useEffect(() => {
    try {
      localStorage.setItem(storageServiceDate, serviceDate);
    } catch {}
  }, [serviceDate, storageServiceDate]);
  useEffect(() => {
    try {
      localStorage.setItem(storageClientAddress, clientAddress);
    } catch {}
  }, [clientAddress, storageClientAddress]);
  useEffect(() => {
    try {
      localStorage.setItem(storageRibIban, ribIban);
    } catch {}
  }, [ribIban, storageRibIban]);
  useEffect(() => {
    try {
      localStorage.setItem(storageBic, bic);
    } catch {}
  }, [bic, storageBic]);
  useEffect(() => {
    try {
      localStorage.setItem(storageCompanySiren, companySiren);
    } catch {}
  }, [companySiren, storageCompanySiren]);
  useEffect(() => {
    try {
      localStorage.setItem(storageCompanyVat, companyVat);
    } catch {}
  }, [companyVat, storageCompanyVat]);

  const isCompanyValid = companyName.trim().length >= 2;
  const isGlobalClientValid = globalClientName.trim().length >= 2;

  // ✅ inputs libres => validation légère
  const isInvoiceDateValid = invoiceDate.trim().length >= 8;
  const isServiceDateValid = serviceDate.trim().length >= 8;
  const isPaymentDueDateValid = paymentDueDate.trim().length >= 8;

  // ✅ Charge clients dashboard (uniquement pour les stats)
  useEffect(() => {
    const load = async () => {
      if (!uploadId) return;

      setLoading(true);
      setError(null);

      try {
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

  // ✅ refresh pricing (réutilisable + bouton)
  const refreshPricing = useCallback(async () => {
    if (!uploadId) return;

    setPricingLoading(true);
    setPricingError(null);

    try {
      const res = await api.get(`/pricing/${encodeURIComponent(uploadId)}/config`);
      const rows = (res.data?.pricing ?? []) as any[];

      setPricing(
        rows.map((r) => ({
          range_start: Number(r.range_start),
          range_end: r.range_end === null ? null : Number(r.range_end),
          price: Number(r.price),
          tva_rate: r.tva_rate == null ? 20 : Number(r.tva_rate),
        })),
      );
    } catch (e: any) {
      setPricingError(e?.response?.data?.message || e?.message || 'Erreur chargement pricing');
      setPricing([]);
    } finally {
      setPricingLoading(false);
    }
  }, [uploadId]);

  useEffect(() => {
    refreshPricing();
  }, [refreshPricing]);

  const totals = useMemo(() => {
    const sum = (arr: ClientOverview[], key: keyof ClientOverview) =>
      arr.reduce((a, c) => a + Number(c[key] ?? 0), 0);

    const deliveriesCount = sum(clients, 'deliveriesCount');
    const totalDistance = sum(clients, 'totalDistance');
    const totalHT = sum(clients, 'totalHT');
    const totalTTC = sum(clients, 'totalTTC');
    const nonPriced = sum(clients, 'nonPriced');

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      clientsCount: clients.length,
      deliveriesCount,
      totalDistance: round2(totalDistance),
      totalHT: round2(totalHT),
      totalTTC: round2(totalTTC),
      nonPriced,
    };
  }, [clients]);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number(n || 0),
    );

  const fmtKm = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number(n || 0),
    );

  const fmtKm0_2 = (n: number) =>
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n || 0));

  const formatRangeLabel = (start: number, end: number | null) => {
    if (end === null) return `${fmtKm0_2(start)}+ km`;
    return `${fmtKm0_2(start)}-${fmtKm0_2(end)} km`;
  };

  const downloadGlobalInvoicePdf = async () => {
    if (!uploadId) return;
    if (!isCompanyValid) return alert("Merci d'indiquer le nom de votre entreprise avant de télécharger.");
    if (!isGlobalClientValid) return alert("Merci d'indiquer le nom du client global (destinataire).");
    if (!isInvoiceDateValid) return alert('Merci de renseigner la date de la facture (date complète).');
    if (!isPaymentDueDateValid) return alert('Merci de renseigner la date de paiement dû (date complète).');
    if (!isServiceDateValid) return alert('Merci de renseigner la date de la prestation (date complète).');

    setDownloadingGlobal(true);
    try {
      const res = await api.post(
        `/invoice/${encodeURIComponent(uploadId)}/global`,
        {
          company_name: companyName.trim(),
          global_client_name: globalClientName.trim(),
          company_address: companyAddress.trim(),
          invoice_date: invoiceDate.trim(),
          payment_method: paymentMethod.trim(),
          payment_due_date: paymentDueDate.trim(),
          service_date: serviceDate.trim(),
          client_address: clientAddress.trim(),
          rib_iban: ribIban.trim(),
          bic: bic.trim(),
          company_siren: companySiren.trim(),
          company_vat: companyVat.trim(),
        },
        { responseType: 'blob' },
      );

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `facture_globale_${uploadId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Erreur facture globale:', e);
      alert(e?.response?.data?.message || 'Erreur lors du téléchargement de la facture globale');
    } finally {
      setDownloadingGlobal(false);
    }
  };

  if (!uploadId) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg border p-6">
          <div className="flex items-center gap-2 text-red-700 font-semibold">
            <AlertCircle className="w-5 h-5" />
            Upload ID manquant dans l’URL.
          </div>
          <div className="text-gray-600 mt-2">
            Vérifie la route : <span className="font-mono">/dashboard/[id]</span>
          </div>
          <button
            onClick={() => router.push('/')}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
            type="button"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
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

          <div className="bg-white rounded-2xl shadow-lg border p-4 w-full lg:w-[620px]">
            <div className="font-semibold text-gray-900 mb-3">Facture globale</div>

            <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Nom de votre entreprise (émetteur)
                </label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ex: ACME LOGISTICS"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
                <p className="text-xs text-slate-500 mt-1">Utilisé pour la facture globale (PDF).</p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-800 mb-1">Adresse de votre entreprise</label>
                <input
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="ex: 142 Rue de Clignancourt, 75018 Paris"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Nom du client global (destinataire)
                </label>
                <input
                  value={globalClientName}
                  onChange={(e) => setGlobalClientName(e.target.value)}
                  placeholder="ex: CLIENT GLOBAL SA"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-800 mb-1">Adresse du client (destinataire)</label>
                <input
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="ex: 25 L Aiguillon, 80000 Amiens"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              {/* ✅ inputs libres (pas de calendrier) */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Date de la facture</label>
                <input
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  placeholder="ex: 02/10/2022"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Paiement dû</label>
                <input
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                  placeholder="ex: 15/10/2022"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Date de la prestation</label>
                <input
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  placeholder="ex: 01/10/2022"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">Modalité de paiement</label>
                <input
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="ex: Virement"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">N° SIREN</label>
                <input
                  value={companySiren}
                  onChange={(e) => setCompanySiren(e.target.value)}
                  placeholder="ex: 824224539"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">N° TVA</label>
                <input
                  value={companyVat}
                  onChange={(e) => setCompanyVat(e.target.value)}
                  placeholder="ex: FR69824224539"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-800 mb-1">RIB / IBAN</label>
                <input
                  value={ribIban}
                  onChange={(e) => setRibIban(e.target.value)}
                  placeholder="ex: FR76 1820 6001 2365 1077 7789 422"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">BIC</label>
                <input
                  value={bic}
                  onChange={(e) => setBic(e.target.value)}
                  placeholder="ex: AGRIFRPP882"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-slate-900 bg-white"
                />
              </div>

              <button
                onClick={downloadGlobalInvoicePdf}
                disabled={
                  downloadingGlobal ||
                  !isCompanyValid ||
                  !isGlobalClientValid ||
                  !isInvoiceDateValid ||
                  !isPaymentDueDateValid ||
                  !isServiceDateValid
                }
                className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
              >
                {downloadingGlobal ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Génération…
                  </>
                ) : (
                  <>
                    <FileBadge className="w-4 h-4" />
                    Facture globale (PDF)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <div className="grid md:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Clients"
            value={loading ? '—' : `${totals.clientsCount}`}
            sub={loading ? 'Chargement…' : `${clients.length} au total`}
          />
          <StatCard
            icon={<Route className="w-5 h-5" />}
            label="Distance"
            value={loading ? '—' : `${fmtKm(totals.totalDistance)} km`}
            sub={loading ? 'Chargement…' : `${totals.deliveriesCount} courses`}
          />
          <StatCard icon={<Euro className="w-5 h-5" />} label="Total HT" value={loading ? '—' : `${fmtMoney(totals.totalHT)} €`} sub="Somme des clients" />
          <StatCard icon={<Euro className="w-5 h-5" />} label="Total TTC" value={loading ? '—' : `${fmtMoney(totals.totalTTC)} €`} sub="Somme des clients" />
          <StatCard icon={<AlertCircle className="w-5 h-5" />} label="Non tarifées" value={loading ? '—' : `${totals.nonPriced}`} sub="Courses sans prix" />
        </div>

        {/* ✅ INTERVALLES DE TARIFICATION */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-bold text-gray-900">Intervalles de tarification</div>
              <div className="text-gray-600 mt-1">Affiche la grille réellement utilisée pour calculer les prix et la facture globale.</div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-gray-600 font-semibold">{pricingLoading ? '…' : `${pricing.length} tranche(s)`}</div>

              <button
                onClick={refreshPricing}
                disabled={pricingLoading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
                title="Rafraîchir la grille"
              >
                {pricingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                Rafraîchir
              </button>
            </div>
          </div>

          {pricingError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{pricingError}</div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-3 font-semibold text-gray-700">Intervalle</th>
                  <th className="text-right p-3 font-semibold text-gray-700">PU HT</th>
                  <th className="text-right p-3 font-semibold text-gray-700">TVA</th>
                  <th className="text-right p-3 font-semibold text-gray-700">PU TTC</th>
                </tr>
              </thead>
              <tbody>
                {pricingLoading ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-gray-600">
                      <Loader2 className="inline w-4 h-4 animate-spin mr-2" />
                      Chargement de la grille…
                    </td>
                  </tr>
                ) : pricing.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-gray-600">
                      Aucune grille trouvée pour cet upload. Va sur “Tarification” puis “Enregistrer et calculer”.
                    </td>
                  </tr>
                ) : (
                  pricing.map((t, idx) => {
                    const tvaAmount = (t.price * (t.tva_rate ?? 20)) / 100;
                    const ttc = t.price + tvaAmount;
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-3 font-semibold text-gray-900">{formatRangeLabel(t.range_start, t.range_end)}</td>
                        <td className="p-3 text-right">{fmtMoney(t.price)} €</td>
                        <td className="p-3 text-right">{fmtMoney(tvaAmount)} €</td>
                        <td className="p-3 text-right">{fmtMoney(ttc)} €</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ✅ SUPPRIMÉ : Recherche + liste des factures par client + boutons Voir/PDF */}
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
