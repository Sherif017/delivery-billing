import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import puppeteer, { type Browser } from 'puppeteer';
import archiver from 'archiver';
import type { Response } from 'express';

type DeliveryRow = {
  id: string;

  task_id?: string | number | null;
  source_id?: string | number | null;
  external_id?: string | number | null;
  job_id?: string | number | null;
  course_id?: string | number | null;
  reference?: string | number | null;
  ref?: string | number | null;

  service_type?: string | null;
  service?: string | null;
  type_service?: string | null;
  type?: string | null;

  client_id: string;
  delivery_date: string | null;
  distance_km: number | null;
  price_ht: number | null;
  price_ttc: number | null;

  destination_address?: string | null;
  full_address?: string | null;
  status?: string | null;

  applied_range?: string | null;

  [key: string]: any;
};

type ClientRow = {
  id: string;
  name: string | null;
};

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
  price_ht: number; // on mappe DB.price => price_ht
  tva_rate: number;
};

type GlobalInvoiceMeta = {
  companyAddress?: string;
  invoiceDate?: string; // ex: 31/12/2025
  paymentDueDate?: string;
  paymentMethod?: string;
  serviceDate?: string;
  clientAddress?: string;
  ribIban?: string;
  bic?: string;
  companySiren?: string;
  companyVat?: string;
};

@Injectable()
export class InvoiceService {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------
  // Helpers
  // ---------------------------
  private round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private toNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  private getBusinessCourseId(d: DeliveryRow): string {
    const candidates = [
      d.task_id,
      d.source_id,
      d.external_id,
      d.job_id,
      d.course_id,
      d.reference,
      d.ref,
      (d as any).taskId,
      (d as any).sourceId,
      (d as any).externalId,
      (d as any).jobId,
      (d as any).courseId,
    ];

    for (const c of candidates) {
      if (c === null || c === undefined) continue;
      const s = String(c).trim();
      if (s) return s;
    }
    return String(d.id ?? '').trim() || '—';
  }

  private getServiceType(d: DeliveryRow): string {
    const candidates = [d.service_type, d.type_service, d.service, d.type];
    for (const c of candidates) {
      const s = String(c ?? '').trim();
      if (s) return s;
    }
    return 'delivery';
  }

  private extractRangeStart(row: Record<string, any>): number | null {
    const candidates = [row.range_start, row.start, row.km_start, row.from_km];
    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return null;
  }

  private extractRangeEnd(row: Record<string, any>): number | null {
    const candidates = [row.range_end, row.end, row.km_end, row.to_km];
    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return null;
  }

  private extractTvaRate(row: Record<string, any>): number {
    const candidates = [row.tva_rate, row.vat_rate, row.tva, row.vat];
    for (const c of candidates) {
      const n = this.toNumber(c);
      if (n !== null) return n;
    }
    return 0;
  }

