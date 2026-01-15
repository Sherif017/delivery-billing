import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

export interface ParsedDelivery {
  type: string;
  warehouse: string;
  warehouseAddress: string;
  driver: string;
  taskId: string;
  date: string;
  progress: string;
  status: string;
  route: string;
  sequence: string;
  startTime: string;
  endTime: string;
  clientName: string;
  number: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

@Injectable()
export class UploadService {
  // 🔒 Normalisation robuste des headers (accents/casse/espaces)
  private normalizeHeader(s: string) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // retire accents
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  // 🔎 Récupère une valeur avec tolérance sur le nom de colonne
  private pick(row: Record<string, any>, candidates: string[]) {
    if (!row) return '';

    // accès direct si clé exacte
    for (const k of candidates) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }

    // fallback via mapping normalisé
    const keys = Object.keys(row);
    const map = new Map<string, string>();
    for (const k of keys) map.set(this.normalizeHeader(k), k);

    for (const k of candidates) {
      const nk = this.normalizeHeader(k);
      const realKey = map.get(nk);
      if (realKey) {
        const v = row[realKey];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
    }

    return '';
  }

  private normalizeNumber(v: any): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    // 19.0 -> 19
    return s.replace(/\.0$/, '');
  }

  private normalizeCountry(v: any): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (s.toUpperCase() === 'FRA') return 'France';
    return s;
  }

  private asText(v: any): string {
    return String(v ?? '').trim();
  }

  private looksLikeAddress(s: string): boolean {
    const t = String(s ?? '').trim();
    if (!t) return false;
    // heuristique simple : contient un numéro + mot, ou une virgule, ou un code postal
    return /\d/.test(t) && (/,/.test(t) || /\b\d{5}\b/.test(t) || t.length > 10);
  }

  parseExcelFile(filePath: string): ParsedDelivery[] {
    try {
      const workbook = XLSX.readFile(filePath, { codepage: 65001 });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const rawData: any[] = XLSX.utils.sheet_to_json(sheet, {
        raw: false,
        defval: '',
      });

      console.log(`📊 Fichier parsé : ${rawData.length} lignes`);

      const deliveries: ParsedDelivery[] = rawData.map((row) => {
        const type = this.asText(this.pick(row, [
          'Type de Service',
          'Service',
          'Service type',
          'service_type',
          'type',
          'Type',
        ]));

        const warehouse = this.asText(this.pick(row, [
          'Entrepôt',
          'Entrepot',
          'Warehouse',
          'Magasin',
          'Depot',
          'Dépôt',
        ]));

        // ✅ ici est LE fix principal : beaucoup plus de variantes possibles
        let warehouseAddress = this.asText(this.pick(row, [
          'adresses magasin',
          'adresses magasins',
          'adresse magasin',
          'adresse magasins',
          'adresse entrepot',
          'adresse entrepôt',
          'adresse depot',
          'adresse dépôt',
          'adresse warehouse',
          'warehouse address',
          'origin address',
          'adresse de depart',
          'adresse de départ',
          'adresse depart',
          'depart adresse',
          'départ',
          'depart',
          'entrepot adresse',
          'entrepôt adresse',
        ]));

        // fallback : parfois l’adresse est dans la colonne "Entrepôt"
        if (!warehouseAddress && this.looksLikeAddress(warehouse)) {
          warehouseAddress = warehouse;
        }

        const driver = this.asText(this.pick(row, ['Livreur', 'Driver', 'Chauffeur']));
        const taskId = this.asText(this.pick(row, [
          'ID de la tâche',
          'ID tâche',
          'ID tache',
          'Task ID',
          'task_id',
          'taskid',
          'id',
          'ID',
        ]));
        const date = this.asText(this.pick(row, ['Date', 'date']));
        const progress = this.asText(this.pick(row, ['Avancement', 'Progress', 'progress']));
        const status = this.asText(this.pick(row, ['Statut', 'Status', 'status']));
        const route = this.asText(this.pick(row, ['Tournée', 'Tournee', 'Route', 'route']));
        const sequence = this.asText(this.pick(row, ['Séquence', 'Sequence', 'sequence']));
        const startTime = this.asText(this.pick(row, ['Début', 'Debut', 'Start', 'start']));
        const endTime = this.asText(this.pick(row, ['Fin', 'End', 'end']));

        const clientName = this.asText(this.pick(row, [
          'Représentant du client',
          'Representant du client',
          'Client',
          'Nom client',
          'Destinataire',
          'Customer',
          'customer',
          'client_name',
        ]));

        const number = this.normalizeNumber(this.pick(row, ['Numéro', 'Numero', 'number', 'No']));
        const street = this.asText(this.pick(row, ['Rue', 'Street', 'street']));
        const postalCode = this.asText(this.pick(row, ['Code postal', 'CP', 'Postal code', 'postal_code']));
        const city = this.asText(this.pick(row, ['Ville', 'City', 'city']));
        const country = this.normalizeCountry(this.pick(row, ['Pays', 'Country', 'country']));

        return {
          type,
          warehouse,
          warehouseAddress,
          driver,
          taskId,
          date,
          progress,
          status,
          route,
          sequence,
          startTime,
          endTime,
          clientName,
          number,
          street,
          postalCode,
          city,
          country,
        };
      });

      // ✅ filtre plus intelligent :
      // on garde si clientName présent OU si on a une adresse destination exploitable
      const validDeliveries = deliveries.filter((d) => {
        const hasClient = d.clientName && d.clientName.trim() !== '';
        const hasDest = (d.street || d.postalCode || d.city) && (d.country || d.city);
        return hasClient || hasDest;
      });

      console.log(
        `✅ ${validDeliveries.length} livraisons extraites (${deliveries.length - validDeliveries.length} lignes vides ignorées)`,
      );

      // Debug léger : combien n’ont pas d’origine
      const missingOrigin = validDeliveries.filter((d) => !d.warehouseAddress.trim()).length;
      if (missingOrigin > 0) {
        console.warn(`⚠️ ${missingOrigin} ligne(s) sans warehouseAddress (origine) — vérifier les headers du fichier.`);
      }

      return validDeliveries;
    } catch (error: any) {
      console.error('❌ Erreur parsing Excel:', error);
      throw new Error(`Erreur lors du parsing du fichier: ${error.message}`);
    }
  }

  parseCSVFile(filePath: string): ParsedDelivery[] {
    try {
      const fileContent = fs.readFileSync(filePath, { encoding: 'utf-8' });

      const lines = fileContent.split('\n');
      const headers = lines[0].split(';').map((h) => h.trim());

      console.log(`📊 Headers détectés:`, headers);

      const deliveries: ParsedDelivery[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(';');

        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });

        const warehouse = this.asText(this.pick(row, [
          'Entrepôt',
          'Entrepot',
          'Warehouse',
          'Magasin',
          'Depot',
          'Dépôt',
        ]));

        let warehouseAddress = this.asText(this.pick(row, [
          'adresses magasin',
          'adresses magasins',
          'adresse magasin',
          'adresse magasins',
          'adresse entrepot',
          'adresse entrepôt',
          'adresse depot',
          'adresse dépôt',
          'adresse warehouse',
          'warehouse address',
          'origin address',
          'adresse de depart',
          'adresse de départ',
          'adresse depart',
          'depart adresse',
          'départ',
          'depart',
          'entrepot adresse',
          'entrepôt adresse',
        ]));

        if (!warehouseAddress && this.looksLikeAddress(warehouse)) {
          warehouseAddress = warehouse;
        }

        deliveries.push({
          type: this.asText(this.pick(row, ['Type de Service', 'Service', 'service_type', 'type'])),
          warehouse,
          warehouseAddress,
          driver: this.asText(this.pick(row, ['Livreur', 'Driver', 'Chauffeur'])),
          taskId: this.asText(this.pick(row, ['ID de la tâche', 'ID tâche', 'Task ID', 'task_id', 'id'])),
          date: this.asText(this.pick(row, ['Date'])),
          progress: this.asText(this.pick(row, ['Avancement'])),
          status: this.asText(this.pick(row, ['Statut'])),
          route: this.asText(this.pick(row, ['Tournée', 'Route'])),
          sequence: this.asText(this.pick(row, ['Séquence', 'Sequence'])),
          startTime: this.asText(this.pick(row, ['Début', 'Start'])),
          endTime: this.asText(this.pick(row, ['Fin', 'End'])),
          clientName: this.asText(this.pick(row, ['Représentant du client', 'Client', 'Destinataire', 'client_name'])),
          number: this.normalizeNumber(this.pick(row, ['Numéro', 'Numero', 'number'])),
          street: this.asText(this.pick(row, ['Rue', 'Street'])),
          postalCode: this.asText(this.pick(row, ['Code postal', 'CP', 'postal_code'])),
          city: this.asText(this.pick(row, ['Ville', 'City'])),
          country: this.normalizeCountry(this.pick(row, ['Pays', 'Country'])),
        });
      }

      const validDeliveries = deliveries.filter((d) => {
        const hasClient = d.clientName && d.clientName.trim() !== '';
        const hasDest = (d.street || d.postalCode || d.city) && (d.country || d.city);
        return hasClient || hasDest;
      });

      console.log(
        `✅ ${validDeliveries.length} livraisons extraites du CSV (${deliveries.length - validDeliveries.length} lignes vides ignorées)`,
      );

      const missingOrigin = validDeliveries.filter((d) => !d.warehouseAddress.trim()).length;
      if (missingOrigin > 0) {
        console.warn(`⚠️ ${missingOrigin} ligne(s) sans warehouseAddress (origine) — vérifier les headers du CSV.`);
      }

      return validDeliveries;
    } catch (error: any) {
      console.error('❌ Erreur parsing CSV:', error);
      throw new Error(`Erreur lors du parsing du CSV: ${error.message}`);
    }
  }

  buildFullAddress(delivery: ParsedDelivery): string {
    const parts = [
      this.normalizeNumber(delivery.number),
      String(delivery.street ?? '').trim(),
      String(delivery.postalCode ?? '').trim(),
      String(delivery.city ?? '').trim(),
      this.normalizeCountry(delivery.country),
    ].filter((p) => p && String(p).trim() !== '');

    // aide Google : si pays absent, rajoute France
    const s = parts.join(', ');
    if (s && !/france/i.test(s)) {
      // si aucun pays détecté mais on a une ville/cp, ajoute France
      const hasCountry = Boolean(String(delivery.country ?? '').trim());
      if (!hasCountry) return `${s}, France`;
    }
    return s;
  }
}
