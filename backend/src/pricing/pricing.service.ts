import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface PriceCalculation {
  price_ht: number;
  price_ttc: number;
  tva_amount: number;
  tva_rate: number;
  applied_range: string;
}

type PricingRow = Record<string, any>;

type PricingInputRow = {
  range_start: number | string;
  range_end: number | string | null;
  price_ht: number | string;
  tva_rate: number | string;
};

type DeliveryDbRow = {
  id: string;
  upload_id: string;
  client_id: string;
  distance_km: number | null;
};

type DeliveryUpdate = {
  id: string;
  price_ht: number;
  price_ttc: number;
  tva_amount: number;
  tva_rate: number;
  applied_range: string | null;
};

@Injectable()
export class PricingService {
  constructor(private databaseService: DatabaseService) {}

  private round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private toNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  private extractPriceHT(row: PricingRow): number | null {
    const candidates = [
      row.price,
      row.price_ht,
      row.amount,
      row.amount_ht,
      row.montant,
      row.montant_ht,
      row.ht,
    ];

    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return null;
  }

  private extractRangeStart(row: PricingRow): number | null {
    const candidates = [row.range_start, row.start, row.km_start, row.from_km];
    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return null;
  }

  private extractRangeEnd(row: PricingRow): number | null {
    const candidates = [row.range_end, row.end, row.km_end, row.to_km];
    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return null;
  }

  private extractTvaRate(row: PricingRow): number {
    const candidates = [row.tva_rate, row.vat_rate, row.tva, row.vat];
    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return 0;
  }

  async calculatePrice(distanceKm: number, pricingConfig?: PricingRow[]): Promise<PriceCalculation> {
    const dist = this.toNumber(distanceKm);
    if (dist === null || dist < 0) throw new Error(`Distance invalide: ${distanceKm}`);

    const config = pricingConfig ?? ((await this.databaseService.getPricingConfig()) as PricingRow[]);

    if (!Array.isArray(config) || config.length === 0) {
      throw new Error('Aucune grille tarifaire trouvée (pricing_config vide).');
    }

    const normalized = config
      .map((row) => {
        const start = this.extractRangeStart(row);
        const end = this.extractRangeEnd(row);
        const priceHT = this.extractPriceHT(row);
        const tvaRate = this.extractTvaRate(row);
        return { start, end, priceHT, tvaRate };
      })
      .filter((x) => x.start !== null && x.priceHT !== null)
      .sort((a, b) => (a.start as number) - (b.start as number));

    if (normalized.length === 0) {
      throw new Error(
        "Grille tarifaire invalide: colonnes inattendues (range_start / price_ht introuvables).",
      );
    }

    let applied: (typeof normalized)[number] | null = null;
    let appliedRange = '';

    for (const cfg of normalized) {
      const start = cfg.start as number;
      const end = cfg.end;

      if (end === null) {
        if (dist >= start) {
          applied = cfg;
          appliedRange = `${start}+ km`;
          break;
        }
      } else {
        if (dist >= start && dist <= end) {
          applied = cfg;
          appliedRange = `${start}-${end} km`;
          break;
        }
      }
    }

    if (!applied) {
      const first = normalized[0];
      applied = first;
      appliedRange = `${first.start}-${first.end ?? `${first.start}+`} km`;
    }

    const priceHT = applied.priceHT as number;
    const tvaRate = applied.tvaRate ?? 0;
    const tvaAmount = (priceHT * tvaRate) / 100;
    const priceTTC = priceHT + tvaAmount;

    return {
      price_ht: this.round2(priceHT),
      price_ttc: this.round2(priceTTC),
      tva_amount: this.round2(tvaAmount),
      tva_rate: this.round2(tvaRate),
      applied_range: appliedRange,
    };
  }

