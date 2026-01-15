'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type Delivery = {
  id: string;
  client_id: string;
  client_name: string;
  destination_address: string;
  distance_km: number | null;
  status: string;
};

type Tier = {
  range_start: number;
  range_end: number | null;
  price: number;
  tva_rate: number;
};

function sortTiers(tiers: Tier[]) {
  return [...tiers].sort((a, b) => a.range_start - b.range_start);
}

/**
 * ✅ Parse "fr" decimal input:
 * - accepte "3,5" et "3.5"
 * - ignore espaces
 * - refuse NaN
 */
function parseFrNumber(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * ✅ Format display in French style (comma)
 * - max 2 decimals (sans forcer)
 */
function formatFrNumber(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  const rounded = Math.round(v * 100) / 100;
  const s = String(rounded);
  return s.replace('.', ',');
}

function validateTiers(tiers: Tier[]) {
  const errors: string[] = [];
  const t = sortTiers(tiers);

  if (t.length === 0) errors.push('Ajoute au moins une tranche.');

  t.forEach((r, i) => {
    if (!Number.isFinite(r.range_start) || r.range_start < 0) {
      errors.push(`Tranche #${i + 1}: début (km) invalide.`);
    }
    if (
      r.range_end !== null &&
      (!Number.isFinite(r.range_end) || r.range_end <= r.range_start)
    ) {
      errors.push(`Tranche #${i + 1}: fin (km) doit être > début.`);
    }
    if (!Number.isFinite(r.price) || r.price < 0) {
      errors.push(`Tranche #${i + 1}: prix HT invalide.`);
    }
    if (!Number.isFinite(r.tva_rate) || r.tva_rate < 0) {
      errors.push(`Tranche #${i + 1}: TVA invalide.`);
    }
  });

  for (let i = 1; i < t.length; i++) {
    const prev = t[i - 1];
    const cur = t[i];
    if (prev.range_end === null) {
      errors.push('La tranche "et +" doit être la dernière.');
      break;
    }
    if (cur.range_start < prev.range_end) {
      errors.push(`Chevauchement: tranche #${i} et #${i + 1}.`);
    }
  }

  if (t.length > 0 && t[0].range_start !== 0) {
    errors.push(
      'Recommandé: commencer à 0 km (sinon certaines livraisons peuvent ne pas être tarifées).',
    );
  }

  return { ok: errors.length === 0, errors, sorted: t };
}

function computePrice(distanceKm: number, tiers: Tier[]) {
  const t = sortTiers(tiers);
  for (const r of t) {
    const endOk = r.range_end === null || distanceKm < r.range_end; // end exclusif (cohérent avec ton UI)
    if (distanceKm >= r.range_start && endOk) {
      const ht = r.price;
      const tva = (ht * r.tva_rate) / 100;
      const ttc = ht + tva;
      return {
        ht: Math.round(ht * 100) / 100,
        ttc: Math.round(ttc * 100) / 100,
        tva: Math.round(tva * 100) / 100,
        applied: r,
      };
    }
  }
  return null;
}

function formatKm(v: number | null) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(2)} km`;
}

export default function PricingPage() {
  const params = useParams();
  const router = useRouter();
  const uploadId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [tiers, setTiers] = useState<Tier[]>([
    { range_start: 0, range_end: 5, price: 8, tva_rate: 20 },
    { range_start: 5, range_end: 10, price: 10, tva_rate: 20 },
    { range_start: 10, range_end: null, price: 12, tva_rate: 20 },
  ]);

  // ✅ inputs texte pour accepter la virgule
  const [tierInputs, setTierInputs] = useState<
    Array<{
      start: string;
      end: string; // vide => null
      price: string;
      tva: string;
    }>
  >([]);

  const [openClients, setOpenClients] = useState<Record<string, boolean>>({});

  // ✅ clé localStorage pour réutilisation sur dashboard (fallback UX)
  const pricingStorageKey = useMemo(() => `kilomate_pricing_${uploadId}`, [uploadId]);

  // sync inputs quand tiers change (ex: ajout/suppression)
  useEffect(() => {
    setTierInputs(
      sortTiers(tiers).map((t) => ({
        start: formatFrNumber(t.range_start),
        end: t.range_end == null ? '' : formatFrNumber(t.range_end),
        price: String(t.price ?? 0).replace('.', ','),
        tva: String(t.tva_rate ?? 0).replace('.', ','),
      })),
    );
  }, [tiers.length]); // volontaire: uniquement sur ajout/suppression

  useEffect(() => {
    const fetchDeliveries = async () => {
      try {
        setErrorMsg(null);

        const res = await api.get(`/upload/${uploadId}/deliveries`);
        const list: Delivery[] = res.data?.deliveries ?? [];
        setDeliveries(list);

        const grouped = new Map<string, number>();
        for (const d of list) {
          const key = d.client_name || 'Client inconnu';
          grouped.set(key, (grouped.get(key) ?? 0) + 1);
        }

        const initialOpen: Record<string, boolean> = {};
        for (const [k, count] of grouped.entries()) {
          initialOpen[k] = count > 1;
        }
        setOpenClients(initialOpen);

        // ✅ optionnel: si une grille existe déjà en localStorage, on peut préremplir
        try {
          const raw = localStorage.getItem(pricingStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) {
              const maybe = parsed
                .map((x: any) => ({
                  range_start: Number(x.range_start),
                  range_end: x.range_end === null ? null : Number(x.range_end),
                  price: Number(x.price),
                  tva_rate: x.tva_rate == null ? 20 : Number(x.tva_rate),
                }))
                .filter((x: any) => Number.isFinite(x.range_start) && Number.isFinite(x.price));
              if (maybe.length) setTiers(sortTiers(maybe));
            }
          }
        } catch {}
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.response?.data?.message || 'Impossible de charger les livraisons.');
      } finally {
        setLoading(false);
      }
    };
    fetchDeliveries();
  }, [uploadId, pricingStorageKey]);

  const { errors, sorted } = useMemo(() => validateTiers(tiers), [tiers]);

  const deliveriesByClient = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of deliveries) {
      const key = d.client_name || 'Client inconnu';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }

    const result = Array.from(map.entries()).map(([client, list]) => {
      const sortedList = [...list].sort((a, b) => {
        const da = a.distance_km ?? Number.POSITIVE_INFINITY;
        const db = b.distance_km ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return (a.destination_address ?? '').localeCompare(b.destination_address ?? '');
      });
      return { client, deliveries: sortedList };
    });

    result.sort((a, b) => a.client.localeCompare(b.client));
    return result;
  }, [deliveries]);

  const preview = useMemo(() => {
    const byClient = new Map<
      string,
      { ht: number; ttc: number; count: number; missing: number; km: number }
    >();

    for (const d of deliveries) {
      const client = d.client_name || 'Client inconnu';
      if (!byClient.has(client)) byClient.set(client, { ht: 0, ttc: 0, count: 0, missing: 0, km: 0 });
      const row = byClient.get(client)!;

      if (d.distance_km == null) {
        row.missing += 1;
        continue;
      }

      row.km += Number(d.distance_km);
      const p = computePrice(Number(d.distance_km), tiers);

      if (!p) {
        row.missing += 1;
        continue;
      }

      row.ht += p.ht;
      row.ttc += p.ttc;
      row.count += 1;
    }

    const clients = Array.from(byClient.entries()).map(([client, v]) => ({
      client,
      ht: Math.round(v.ht * 100) / 100,
      ttc: Math.round(v.ttc * 100) / 100,
      km: Math.round(v.km * 100) / 100,
      count: v.count,
      missing: v.missing,
    }));

    const totalKm = clients.reduce((s, c) => s + c.km, 0);
    const totalHT = clients.reduce((s, c) => s + c.ht, 0);
    const totalTTC = clients.reduce((s, c) => s + c.ttc, 0);

    return {
      clients,
      totals: {
        km: Math.round(totalKm * 100) / 100,
        ht: Math.round(totalHT * 100) / 100,
        ttc: Math.round(totalTTC * 100) / 100,
      },
    };
  }, [deliveries, tiers]);

  const addTier = () => {
    const s = sortTiers(tiers);
    const last = s[s.length - 1];
    const start = last?.range_end ?? (last ? last.range_start + 5 : 0);
    setTiers([...tiers, { range_start: start || 0, range_end: null, price: 0, tva_rate: 20 }]);
  };

  const removeTier = (idx: number) => setTiers(tiers.filter((_, i) => i !== idx));

  const updateTier = (idx: number, patch: Partial<Tier>) => {
    setTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const toggleClient = (clientName: string) => {
    setOpenClients((prev) => ({ ...prev, [clientName]: !prev[clientName] }));
  };

  /**
   * ✅ IMPORTANT :
   * On n'utilise PLUS /upload/:id/pricing-config ni /upload/:id/apply-pricing
   * On utilise les routes backend standards:
   * - POST /pricing/:uploadId/apply  (écrit pricing_config + recalc deliveries)
   * - dashboard lit ensuite GET /pricing/:uploadId/config
   */
  const handleSaveAndApply = async () => {
    setErrorMsg(null);

    const hardErrors = errors.filter((e) => !e.startsWith('Recommandé:'));
    if (hardErrors.length > 0) {
      setErrorMsg('Corrige la tarification :\n' + hardErrors.join('\n'));
      return;
    }

    try {
      setSaving(true);

      // ✅ 1) Sauvegarde locale (UX fallback)
      try {
        localStorage.setItem(pricingStorageKey, JSON.stringify(sorted));
      } catch {}

      // ✅ 2) Enregistre + applique côté backend (source de vérité DB)
      console.log('💰 Application pricing via /pricing/:uploadId/apply ...');

      const res = await api.post(`/pricing/${encodeURIComponent(uploadId)}/apply`, {
        pricing: sorted.map((t) => ({
          range_start: t.range_start,
          range_end: t.range_end,
          price: t.price,       // ✅ DB field
          tva_rate: t.tva_rate,
        })),
      });

      console.log('✅ Tarification appliquée:', res.data);

      // ✅ 3) Go dashboard
      router.push(`/dashboard/${uploadId}`);
    } catch (e: any) {
      console.error('❌ Erreur:', e);
      setErrorMsg(
        e?.response?.data?.message || e?.message || "Erreur lors de l'enregistrement de la tarification.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-gray-700">Chargement…</div>
      </div>
    );
  }

  const sortedForUI = sortTiers(tiers);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tarification par tranches</h1>
            <p className="text-gray-600">
              Définis tes intervalles de distance (km). Les prix seront calculés et enregistrés en base de données.
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-lg bg-white border hover:bg-gray-50"
          >
            Retour
          </button>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 whitespace-pre-line border border-red-200">
            {errorMsg}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Editor */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Tranches</h2>
              <button
                onClick={addTier}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                Ajouter
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {sortedForUI.map((t, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
                  <div className="col-span-3">
                    <label className="block text-xs text-gray-600">Début (km)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="ex: 2,5"
                      value={tierInputs[idx]?.start ?? formatFrNumber(t.range_start)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setTierInputs((prev) => {
                          const next = [...prev];
                          next[idx] = { ...(next[idx] ?? { start: '', end: '', price: '', tva: '' }), start: raw };
                          return next;
                        });

                        const n = parseFrNumber(raw);
                        if (n != null) updateTier(idx, { range_start: n });
                      }}
                      className="w-full border rounded px-2 py-1"
                    />
                  </div>

                  <div className="col-span-3">
                    <label className="block text-xs text-gray-600">Fin (km)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="(vide = et +)"
                      value={tierInputs[idx]?.end ?? (t.range_end == null ? '' : formatFrNumber(t.range_end))}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setTierInputs((prev) => {
                          const next = [...prev];
                          next[idx] = { ...(next[idx] ?? { start: '', end: '', price: '', tva: '' }), end: raw };
                          return next;
                        });

                        const trimmed = raw.trim();
                        if (trimmed === '') {
                          updateTier(idx, { range_end: null });
                          return;
                        }

                        const n = parseFrNumber(trimmed);
                        if (n != null) updateTier(idx, { range_end: n });
                      }}
                      className="w-full border rounded px-2 py-1"
                    />
                  </div>

                  <div className="col-span-3">
                    <label className="block text-xs text-gray-600">Prix HT (€)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="ex: 8,50"
                      value={tierInputs[idx]?.price ?? String(t.price ?? 0).replace('.', ',')}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setTierInputs((prev) => {
                          const next = [...prev];
                          next[idx] = { ...(next[idx] ?? { start: '', end: '', price: '', tva: '' }), price: raw };
                          return next;
                        });

                        const n = parseFrNumber(raw);
                        if (n != null) updateTier(idx, { price: n });
                      }}
                      className="w-full border rounded px-2 py-1"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs text-gray-600">TVA (%)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="ex: 20"
                      value={tierInputs[idx]?.tva ?? String(t.tva_rate ?? 0).replace('.', ',')}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setTierInputs((prev) => {
                          const next = [...prev];
                          next[idx] = { ...(next[idx] ?? { start: '', end: '', price: '', tva: '' }), tva: raw };
                          return next;
                        });

                        const n = parseFrNumber(raw);
                        if (n != null) updateTier(idx, { tva_rate: n });
                      }}
                      className="w-full border rounded px-2 py-1"
                    />
                  </div>

                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => removeTier(idx)}
                      className="p-2 rounded hover:bg-gray-100"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              {errors.length === 0 ? (
                <div className="flex items-center gap-2 text-green-700 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  Tranches valides
                </div>
              ) : (
                <div className="flex items-start gap-2 text-amber-700 text-sm">
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  <div className="whitespace-pre-line">{errors.join('\n')}</div>
                </div>
              )}
            </div>

            <button
              onClick={handleSaveAndApply}
              disabled={saving}
              className="mt-5 w-full px-4 py-3 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-60"
            >
              {saving ? 'Enregistrement et calcul en cours…' : 'Enregistrer et calculer les totaux'}
            </button>

            {/* Totaux globaux preview */}
            <div className="mt-5 border rounded-xl p-4 bg-gray-50">
              <div className="text-sm font-semibold text-gray-900">Totaux (aperçu)</div>
              <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-gray-500">Distance</div>
                  <div className="font-semibold">{preview.totals.km.toFixed(2)} km</div>
                </div>
                <div>
                  <div className="text-gray-500">Total HT</div>
                  <div className="font-semibold">{preview.totals.ht.toFixed(2)} €</div>
                </div>
                <div>
                  <div className="text-gray-500">Total TTC</div>
                  <div className="font-semibold">{preview.totals.ttc.toFixed(2)} €</div>
                </div>
              </div>
            </div>
          </div>

          {/* Preview by client */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="font-semibold text-gray-900">Aperçu par client</h2>
            <p className="text-gray-600 text-sm mt-1">Aperçu des montants qui seront enregistrés en base de données.</p>

            <div className="mt-4 space-y-3">
              {preview.clients.map((p) => (
                <div key={p.client} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gray-900">{p.client}</div>
                    <div className="text-sm text-gray-600">{p.count} course(s)</div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                    <div>
                      <div className="text-gray-500">Distance</div>
                      <div className="font-semibold">{p.km.toFixed(2)} km</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total HT</div>
                      <div className="font-semibold">{p.ht.toFixed(2)} €</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total TTC</div>
                      <div className="font-semibold">{p.ttc.toFixed(2)} €</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Non tarifées</div>
                      <div className={`font-semibold ${p.missing ? 'text-amber-700' : ''}`}>{p.missing}</div>
                    </div>
                  </div>
                </div>
              ))}
              {preview.clients.length === 0 && <div className="text-gray-600 text-sm">Aucune livraison trouvée.</div>}
            </div>
          </div>
        </div>

        {/* Détail des courses */}
        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Détail des courses (distances)</h2>
            <div className="text-sm text-gray-600">{deliveries.length} course(s)</div>
          </div>

          <div className="mt-4 space-y-3">
            {deliveriesByClient.map(({ client, deliveries }) => {
              const isOpen = !!openClients[client];
              const clientKm = deliveries.reduce((s, d) => s + Number(d.distance_km ?? 0), 0);
              const pricedCount = deliveries.filter(
                (d) => d.distance_km != null && computePrice(Number(d.distance_km), tiers),
              ).length;

              return (
                <div key={client} className="border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleClient(client)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100"
                  >
                    <div className="text-left">
                      <div className="font-semibold text-gray-900">{client}</div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        {deliveries.length} course(s) • {Math.round(clientKm * 100) / 100} km • {pricedCount}/
                        {deliveries.length} tarifée(s)
                      </div>
                    </div>
                    <div className="text-gray-700">
                      {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="p-4 bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="text-left text-xs font-semibold text-gray-700 px-3 py-2">Adresse</th>
                              <th className="text-right text-xs font-semibold text-gray-700 px-3 py-2">Distance</th>
                              <th className="text-right text-xs font-semibold text-gray-700 px-3 py-2">Prix HT</th>
                              <th className="text-right text-xs font-semibold text-gray-700 px-3 py-2">Prix TTC</th>
                              <th className="text-center text-xs font-semibold text-gray-700 px-3 py-2">Statut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {deliveries.map((d) => {
                              const price =
                                d.distance_km == null ? null : computePrice(Number(d.distance_km), tiers);

                              return (
                                <tr key={d.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-sm text-gray-900">
                                    {d.destination_address || '—'}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">
                                    {formatKm(d.distance_km)}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">
                                    {price ? `${price.ht.toFixed(2)} €` : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">
                                    {price ? `${price.ttc.toFixed(2)} €` : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-center">
                                    <span className="inline-flex px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                                      {d.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {deliveriesByClient.length === 0 && <div className="text-gray-600 text-sm">Aucune course à afficher.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
