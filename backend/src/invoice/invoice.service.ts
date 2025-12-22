import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import puppeteer, { type Browser } from 'puppeteer';
import archiver from 'archiver';
import type { Response } from 'express';

type DeliveryRow = {
  id: string;
  client_id: string;
  delivery_date: string | null;
  distance_km: number | null;
  price_ht: number | null;
  price_ttc: number | null;
  destination_address?: string | null;
  full_address?: string | null;
  status?: string | null;
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

@Injectable()
export class InvoiceService {
  constructor(private readonly db: DatabaseService) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  // ✅ OVERVIEW DASHBOARD (source de vérité: deliveries)
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
    // 1) clients
    const { data: clients, error: cErr } = await this.db
      .getClient()
      .from('clients')
      .select('id,name')
      .eq('upload_id', uploadId);

    if (cErr) throw new BadRequestException(cErr.message);

    const clientList = (clients ?? []) as ClientRow[];
    const nameById = new Map<string, string>();
    for (const c of clientList) nameById.set(c.id, c.name ?? c.id);

    // 2) deliveries (une seule requête)
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

    // group par client
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

    // arrondis
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

  // ============ PUBLIC API ============

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

  // ZIP streaming (1 PDF par client)
  async streamInvoicesZip(uploadId: string, res: Response) {
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
      for (const c of clients) {
        const html = await this.generateClientInvoiceHtml(uploadId, c.id);
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

  // ============ INTERNALS ============

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
      .select('id, delivery_date, distance_km, price_ht, price_ttc, destination_address, status')
      .eq('upload_id', uploadId)
      .eq('client_id', clientId)
      .order('delivery_date', { ascending: true });

    if (dErr) throw new BadRequestException(dErr.message);

    return { client, deliveries: (deliveries ?? []) as DeliveryRow[] };
  }

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

  private buildInvoiceNumber(uploadId: string, clientId: string) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `FAC-${y}${m}${day}-${clientId.slice(0, 6)}-${uploadId.slice(0, 6)}`;
  }

  private safeFilename(name: string) {
    return name
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  private renderHtml(input: any) {
    const { issuer, client, invoiceNumber, deliveries, totals } = input;

    const formatMoney = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Number(n || 0),
      );

    const formatKm = (n: number) =>
      new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Number(n || 0),
      );

    const rows = deliveries
      .map((d: DeliveryRow, i: number) => {
        const date = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('fr-FR') : '—';
        const ref = d.id ?? `L${i + 1}`;
        const addr = d.destination_address ?? '—';
        const km = Number(d.distance_km ?? 0);
        const ht = Number(d.price_ht ?? 0);
        const ttc = Number(d.price_ttc ?? 0);
        const tva = ttc - ht;

        return `
          <tr>
            <td class="mono">${this.escapeHtml(ref)}</td>
            <td>${this.escapeHtml(date)}</td>
            <td>${this.escapeHtml(addr)}</td>
            <td class="right">${formatKm(km)} km</td>
            <td class="right">${formatMoney(ht)} €</td>
            <td class="right">${formatMoney(tva)} €</td>
            <td class="right">${formatMoney(ttc)} €</td>
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
          <th>Réf</th>
          <th>Date</th>
          <th>Adresse livraison</th>
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
      <div>
        <div><strong>Détails bancaires</strong></div>
        <div class="muted">Banque: ${this.escapeHtml(issuer.bank)}</div>
        <div class="muted">IBAN: ${this.escapeHtml(issuer.iban)}</div>
        <div class="muted">BIC: ${this.escapeHtml(issuer.bic)}</div>
      </div>
      <div class="muted" style="text-align:right; max-width: 280px;">
        Modèle MVP. À ajouter: mentions légales complètes, conditions, pénalités, etc.
      </div>
    </div>
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