  async applyPricingToUpload(uploadId: string, pricing: PricingInputRow[]) {
    const supa = this.databaseService.getClient();

    const normalizedPricing = pricing
      .map((p) => {
        const range_start = this.toNumber(p.range_start);
        const range_end = p.range_end === null || p.range_end === '' ? null : this.toNumber(p.range_end);
        const price_ht = this.toNumber(p.price_ht);
        const tva_rate = this.toNumber(p.tva_rate) ?? 0;

        if (range_start === null || range_start < 0) return null;
        if (price_ht === null || price_ht < 0) return null;

        return { upload_id: uploadId, range_start, range_end, price_ht, tva_rate };
      })
      .filter(Boolean) as Array<{
      upload_id: string;
      range_start: number;
      range_end: number | null;
      price_ht: number;
      tva_rate: number;
    }>;

    if (normalizedPricing.length === 0) {
      throw new BadRequestException('Grille invalide: aucune tranche exploitable.');
    }

    const delCfg = await supa.from('pricing_config').delete().eq('upload_id', uploadId);
    if (delCfg.error) throw new Error(`Erreur delete pricing_config: ${delCfg.error.message}`);

    const insCfg = await supa.from('pricing_config').insert(normalizedPricing);
    if (insCfg.error) throw new Error(`Erreur insert pricing_config: ${insCfg.error.message}`);

    const { data: deliveries, error: dErr } = await supa
      .from('deliveries')
      .select('id, upload_id, client_id, distance_km')
      .eq('upload_id', uploadId);

    if (dErr) throw new Error(`Erreur lecture deliveries: ${dErr.message}`);

    const list = (deliveries ?? []) as DeliveryDbRow[];

    if (list.length === 0) {
      await this.updateUploadTotals(uploadId);
      return { message: 'Aucune livraison à tarifer.', total_deliveries: 0, updated_deliveries: 0 };
    }

    const updates: DeliveryUpdate[] = [];
    let nonPriced = 0;

    for (const d of list) {
      const dist = this.toNumber(d.distance_km);

      if (dist === null) {
        nonPriced++;
        updates.push({
          id: d.id,
          price_ht: 0,
          price_ttc: 0,
          tva_amount: 0,
          tva_rate: 0,
          applied_range: null,
        });
        continue;
      }

      const calc = await this.calculatePrice(dist, normalizedPricing as any);

      updates.push({
        id: d.id,
        price_ht: calc.price_ht,
        price_ttc: calc.price_ttc,
        tva_amount: calc.tva_amount,
        tva_rate: calc.tva_rate,
        applied_range: calc.applied_range,
      });
    }

    const up = await supa.from('deliveries').upsert(updates, { onConflict: 'id' });
    if (up.error) throw new Error(`Erreur update deliveries: ${up.error.message}`);

    await this.updateClientsTotals(uploadId);
    await this.updateUploadTotals(uploadId);

    const summary = await this.getUploadBillingSummary(uploadId);

    return {
      message: 'Tarification appliquée ✅',
      total_deliveries: list.length,
      updated_deliveries: updates.length,
      non_priced: nonPriced,
      summary,
    };
  }

  /**
   * ✅ Re-fix: upsert STRICTEMENT compatible avec ta table clients actuelle
   * (pas de colonne distance dans clients)
   */
  private async updateClientsTotals(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data, error } = await supa
      .from('deliveries')
      .select('client_id, price_ht, price_ttc')
      .eq('upload_id', uploadId);

    if (error) throw new Error(`Erreur lecture deliveries totals clients: ${error.message}`);

    const rows = data ?? [];

    const map = new Map<string, { count: number; ht: number; ttc: number }>();
    for (const r of rows as any[]) {
      const cid = r.client_id as string;
      if (!cid) continue;

      const cur = map.get(cid) ?? { count: 0, ht: 0, ttc: 0 };
      cur.count += 1;
      cur.ht += Number(r.price_ht ?? 0);
      cur.ttc += Number(r.price_ttc ?? 0);
      map.set(cid, cur);
    }

    const payload = Array.from(map.entries()).map(([client_id, v]) => ({
      id: client_id,
      total_deliveries: v.count,
      total_amount_ht: this.round2(v.ht),
      total_amount_ttc: this.round2(v.ttc),
    }));

    if (payload.length === 0) return;

    const up = await supa.from('clients').upsert(payload, { onConflict: 'id' });
    if (up.error) throw new Error(`Erreur update clients totals: ${up.error.message}`);
  }

  private async updateUploadTotals(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data: d, error: dErr } = await supa
      .from('deliveries')
      .select('id, price_ttc')
      .eq('upload_id', uploadId);

    if (dErr) throw new Error(`Erreur lecture deliveries upload totals: ${dErr.message}`);

    const totalDeliveries = (d ?? []).length;
    const totalAmount = this.round2((d ?? []).reduce((a: number, r: any) => a + Number(r.price_ttc ?? 0), 0));

    const { data: c, error: cErr } = await supa
      .from('clients')
      .select('id')
      .eq('upload_id', uploadId);

    if (cErr) throw new Error(`Erreur lecture clients upload totals: ${cErr.message}`);

    const totalClients = (c ?? []).length;

    const upd = await supa
      .from('uploads')
      .update({
        total_deliveries: totalDeliveries,
        total_clients: totalClients,
        total_amount: totalAmount,
      })
      .eq('id', uploadId);

    if (upd.error) throw new Error(`Erreur update upload totals: ${upd.error.message}`);
  }

  async getUploadBillingSummary(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data: upload, error: uErr } = await supa
      .from('uploads')
      .select('id, total_deliveries, total_clients, total_amount, status, created_at')
      .eq('id', uploadId)
      .single();

    if (uErr) throw new Error(uErr.message);

    const { data: clients, error: cErr } = await supa
      .from('clients')
      .select('id, name, total_deliveries, total_amount_ht, total_amount_ttc')
      .eq('upload_id', uploadId)
      .order('name', { ascending: true });

    if (cErr) throw new Error(cErr.message);

    return {
      success: true,
      upload,
      clients: clients ?? [],
    };
  }
}
