'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AlertCircle, CheckCircle, Save, Play, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';

interface InvalidAddress {
  id: string;
  client_name: string;
  original_number: string;
  original_street: string;
  original_postal_code: string;
  original_city: string;
  original_country: string;
  full_address: string;
  issues: string;
  delivery_date: string;
  warehouse: string;
}

interface CorrectionForm {
  number: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

export default function ValidatePage() {
  const router = useRouter();
  const params = useParams();
  const uploadId = (params as any)?.id as string;

  const [addresses, setAddresses] = useState<InvalidAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, CorrectionForm>>({});

  useEffect(() => {
    loadInvalidAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  const loadInvalidAddresses = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get(`/upload/${uploadId}/invalid-addresses`);
      const invalidAddresses: InvalidAddress[] = response.data.addresses ?? [];

      setAddresses(invalidAddresses);

      // Initialiser les formulaires de correction avec les valeurs originales
      const initialCorrections: Record<string, CorrectionForm> = {};
      invalidAddresses.forEach((addr) => {
        initialCorrections[addr.id] = {
          number: addr.original_number || '',
          street: addr.original_street || '',
          postalCode: addr.original_postal_code || '',
          city: addr.original_city || '',
          country: addr.original_country || '',
        };
      });
      setCorrections(initialCorrections);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur chargement des adresses');
    } finally {
      setLoading(false);
    }
  };

  const handleCorrectionChange = (
    addressId: string,
    field: keyof CorrectionForm,
    value: string,
  ) => {
    setCorrections((prev) => ({
      ...prev,
      [addressId]: {
        ...prev[addressId],
        [field]: value,
      },
    }));
  };

  const handleSaveCorrection = async (addressId: string) => {
    setSaving(addressId);
    setError(null);

    try {
      const correction = corrections[addressId];

      const response = await api.patch(
        `/upload/${uploadId}/fix-address/${addressId}`,
        correction,
      );

      if (response.data.success) {
        await loadInvalidAddresses();

        if (response.data.all_valid) {
          alert('✅ Toutes les adresses sont maintenant valides !');
        }
      } else {
        setError(response.data.message);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la correction');
    } finally {
      setSaving(null);
    }
  };

  const handleStartProcessing = async () => {
    if (addresses.length > 0) {
      alert('⚠️ Il reste des adresses invalides à corriger');
      return;
    }

    if (processing) {
      console.log('⚠️ Traitement déjà en cours, ignorer le clic');
      return;
    }

    setProcessing(true);
    router.push(`/process/${uploadId}`);
  };

  const parseIssues = (issuesStr: string): string[] => {
    try {
      return JSON.parse(issuesStr);
    } catch {
      return [];
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Chargement des adresses...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
            type="button"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>

          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Validation des adresses
          </h1>
          <p className="text-gray-600">
            {addresses.length > 0
              ? `${addresses.length} adresse(s) nécessitent une correction`
              : '✅ Toutes les adresses sont valides !'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Liste des adresses invalides */}
        {addresses.length > 0 ? (
          <div className="space-y-6">
            {addresses.map((addr) => {
              const issues = parseIssues(addr.issues);
              const correction = corrections[addr.id];

              return (
                <div key={addr.id} className="bg-white rounded-xl shadow-lg p-6">
                  {/* En-tête */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {addr.client_name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        Livraison du {addr.delivery_date}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {issues.map((issue, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-red-100 text-red-700 text-xs rounded-full"
                        >
                          {issue}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Adresse originale */}
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Adresse originale :
                    </p>
                    <p className="text-gray-600">{addr.full_address}</p>
                  </div>

                  {/* Formulaire de correction */}
                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Numéro
                      </label>
                      <input
                        type="text"
                        value={correction?.number || ''}
                        onChange={(e) =>
                          handleCorrectionChange(addr.id, 'number', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                        placeholder="Ex: 25"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Rue *
                      </label>
                      <input
                        type="text"
                        value={correction?.street || ''}
                        onChange={(e) =>
                          handleCorrectionChange(addr.id, 'street', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                        placeholder="Ex: Rue de Rivoli"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Code postal *
                      </label>
                      <input
                        type="text"
                        value={correction?.postalCode || ''}
                        onChange={(e) =>
                          handleCorrectionChange(addr.id, 'postalCode', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                        placeholder="Ex: 80000"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Ville *
                      </label>
                      <input
                        type="text"
                        value={correction?.city || ''}
                        onChange={(e) =>
                          handleCorrectionChange(addr.id, 'city', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                        placeholder="Ex: Amiens"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Pays
                      </label>
                      <input
                        type="text"
                        value={correction?.country || ''}
                        onChange={(e) =>
                          handleCorrectionChange(addr.id, 'country', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                        placeholder="Ex: France"
                      />
                    </div>
                  </div>

                  {/* Bouton sauvegarder */}
                  <button
                    onClick={() => handleSaveCorrection(addr.id)}
                    disabled={saving === addr.id}
                    className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors disabled:bg-gray-300"
                    type="button"
                  >
                    {saving === addr.id ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        Sauvegarde...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Valider la correction
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          // Toutes les adresses sont valides - UN SEUL BOUTON ICI
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Toutes les adresses sont valides !
            </h2>
            <p className="text-gray-600 mb-6">
              Vous pouvez maintenant lancer le traitement des livraisons
            </p>
            <button
              onClick={handleStartProcessing}
              disabled={processing}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center justify-center gap-3 mx-auto transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              type="button"
            >
              {processing ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  Lancement...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Lancer le traitement
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