  private formatKmFR(n: number) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n));
  }

  private formatRangeLabel(start: number, end: number | null) {
    if (end === null) return `${this.formatKmFR(start)}+ km`;
    return `${this.formatKmFR(start)}-${this.formatKmFR(end)} km`;
  }

  /**
   * Matching cohérent des tranches :
   * - tranche fermée: start <= dist < end (end exclusif)
   * - dernière tranche: dist >= start si end === null
   */
  private findTierForDistance(distanceKm: number, tiers: PricingTier[]): PricingTier | null {
    const dist = this.toNumber(distanceKm);
    if (dist === null || dist < 0) return null;

    const sorted = [...tiers].sort((a, b) => a.range_start - b.range_start);

    for (const t of sorted) {
      const s = t.range_start;
      const e = t.range_end;

      if (e === null) {
        if (dist >= s) return t;
      } else {
        if (dist >= s && dist < e) return t;
      }
    }
    return null;
  }

  private parseFrDateMaybe(s?: string): Date | null {
    const v = String(s ?? '').trim();
    if (!v) return null;

    // dd/mm/yyyy
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;

    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);

    const d = new Date(yyyy, mm - 1, dd);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  // ---------------------------
  // Dashboard Overview
  // ---------------------------
  async getUploadOverview(uploadId: string): Promise<{
    uploadId: string;
    totals: {
      clients: number;
      deliveries: number;
      totalDistance: number;
      totalHT: number;
      totalTTC: number;
      nonPriced: number;
    };
    clients: ClientOverview[];
  }> {
    const { data: clients, error: cErr } = await this.db
      .getClient()
      .from('clients')
      .select('id,name')
      .eq('upload_id', uploadId);

    if (cErr) throw new BadRequestException(cErr.message);

    const clientList = (clients ?? []) as ClientRow[];
    const nameById = new Map<string, string>();
    for (const c of clientList) nameById.set(c.id, c.name ?? c.id);

    const { data: deliveries, error: dErr } = await this.db
      .getClient()
      .from('deliveries')
      .select('id, client_id, distance_km, price_ht, price_ttc')
      .eq('upload_id', uploadId);

    if (dErr) throw new BadRequestException(dErr.message);

    const rows = (deliveries ?? []) as Array<{
      id: string;
      client_id: string | null;
      distance_km: number | null;
      price_ht: number | null;
      price_ttc: number | null;
    }>;

    const map = new Map<string, ClientOverview>();

    let totalDistance = 0;
    let totalHT = 0;
    let totalTTC = 0;
    let nonPricedTotal = 0;

    for (const r of rows) {
      const cid = r.client_id ?? '';
      if (!cid) continue;

      const entry =
        map.get(cid) ??
        ({
          id: cid,
          name: nameById.get(cid) ?? cid,
          deliveriesCount: 0,
          totalDistance: 0,
          totalHT: 0,
          totalTTC: 0,
          nonPriced: 0,
        } as ClientOverview);

      entry.deliveriesCount += 1;

      const km = Number(r.distance_km ?? 0);
      const ht = r.price_ht == null ? null : Number(r.price_ht);
      const ttc = r.price_ttc == null ? null : Number(r.price_ttc);

      entry.totalDistance += km;
      totalDistance += km;

      if (ht === null || ttc === null) {
        entry.nonPriced += 1;
        nonPricedTotal += 1;
      } else {
        entry.totalHT += ht;
        entry.totalTTC += ttc;
        totalHT += ht;
        totalTTC += ttc;
      }

      map.set(cid, entry);
    }

    const clientsOverview = Array.from(map.values())
      .map((c) => ({
        ...c,
        totalDistance: this.round2(c.totalDistance),
        totalHT: this.round2(c.totalHT),
        totalTTC: this.round2(c.totalTTC),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    return {
      uploadId,
      totals: {
        clients: clientList.length,
        deliveries: rows.length,
        totalDistance: this.round2(totalDistance),
        totalHT: this.round2(totalHT),
        totalTTC: this.round2(totalTTC),
        nonPriced: nonPricedTotal,
      },
      clients: clientsOverview,
    };
  }

  // ---------------------------
  // PDF / HTML Client
  // ---------------------------
  async generateClientInvoicePdf(uploadId: string, clientId: string): Promise<Buffer> {
    const html = await this.generateClientInvoiceHtml(uploadId, clientId);

    const browser = await this.launchBrowser();
    try {
      const pdfBytes = await this.renderPdfWithBrowser(browser, html);
      return Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur génération PDF (puppeteer)');
    } finally {
      await browser.close();
    }
  }

  async generateClientInvoicePdfWithCompany(
    uploadId: string,
    clientId: string,
    companyName: string,
  ): Promise<Buffer> {
    const html = await this.generateClientInvoiceHtmlWithCompany(uploadId, clientId, companyName);

    const browser = await this.launchBrowser();
    try {
      const pdfBytes = await this.renderPdfWithBrowser(browser, html);
      return Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur génération PDF (puppeteer)');
    } finally {
      await browser.close();
    }
  }

  async generateClientInvoiceHtml(uploadId: string, clientId: string): Promise<string> {
    const { client, deliveries } = await this.loadClientAndDeliveries(uploadId, clientId);
    const totals = this.computeTotals(deliveries);

    const issuer = {
      name: 'PRESLOG',
      legal: 'SARL',
      address1: '142 Rue de Clignancourt',
      address2: '75018 Paris',
      siren: '824224539',
      vat: 'FR69824224539',
      bank: 'Crédit Agricole',
      iban: 'FR76 1820 6001 2365 1077 7789 422',
      bic: 'AGRIFRPP882',
    };

    const invoiceNumber = this.buildInvoiceNumber(uploadId, clientId);

    return this.renderHtml({
      issuer,
      client,
      invoiceNumber,
      deliveries,
      totals,
    });
  }

  async generateClientInvoiceHtmlWithCompany(
    uploadId: string,
    clientId: string,
    companyName: string,
  ): Promise<string> {
    const { client, deliveries } = await this.loadClientAndDeliveries(uploadId, clientId);
    const totals = this.computeTotals(deliveries);

    const invoiceNumber = this.buildInvoiceNumber(uploadId, clientId);

    return this.renderClientHtmlWithCompany({
      companyName,
      client,
      invoiceNumber,
      deliveries,
      totals,
    });
  }

  // ---------------------------
  // Facture globale
  // ---------------------------
  async generateGlobalInvoicePdf(
    uploadId: string,
    companyName: string,
    globalClientName: string,
    meta?: GlobalInvoiceMeta,
  ): Promise<Buffer> {
    const html = await this.generateGlobalInvoiceHtml(uploadId, companyName, globalClientName, meta);

    const browser = await this.launchBrowser();
    try {
      const pdfBytes = await this.renderPdfWithBrowser(browser, html);
      return Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur génération PDF global (puppeteer)');
    } finally {
      await browser.close();
    }
  }

  async generateGlobalInvoiceHtml(
    uploadId: string,
    companyName: string,
    globalClientName: string,
    meta?: GlobalInvoiceMeta,
  ) {
    const deliveries = await this.loadAllDeliveries(uploadId);

    // ✅ grille PAR upload (upload_id), DB colonne = price
    const tiers = await this.loadPricingConfig(uploadId);

    const enriched = deliveries.map((d) => {
      const already = String(d.applied_range ?? '').trim();
      if (already) return d;

      const dist = this.toNumber(d.distance_km);
      if (dist === null) return { ...d, applied_range: 'Non tarifé' };

      const tier = tiers.length ? this.findTierForDistance(dist, tiers) : null;
      const applied_range = tier
        ? this.formatRangeLabel(tier.range_start, tier.range_end)
        : 'Non tarifé';

      return { ...d, applied_range };
    });

    const totals = this.computeTotalsGlobal(enriched);
    const summary = this.buildSummaryByRange(enriched);

    // ✅ ID: company + MM + YY (ex: preslog0126)
    const invoiceDate = this.parseFrDateMaybe(meta?.invoiceDate) ?? new Date();
    const invoiceNumber = this.buildGlobalInvoiceNumber(companyName, invoiceDate);

    return this.renderGlobalHtml({
      companyName,
      globalClientName,
      invoiceNumber,
      deliveries: enriched,
      totals,
      summary,
      meta: meta ?? {},
    });
  }

  // ---------------------------
  // ZIP
  // ---------------------------
  async streamInvoicesZip(uploadId: string, res: Response, companyName?: string | null) {
    const { data: clients, error } = await this.db
      .getClient()
      .from('clients')
      .select('id, name')
      .eq('upload_id', uploadId)
      .order('name', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    if (!clients || clients.length === 0) {
      throw new BadRequestException('Aucun client trouvé pour cet upload');
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      throw new BadRequestException(err?.message || 'Erreur création ZIP');
    });

    archive.pipe(res);

    const browser = await this.launchBrowser();

    try {
      const company = (companyName ?? '').trim();

      for (const c of clients) {
        const html = company
          ? await this.generateClientInvoiceHtmlWithCompany(uploadId, c.id, company)
          : await this.generateClientInvoiceHtml(uploadId, c.id);

        const pdfBytes = await this.renderPdfWithBrowser(browser, html);
        const pdfBuffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);

        const safe = this.safeFilename(c.name || c.id);
        archive.append(pdfBuffer, { name: `facture_${safe}.pdf` });
      }

      await archive.finalize();
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Erreur génération ZIP');
    } finally {
      await browser.close();
    }
  }

  // ---------------------------
  // Internals DB / Puppeteer
  // ---------------------------
  private async launchBrowser(): Promise<Browser> {
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

    return puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(executablePath ? { executablePath } : {}),
    });
  }

  private async renderPdfWithBrowser(browser: Browser, html: string): Promise<Buffer | Uint8Array> {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
      });

      return pdf as any;
    } finally {
      await page.close();
    }
  }

  private async loadClientAndDeliveries(uploadId: string, clientId: string) {
    const { data: client, error: cErr } = await this.db
      .getClient()
      .from('clients')
      .select('id, name, address, postal_code, city, country')
      .eq('id', clientId)
      .eq('upload_id', uploadId)
      .single();

    if (cErr) throw new BadRequestException(cErr.message);
    if (!client) throw new BadRequestException('Client introuvable');

    const { data: deliveries, error: dErr } = await this.db
      .getClient()
      .from('deliveries')
      .select('*')
      .eq('upload_id', uploadId)
      .eq('client_id', clientId)
      .order('delivery_date', { ascending: true });

    if (dErr) throw new BadRequestException(dErr.message);

    return { client, deliveries: (deliveries ?? []) as DeliveryRow[] };
  }

  private async loadAllDeliveries(uploadId: string): Promise<DeliveryRow[]> {
    const { data: deliveries, error } = await this.db
      .getClient()
      .from('deliveries')
      .select('*')
      .eq('upload_id', uploadId)
      .order('delivery_date', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return (deliveries ?? []) as DeliveryRow[];
  }

  /**
   * ✅ IMPORTANT : ton schéma DB:
   * - pricing_config.price (pas price_ht)
   * - pricing_config.upload_id existe (nullable)
   */
  private async loadPricingConfig(uploadId: string): Promise<PricingTier[]> {
    const { data, error } = await this.db
      .getClient()
      .from('pricing_config')
      .select('*')
      .eq('upload_id', uploadId)
      .order('range_start', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as Record<string, any>[];

    const tiers: PricingTier[] = rows
      .map((r) => {
        const range_start = this.extractRangeStart(r);
        const range_end = this.extractRangeEnd(r);

        // ✅ DB = "price"
        const price_ht = this.toNumber(r.price ?? r.price_ht);
        const tva_rate = this.extractTvaRate(r);

        if (range_start === null || price_ht === null) return null;

        return { range_start, range_end, price_ht, tva_rate };
      })
      .filter(Boolean) as PricingTier[];

    tiers.sort((a, b) => a.range_start - b.range_start);
    return tiers;
  }

  // ---------------------------
  // Totals / Summary
  // ---------------------------
  private computeTotals(deliveries: DeliveryRow[]) {
    const totalDistance = deliveries.reduce((a, d) => a + Number(d.distance_km ?? 0), 0);
    const totalHT = deliveries.reduce((a, d) => a + Number(d.price_ht ?? 0), 0);
    const totalTTC = deliveries.reduce((a, d) => a + Number(d.price_ttc ?? 0), 0);
    const totalTVA = totalTTC - totalHT;

    return {
      totalDistance: this.round2(totalDistance),
      totalHT: this.round2(totalHT),
      totalTVA: this.round2(totalTVA),
      totalTTC: this.round2(totalTTC),
    };
  }

  private computeTotalsGlobal(deliveries: DeliveryRow[]) {
    let totalDistance = 0;
    let totalHT = 0;
    let totalTTC = 0;
    let nonPriced = 0;

    for (const d of deliveries) {
      totalDistance += Number(d.distance_km ?? 0);

      const ht = d.price_ht == null ? null : Number(d.price_ht);
      const ttc = d.price_ttc == null ? null : Number(d.price_ttc);
      const tva = ht === null || ttc === null ? null : ttc - ht;

      if (ht === null || ttc === null || tva === null) {
        nonPriced += 1;
      } else {
        totalHT += ht;
        totalTTC += ttc;
      }
    }

    const totalTVA = totalTTC - totalHT;

    return {
      totalCourses: deliveries.length,
      nonPriced,
      totalDistance: this.round2(totalDistance),
      totalHT: this.round2(totalHT),
      totalTVA: this.round2(totalTVA),
      totalTTC: this.round2(totalTTC),
    };
  }

  private buildSummaryByRange(deliveries: DeliveryRow[]) {
    type Bucket = {
      range: string;
      unitHT: number | null;
      unitTVA: number | null;
      unitTTC: number | null;
      count: number;
      totalHT: number;
      totalTVA: number;
      totalTTC: number;
    };

    const map = new Map<string, Bucket>();

    for (const d of deliveries) {
      const range = (d.applied_range || 'Non tarifé').trim() || 'Non tarifé';

      const ht = d.price_ht == null ? null : Number(d.price_ht);
      const ttc = d.price_ttc == null ? null : Number(d.price_ttc);
      const tva = ht === null || ttc === null ? null : ttc - ht;

      const b =
        map.get(range) ??
        ({
          range,
          unitHT: null,
          unitTVA: null,
          unitTTC: null,
          count: 0,
          totalHT: 0,
          totalTVA: 0,
          totalTTC: 0,
        } as Bucket);

      b.count += 1;

      if (ht !== null && ttc !== null && tva !== null) {
        if (b.unitHT === null) b.unitHT = ht;
        if (b.unitTVA === null) b.unitTVA = this.round2(tva);
        if (b.unitTTC === null) b.unitTTC = ttc;

        b.totalHT += ht;
        b.totalTVA += tva;
        b.totalTTC += ttc;
      }

      map.set(range, b);
    }

    const list = Array.from(map.values()).map((x) => ({
      ...x,
      totalHT: this.round2(x.totalHT),
      totalTVA: this.round2(x.totalTVA),
      totalTTC: this.round2(x.totalTTC),
      unitHT: x.unitHT == null ? null : this.round2(x.unitHT),
      unitTVA: x.unitTVA == null ? null : this.round2(x.unitTVA),
      unitTTC: x.unitTTC == null ? null : this.round2(x.unitTTC),
    }));

    const priced = list.filter((x) => x.range !== 'Non tarifé');
    const nonPriced = list.filter((x) => x.range === 'Non tarifé');

    priced.sort((a, b) => this.sortRangeLabel(a.range, b.range));

    return [...priced, ...nonPriced];
  }

  private sortRangeLabel(a: string, b: string) {
    const parseStart = (s: string) => {
      const raw = String(s ?? '').trim();
      const m = raw.match(/^(\d+(?:[.,]\d+)?)/);
      if (!m) return Number.POSITIVE_INFINITY;
      const n = Number(m[1].replace(',', '.'));
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    };
    return parseStart(a) - parseStart(b);
  }

  private buildInvoiceNumber(uploadId: string, clientId: string) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `FAC-${y}${m}${day}-${clientId.slice(0, 6)}-${uploadId.slice(0, 6)}`;
  }

  // ✅ ID global: company + MM + YY (ex: preslog0126)
  private buildGlobalInvoiceNumber(companyName: string, invoiceDate?: Date) {
    const d = invoiceDate ?? new Date();

    const slug = String(companyName ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // retire accents
      .replace(/\s+/g, '') // retire espaces
      .replace(/[^a-z0-9]/g, ''); // garde uniquement lettres/chiffres

    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);

    return `${slug}${mm}${yy}`;
  }

  private safeFilename(name: string) {
    return name
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  // ---------------------------
  // HTML CLIENT (issuer original)
  // ---------------------------
  private renderHtml(input: any) {
    const { issuer, client, invoiceNumber, deliveries, totals } = input;

    const formatMoney = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Number(n || 0),
      );

    const formatKm = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        Number(n || 0),
      );

    const rows = deliveries
      .map((d: DeliveryRow) => {
        const service = this.getServiceType(d);
        const businessId = this.getBusinessCourseId(d);
        const date = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('fr-FR') : '—';
        const km = Number(d.distance_km ?? 0);

        const ht = d.price_ht == null ? null : Number(d.price_ht);
        const ttc = d.price_ttc == null ? null : Number(d.price_ttc);
        const tva = ht === null || ttc === null ? null : ttc - ht;

        return `
          <tr>
            <td>${this.escapeHtml(service)}</td>
            <td class="mono">${this.escapeHtml(businessId)}</td>
            <td>${this.escapeHtml(date)}</td>
            <td class="right">${formatKm(km)} km</td>
            <td class="right">${ht === null ? '—' : `${formatMoney(ht)} €`}</td>
            <td class="right">${tva === null ? '—' : `${formatMoney(tva)} €`}</td>
            <td class="right">${ttc === null ? '—' : `${formatMoney(ttc)} €`}</td>
          </tr>
        `;
      })
      .join('');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Facture ${this.escapeHtml(invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color:#111; margin:0; }
    .page { padding: 8px; }
    .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .card { border:1px solid #e7e8ef; border-radius:12px; padding:12px; background:#f6f7fb; }
    .issuer h1 { margin:0; font-size:18px; letter-spacing:0.2px; }
    .muted { color:#666; font-size:12px; line-height:1.4; }
    .title { font-size:20px; font-weight:800; margin:0; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#eef2ff; border:1px solid #dbe1ff; font-size:11px; font-weight:700; color:#1f2a7a; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px; }
    .section-title { font-size:12px; color:#444; font-weight:700; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.6px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th, td { border-bottom:1px solid #e9e9ee; padding:9px 8px; font-size:12px; vertical-align:top; }
    th { background:#f3f4f6; text-align:left; font-size:12px; }
    .right { text-align:right; white-space:nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; }
    .totals { margin-top:12px; display:flex; justify-content:flex-end; }
    .totals .box { width: 360px; border:1px solid #e7e8ef; background:#fff; border-radius:12px; padding:10px; }
    .totals table { margin:0; }
    .totals td { border:none; padding:6px 6px; font-size:12px; }
    .totals tr td:first-child { color:#555; }
    .totals tr td:last-child { text-align:right; font-weight:800; }
    .footer { margin-top:14px; font-size:11px; color:#666; display:flex; justify-content:space-between; gap:10px; }
    .hr { height:1px; background:#e9e9ee; margin:12px 0; }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="issuer">
        <h1>${this.escapeHtml(issuer.name)}</h1>
        <div class="muted">${this.escapeHtml(issuer.legal)}</div>
        <div class="muted">${this.escapeHtml(issuer.address1)}</div>
        <div class="muted">${this.escapeHtml(issuer.address2)}</div>
        <div class="muted">SIREN: ${this.escapeHtml(issuer.siren)} — TVA: ${this.escapeHtml(issuer.vat)}</div>
      </div>

      <div class="card" style="min-width: 280px;">
        <div class="pill">Facture</div>
        <div style="margin-top:10px;">
          <div class="title">${this.escapeHtml(invoiceNumber)}</div>
          <div class="muted">Date: ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="section-title">Client</div>
        <div style="font-weight:800;">${this.escapeHtml(client.name)}</div>
        <div class="muted">${this.escapeHtml(client.address || '')}</div>
        <div class="muted">${this.escapeHtml((client.postal_code || '') + ' ' + (client.city || ''))}</div>
        ${client.country ? `<div class="muted">${this.escapeHtml(client.country)}</div>` : ''}
      </div>

      <div class="card">
        <div class="section-title">Résumé</div>
        <div class="muted">Total courses: <strong>${deliveries.length}</strong></div>
        <div class="muted">Distance totale: <strong>${formatKm(totals.totalDistance)} km</strong></div>
        <div class="muted">Total HT: <strong>${formatMoney(totals.totalHT)} €</strong></div>
        <div class="muted">TVA: <strong>${formatMoney(totals.totalTVA)} €</strong></div>
        <div class="muted">Total TTC: <strong>${formatMoney(totals.totalTTC)} €</strong></div>
      </div>
    </div>

    <div class="hr"></div>
    <div class="section-title">Détail des courses</div>

    <table>
      <thead>
        <tr>
          <th>Type de service</th>
          <th>ID de la tâche</th>
          <th>Date</th>
          <th class="right">Distance</th>
          <th class="right">HT</th>
          <th class="right">TVA</th>
          <th class="right">TTC</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="7">Aucune course</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="box">
        <table>
          <tr><td>Distance totale</td><td>${formatKm(totals.totalDistance)} km</td></tr>
          <tr><td>Total HT</td><td>${formatMoney(totals.totalHT)} €</td></tr>
          <tr><td>Total TVA</td><td>${formatMoney(totals.totalTVA)} €</td></tr>
          <tr><td>Total TTC</td><td>${formatMoney(totals.totalTTC)} €</td></tr>
        </table>
      </div>
    </div>

    <div class="footer">
      <div class="muted">Facture générée via la plateforme.</div>
      <div class="muted" style="text-align:right; max-width: 280px;">
        Modèle MVP. À ajouter: mentions légales complètes, conditions, pénalités, etc.
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  // ---------------------------
  // HTML CLIENT (companyName)
  // ---------------------------
  private renderClientHtmlWithCompany(input: {
    companyName: string;
    client: any;
    invoiceNumber: string;
    deliveries: DeliveryRow[];
    totals: { totalDistance: number; totalHT: number; totalTVA: number; totalTTC: number };
  }) {
    const { companyName, client, invoiceNumber, deliveries, totals } = input;

    const formatMoney = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Number(n || 0),
      );

    const formatKm = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
        Number(n || 0),
      );

    const rows = deliveries
      .map((d: DeliveryRow) => {
        const service = this.getServiceType(d);
        const businessId = this.getBusinessCourseId(d);
        const date = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('fr-FR') : '—';
        const km = Number(d.distance_km ?? 0);

        const ht = d.price_ht == null ? null : Number(d.price_ht);
        const ttc = d.price_ttc == null ? null : Number(d.price_ttc);
        const tva = ht === null || ttc === null ? null : ttc - ht;

        return `
          <tr>
            <td>${this.escapeHtml(service)}</td>
            <td class="mono">${this.escapeHtml(businessId)}</td>
            <td>${this.escapeHtml(date)}</td>
            <td class="right">${formatKm(km)} km</td>
            <td class="right">${ht === null ? '—' : `${formatMoney(ht)} €`}</td>
            <td class="right">${tva === null ? '—' : `${formatMoney(tva)} €`}</td>
            <td class="right">${ttc === null ? '—' : `${formatMoney(ttc)} €`}</td>
          </tr>
        `;
      })
      .join('');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Facture ${this.escapeHtml(invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color:#111; margin:0; }
    .page { padding: 8px; }
    .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .card { border:1px solid #e7e8ef; border-radius:12px; padding:12px; background:#f6f7fb; }
    .issuer h1 { margin:0; font-size:18px; letter-spacing:0.2px; }
    .muted { color:#666; font-size:12px; line-height:1.4; }
    .title { font-size:20px; font-weight:800; margin:0; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#eef2ff; border:1px solid #dbe1ff; font-size:11px; font-weight:700; color:#1f2a7a; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px; }
    .section-title { font-size:12px; color:#444; font-weight:700; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.6px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th, td { border-bottom:1px solid #e9e9ee; padding:9px 8px; font-size:12px; vertical-align:top; }
    th { background:#f3f4f6; text-align:left; font-size:12px; }
    .right { text-align:right; white-space:nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; }
    .totals { margin-top:12px; display:flex; justify-content:flex-end; }
    .totals .box { width: 360px; border:1px solid #e7e8ef; background:#fff; border-radius:12px; padding:10px; }
    .totals table { margin:0; }
    .totals td { border:none; padding:6px 6px; font-size:12px; }
    .totals tr td:first-child { color:#555; }
    .totals tr td:last-child { text-align:right; font-weight:800; }
    .footer { margin-top:14px; font-size:11px; color:#666; display:flex; justify-content:space-between; gap:10px; }
    .hr { height:1px; background:#e9e9ee; margin:12px 0; }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="issuer">
        <h1>${this.escapeHtml(companyName)}</h1>
        <div class="muted">Facture</div>
      </div>

      <div class="card" style="min-width: 280px;">
        <div class="pill">Facture</div>
        <div style="margin-top:10px;">
          <div class="title">${this.escapeHtml(invoiceNumber)}</div>
          <div class="muted">Date: ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="section-title">Client</div>
        <div style="font-weight:800;">${this.escapeHtml(client.name)}</div>
        <div class="muted">${this.escapeHtml(client.address || '')}</div>
        <div class="muted">${this.escapeHtml((client.postal_code || '') + ' ' + (client.city || ''))}</div>
        ${client.country ? `<div class="muted">${this.escapeHtml(client.country)}</div>` : ''}
      </div>

      <div class="card">
        <div class="section-title">Résumé</div>
        <div class="muted">Total courses: <strong>${deliveries.length}</strong></div>
        <div class="muted">Distance totale: <strong>${formatKm(totals.totalDistance)} km</strong></div>
        <div class="muted">Total HT: <strong>${formatMoney(totals.totalHT)} €</strong></div>
        <div class="muted">TVA: <strong>${formatMoney(totals.totalTVA)} €</strong></div>
        <div class="muted">Total TTC: <strong>${formatMoney(totals.totalTTC)} €</strong></div>
      </div>
    </div>

    <div class="hr"></div>
    <div class="section-title">Détail des courses</div>

    <table>
      <thead>
        <tr>
          <th>Type de service</th>
          <th>ID de la tâche</th>
          <th>Date</th>
          <th class="right">Distance</th>
          <th class="right">HT</th>
          <th class="right">TVA</th>
          <th class="right">TTC</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="7">Aucune course</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="box">
        <table>
          <tr><td>Distance totale</td><td>${formatKm(totals.totalDistance)} km</td></tr>
          <tr><td>Total HT</td><td>${formatMoney(totals.totalHT)} €</td></tr>
          <tr><td>Total TVA</td><td>${formatMoney(totals.totalTVA)} €</td></tr>
          <tr><td>Total TTC</td><td>${formatMoney(totals.totalTTC)} €</td></tr>
        </table>
      </div>
    </div>

    <div class="footer">
      <div class="muted">Facture générée via la plateforme.</div>
      <div class="muted" style="text-align:right; max-width: 280px;">
        Modèle MVP. À ajouter: mentions légales complètes, conditions, pénalités, etc.
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  // ---------------------------
  // HTML GLOBAL (2 pages) ✅ CORRIGÉ
  // ---------------------------
  private renderGlobalHtml(input: any) {
    const { companyName, globalClientName, invoiceNumber, deliveries, totals, summary, meta } = input as {
      companyName: string;
      globalClientName: string;
      invoiceNumber: string;
      deliveries: DeliveryRow[];
      totals: any;
      summary: any[];
      meta: GlobalInvoiceMeta;
    };

    const formatMoney = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Number(n || 0),
      );

    const formatKm = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(
        Number(n || 0),
      );

    const rows = deliveries
      .map((d: DeliveryRow) => {
        const service = this.getServiceType(d);
        const businessId = this.getBusinessCourseId(d);
        const date = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('fr-FR') : '—';
        const km = Number(d.distance_km ?? 0);

        const ht = d.price_ht == null ? null : Number(d.price_ht);
        const ttc = d.price_ttc == null ? null : Number(d.price_ttc);
        const tva = ht === null || ttc === null ? null : ttc - ht;

        return `
          <tr>
            <td>${this.escapeHtml(service)}</td>
            <td class="mono">${this.escapeHtml(businessId)}</td>
            <td>${this.escapeHtml(date)}</td>
            <td class="right">${formatKm(km)} km</td>
            <td class="right">${ht === null ? '—' : `${formatMoney(ht)} €`}</td>
            <td class="right">${tva === null ? '—' : `${formatMoney(tva)} €`}</td>
            <td class="right">${ttc === null ? '—' : `${formatMoney(ttc)} €`}</td>
          </tr>
        `;
      })
      .join('');

    const summaryRows = summary
      .map((s: any) => {
        const unitHT = s.unitHT == null ? '—' : `${formatMoney(s.unitHT)} €`;
        const unitTVA = s.unitTVA == null ? '—' : `${formatMoney(s.unitTVA)} €`;
        const unitTTC = s.unitTTC == null ? '—' : `${formatMoney(s.unitTTC)} €`;

        return `
          <tr>
            <td class="mono">${this.escapeHtml(s.range)}</td>
            <td class="right">${unitHT}</td>
            <td class="right">${unitTVA}</td>
            <td class="right">${unitTTC}</td>
            <td class="right"><strong>${s.count}</strong></td>
            <td class="right">${formatMoney(s.totalHT)} €</td>
            <td class="right">${formatMoney(s.totalTVA)} €</td>
            <td class="right">${formatMoney(s.totalTTC)} €</td>
          </tr>
        `;
      })
      .join('');

    const metaLine = (label: string, value?: string) => {
      const v = String(value ?? '').trim();
      if (!v) return '';
      return `<div class="muted">${this.escapeHtml(label)} : <strong>${this.escapeHtml(v)}</strong></div>`;
    };

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Facture ${this.escapeHtml(invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color:#111; margin:0; }
    .page { padding: 8px; }
    .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .card { border:1px solid #e7e8ef; border-radius:12px; padding:12px; background:#f6f7fb; }
    .issuer h1 { margin:0; font-size:18px; letter-spacing:0.2px; }
    .muted { color:#666; font-size:12px; line-height:1.4; }
    .title { font-size:20px; font-weight:800; margin:0; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#eef2ff; border:1px solid #dbe1ff; font-size:11px; font-weight:700; color:#1f2a7a; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px; }
    .section-title { font-size:12px; color:#444; font-weight:700; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.6px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th, td { border-bottom:1px solid #e9e9ee; padding:9px 8px; font-size:12px; vertical-align:top; }
    th { background:#f3f4f6; text-align:left; font-size:12px; }
    .right { text-align:right; white-space:nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; }
    .totals { margin-top:12px; display:flex; justify-content:flex-end; }
    .totals .box { width: 420px; border:1px solid #e7e8ef; background:#fff; border-radius:12px; padding:10px; }
    .totals table { margin:0; }
    .totals td { border:none; padding:6px 6px; font-size:12px; }
    .totals tr td:first-child { color:#555; }
    .totals tr td:last-child { text-align:right; font-weight:800; }
    .hr { height:1px; background:#e9e9ee; margin:12px 0; }
    .page-break { page-break-before: always; break-before: page; }
  </style>
</head>
<body>
  <div class="page">

    <div class="top">
      <div class="issuer">
        <h1>${this.escapeHtml(companyName)}</h1>
        ${meta?.companyAddress ? `<div class="muted">${this.escapeHtml(meta.companyAddress)}</div>` : ''}
      </div>

      <div class="card" style="min-width: 280px;">
        <div class="pill">Facture</div>
        <div style="margin-top:10px;">
          <div class="title">${this.escapeHtml(invoiceNumber)}</div>
          <div class="muted">Client: ${this.escapeHtml(globalClientName)}</div>
          ${meta?.invoiceDate ? `<div class="muted">Date de la facture: <strong>${this.escapeHtml(meta.invoiceDate)}</strong></div>` : ''}
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="section-title">Informations</div>
        ${metaLine('Modalité de paiement', meta?.paymentMethod)}
        ${metaLine('Date de la prestation', meta?.serviceDate)}
        ${metaLine('Paiement dû', meta?.paymentDueDate)}
        ${metaLine('RIB / IBAN', meta?.ribIban)}
        ${metaLine('SIREN', meta?.companySiren)}
        ${metaLine('TVA', meta?.companyVat)}
        ${metaLine('BIC', meta?.bic)}
      </div>

      <div class="card">
        <div class="section-title">Destinataire</div>
        <div style="font-weight:800;">${this.escapeHtml(globalClientName)}</div>
        ${meta?.clientAddress ? `<div class="muted">${this.escapeHtml(meta.clientAddress)}</div>` : ''}
      </div>
    </div>

    <div class="hr"></div>
    <div class="section-title">Synthèse par intervalle</div>

    <table>
      <thead>
        <tr>
          <th>Intervalle</th>
          <th class="right">PU HT</th>
          <th class="right">PU TVA</th>
          <th class="right">PU TTC</th>
          <th class="right">Nb courses</th>
          <th class="right">Total HT</th>
          <th class="right">TVA</th>
          <th class="right">Total TTC</th>
        </tr>
      </thead>
      <tbody>
        ${summaryRows || `<tr><td colspan="8">Aucune donnée</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="box">
        <table>
          <tr><td>Total courses</td><td>${totals.totalCourses}</td></tr>
          <tr><td>Non tarifées</td><td>${totals.nonPriced}</td></tr>
          <tr><td>Total HT</td><td>${formatMoney(totals.totalHT)} €</td></tr>
          <tr><td>Total TVA</td><td>${formatMoney(totals.totalTVA)} €</td></tr>
          <tr><td>Total TTC</td><td>${formatMoney(totals.totalTTC)} €</td></tr>
        </table>
      </div>
    </div>

    <div class="page-break"></div>

    <div class="top" style="margin-top: 2px;">
      <div class="issuer">
        <h1>${this.escapeHtml(companyName)}</h1>
      </div>

      <div class="card" style="min-width: 280px;">
        <div class="pill">Détail</div>
        <div style="margin-top:10px;">
          <div class="title">${this.escapeHtml(invoiceNumber)}</div>
          <div class="muted">Date: ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
      </div>
    </div>

    <div class="hr"></div>
    <div class="section-title">Détail des courses</div>

    <table>
      <thead>
        <tr>
          <th>Type de service</th>
          <th>ID de la tâche</th>
          <th>Date</th>
          <th class="right">Distance</th>
          <th class="right">HT</th>
          <th class="right">TVA</th>
          <th class="right">TTC</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="7">Aucune course</td></tr>`}
      </tbody>
    </table>
  </div>
</body>
</html>`;
  }

  private escapeHtml(s: string) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
