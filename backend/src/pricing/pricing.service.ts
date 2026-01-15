import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface PriceCalculation {
  price_ht: number;
  price_ttc: number;
  tva_amount: number;
  tva_rate: number;
  applied_range: string;
}

type PricingInputRow = {
  range_start: number | string;
  range_end: number | string | null;
  price_ht?: number | string; // legacy front
  price?: number | string; // db/compat
  tva_rate: number | string;
};

type PricingDbRow = {
  id: string;
  upload_id: string | null;
  range_start: number;
  range_end: number | null;
  price: number;
  tva_rate: number | null;
};

type DeliveryDbRow = {
  id: string;
  upload_id: string | null;
  client_id: string | null;
  delivery_date: string; // NOT NULL en DB
  distance_km: number | null;
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

  private formatKmFR(n: number) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n));
  }

  private formatRangeLabel(start: number, end: number | null) {
    if (end === null) return `${this.formatKmFR(start)}+ km`;
    return `${this.formatKmFR(start)}-${this.formatKmFR(end)} km`;
  }

  async getPricingConfigForUpload(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data, error } = await supa
      .from('pricing_config')
      .select('range_start, range_end, price, tva_rate, upload_id')
      .eq('upload_id', uploadId)
      .order('range_start', { ascending: true });

    if (error) throw new BadRequestException(`Erreur lecture pricing_config: ${error.message}`);

    return (data ?? []).map((r: any) => ({
      range_start: Number(r.range_start),
      range_end: r.range_end === null ? null : Number(r.range_end),
      price: Number(r.price),
      tva_rate: r.tva_rate == null ? 20 : Number(r.tva_rate),
    }));
  }

  private normalizeConfig(rows: PricingDbRow[]) {
    return (rows ?? [])
      .map((r) => {
        const start = this.toNumber(r.range_start);
        const end = r.range_end === null ? null : this.toNumber(r.range_end);
        const price = this.toNumber(r.price);
        const tva = this.toNumber(r.tva_rate) ?? 20;

        if (start === null || price === null) return null;
        return { start, end, price, tva };
      })
      .filter(Boolean) as Array<{ start: number; end: number | null; price: number; tva: number }>;
  }

  async calculatePrice(distanceKm: number, pricingConfig: PricingDbRow[]): Promise<PriceCalculation> {
    const dist = this.toNumber(distanceKm);
    if (dist === null || dist < 0) throw new BadRequestException(`Distance invalide: ${distanceKm}`);

    const normalized = this.normalizeConfig(pricingConfig).sort((a, b) => a.start - b.start);
    if (!normalized.length) throw new BadRequestException('Aucune grille tarifaire trouvée pour cet upload.');

    let applied: (typeof normalized)[number] | null = null;

    for (const cfg of normalized) {
      if (cfg.end === null) {
        if (dist >= cfg.start) {
          applied = cfg;
          break;
        }
      } else {
        // inclusif (comme ton code)
        if (dist >= cfg.start && dist <= cfg.end) {
          applied = cfg;
          break;
        }
      }
    }

    if (!applied) applied = normalized[0];

    const priceHT = applied.price;
    const tvaRate = applied.tva ?? 20;
    const tvaAmount = (priceHT * tvaRate) / 100;
    const priceTTC = priceHT + tvaAmount;

    return {
      price_ht: this.round2(priceHT),
      price_ttc: this.round2(priceTTC),
      tva_amount: this.round2(tvaAmount),
      tva_rate: this.round2(tvaRate),
      applied_range: this.formatRangeLabel(applied.start, applied.end),
    };
  }

  /**
   * Détecte quelles colonnes existent réellement dans deliveries (cache/schema)
   */
  private async getDeliveriesWritableColumns(): Promise<{
    hasAppliedRange: boolean;
    hasTvaAmount: boolean;
    hasTvaRate: boolean;
  }> {
    const supa = this.databaseService.getClient();

    const tryCol = async (col: string) => {
      const { error } = await supa.from('deliveries').select(col).limit(1);
      return !error;
    };

    const [hasAppliedRange, hasTvaAmount, hasTvaRate] = await Promise.all([
      tryCol('applied_range'),
      tryCol('tva_amount'),
      tryCol('tva_rate'),
    ]);

    return { hasAppliedRange, hasTvaAmount, hasTvaRate };
  }

  async applyPricingToUpload(uploadId: string, pricing: PricingInputRow[]) {
    const supa = this.databaseService.getClient();

    const normalizedPricing = pricing
      .map((p) => {
        const range_start = this.toNumber(p.range_start);
        const range_end =
          p.range_end === null || p.range_end === '' ? null : this.toNumber(p.range_end);

        const price = this.toNumber((p as any).price ?? p.price_ht); // DB=price
        const tva_rate = this.toNumber(p.tva_rate) ?? 20;

        if (range_start === null || range_start < 0) return null;
        if (price === null || price < 0) return null;

        return { upload_id: uploadId, range_start, range_end, price, tva_rate };
      })
      .filter(Boolean) as Array<{
      upload_id: string;
      range_start: number;
      range_end: number | null;
      price: number;
      tva_rate: number;
    }>;

    if (!normalizedPricing.length) {
      throw new BadRequestException('Grille invalide: aucune tranche exploitable.');
    }

    // delete + insert pricing_config
    const delCfg = await supa.from('pricing_config').delete().eq('upload_id', uploadId);
    if (delCfg.error) throw new BadRequestException(`Erreur delete pricing_config: ${delCfg.error.message}`);

    const insCfg = await supa.from('pricing_config').insert(normalizedPricing);
    if (insCfg.error) throw new BadRequestException(`Erreur insert pricing_config: ${insCfg.error.message}`);

    // load deliveries (inclut delivery_date)
    const { data: deliveries, error: dErr } = await supa
      .from('deliveries')
      .select('id, upload_id, client_id, delivery_date, distance_km')
      .eq('upload_id', uploadId);

    if (dErr) throw new BadRequestException(`Erreur lecture deliveries: ${dErr.message}`);

    const list = (deliveries ?? []) as DeliveryDbRow[];
    if (!list.length) {
      await this.updateUploadTotals(uploadId);
      return { message: 'Aucune livraison à tarifer.', total_deliveries: 0, updated_deliveries: 0 };
    }

    // reload pricing_config
    const { data: cfgRows, error: cfgErr } = await supa
      .from('pricing_config')
      .select('id, upload_id, range_start, range_end, price, tva_rate')
      .eq('upload_id', uploadId)
      .order('range_start', { ascending: true });

    if (cfgErr) throw new BadRequestException(`Erreur lecture pricing_config post-insert: ${cfgErr.message}`);

    const cfg = (cfgRows ?? []) as PricingDbRow[];
    const cols = await this.getDeliveriesWritableColumns();

    const updates: any[] = [];
    let nonPriced = 0;

    for (const d of list) {
      const id = String(d.id ?? '').trim();
      if (!id) continue;

      // ✅ inclut delivery_date pour éviter tout insert qui casserait NOT NULL
      const base: any = {
        id,
        delivery_date: d.delivery_date,
        price_ht: 0,
        price_ttc: 0,
      };

      const dist = this.toNumber(d.distance_km);
      if (dist === null) {
        nonPriced++;
        if (cols.hasTvaAmount) base.tva_amount = 0;
        if (cols.hasTvaRate) base.tva_rate = 0;
        if (cols.hasAppliedRange) base.applied_range = null;
        updates.push(base);
        continue;
      }

      const calc = await this.calculatePrice(dist, cfg);

      base.price_ht = calc.price_ht;
      base.price_ttc = calc.price_ttc;
      if (cols.hasTvaAmount) base.tva_amount = calc.tva_amount;
      if (cols.hasTvaRate) base.tva_rate = calc.tva_rate;
      if (cols.hasAppliedRange) base.applied_range = calc.applied_range;

      updates.push(base);
    }

    // ✅ upsert deliveries (OK car on inclut delivery_date)
    const up = await supa.from('deliveries').upsert(updates, { onConflict: 'id' });
    if (up.error) throw new BadRequestException(`Erreur update deliveries: ${up.error.message}`);

    // ✅ IMPORTANT: clients.name NOT NULL => on fait des UPDATE, pas UPSERT
    await this.updateClientsTotals(uploadId);

    await this.updateUploadTotals(uploadId);

    const summary = await this.getUploadBillingSummary(uploadId);

    return {
      message: 'Tarification appliquée ✅',
      total_deliveries: list.length,
      updated_deliveries: updates.length,
      non_priced: nonPriced,
      summary,
      deliveries_columns: cols,
    };
  }

  /**
   * ✅ SAFE: update uniquement (pas d'insert) => aucun risque avec clients.name NOT NULL
   */
  private async updateClientsTotals(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data, error } = await supa
      .from('deliveries')
      .select('client_id, price_ht, price_ttc')
      .eq('upload_id', uploadId);

    if (error) throw new BadRequestException(`Erreur lecture deliveries totals clients: ${error.message}`);

    const map = new Map<string, { count: number; ht: number; ttc: number }>();

    for (const r of (data ?? []) as any[]) {
      const cid = r.client_id as string;
      if (!cid) continue;

      const cur = map.get(cid) ?? { count: 0, ht: 0, ttc: 0 };
      cur.count += 1;
      cur.ht += Number(r.price_ht ?? 0);
      cur.ttc += Number(r.price_ttc ?? 0);
      map.set(cid, cur);
    }

    // rien à faire
    if (map.size === 0) return;

    // ✅ Updates ciblés (si un client n'existe pas, update = 0 rows, pas d'erreur NOT NULL)
    for (const [client_id, v] of map.entries()) {
      const upd = await supa
        .from('clients')
        .update({
          total_deliveries: v.count,
          total_amount_ht: this.round2(v.ht),
          total_amount_ttc: this.round2(v.ttc),
        })
        .eq('id', client_id)
        .eq('upload_id', uploadId);

      if (upd.error) {
        throw new BadRequestException(`Erreur update clients totals: ${upd.error.message}`);
      }
    }
  }

  private async updateUploadTotals(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data: d, error: dErr } = await supa
      .from('deliveries')
      .select('id, price_ttc')
      .eq('upload_id', uploadId);

    if (dErr) throw new BadRequestException(`Erreur lecture deliveries upload totals: ${dErr.message}`);

    const totalDeliveries = (d ?? []).length;
    const totalAmount = this.round2(
      (d ?? []).reduce((a: number, r: any) => a + Number(r.price_ttc ?? 0), 0),
    );

    const { data: c, error: cErr } = await supa.from('clients').select('id').eq('upload_id', uploadId);
    if (cErr) throw new BadRequestException(`Erreur lecture clients upload totals: ${cErr.message}`);

    const totalClients = (c ?? []).length;

    const upd = await supa
      .from('uploads')
      .update({
        total_deliveries: totalDeliveries,
        total_clients: totalClients,
        total_amount: totalAmount,
      })
      .eq('id', uploadId);

    if (upd.error) throw new BadRequestException(`Erreur update upload totals: ${upd.error.message}`);
  }

  async getUploadBillingSummary(uploadId: string) {
    const supa = this.databaseService.getClient();

    const { data: upload, error: uErr } = await supa
      .from('uploads')
      .select('id, total_deliveries, total_clients, total_amount, status, created_at')
      .eq('id', uploadId)
      .single();

    if (uErr) throw new BadRequestException(uErr.message);

    const { data: clients, error: cErr } = await supa
      .from('clients')
      .select('id, name, total_deliveries, total_amount_ht, total_amount_ttc')
      .eq('upload_id', uploadId)
      .order('name', { ascending: true });

    if (cErr) throw new BadRequestException(cErr.message);

    return { success: true, upload, clients: clients ?? [] };
  }
}
