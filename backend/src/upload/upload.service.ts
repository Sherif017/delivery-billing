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

  parseExcelFile(filePath: string): ParsedDelivery[] {
    try {
      // Lire le fichier
      const workbook = XLSX.readFile(filePath, { codepage: 65001 });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convertir en JSON
      const rawData: any[] = XLSX.utils.sheet_to_json(sheet, {
        raw: false,
        defval: '',
      });

      console.log(`📊 Fichier parsé : ${rawData.length} lignes`);

      // Mapper les données (✅ même logique, mais headers tolérants)
      const deliveries: ParsedDelivery[] = rawData.map((row) => ({
        type: this.pick(row, ['Type de Service']) || '',
        warehouse: this.pick(row, ['Entrepôt']) || '',
        // ✅ accepte "adresses magasin" ET "adresses magasins" (+ variations)
        warehouseAddress: this.pick(row, ['adresses magasin', 'adresses magasins']) || '',
        driver: this.pick(row, ['Livreur']) || '',
        taskId: this.pick(row, ['ID de la tâche']) || '',
        date: this.pick(row, ['Date']) || '',
        progress: this.pick(row, ['Avancement']) || '',
        status: this.pick(row, ['Statut']) || '',
        route: this.pick(row, ['Tournée']) || '',
        sequence: this.pick(row, ['Séquence']) || '',
        startTime: this.pick(row, ['Début']) || '',
        endTime: this.pick(row, ['Fin']) || '',
        clientName: this.pick(row, ['Représentant du client']) || '',
        number: this.pick(row, ['Numéro']) || '',
        street: this.pick(row, ['Rue']) || '',
        postalCode: this.pick(row, ['Code postal']) || '',
        city: this.pick(row, ['Ville']) || '',
        country: this.pick(row, ['Pays']) || '',
      }));

      // NE FILTRER QUE les lignes complètement vides (pas de client du tout)
      const validDeliveries = deliveries.filter(
        (d) => d.clientName && d.clientName.trim() !== '',
      );

      console.log(
        `✅ ${validDeliveries.length} livraisons extraites (${deliveries.length - validDeliveries.length} lignes vides ignorées)`,
      );

      return validDeliveries;
    } catch (error: any) {
      console.error('❌ Erreur parsing Excel:', error);
      throw new Error(`Erreur lors du parsing du fichier: ${error.message}`);
    }
  }

  parseCSVFile(filePath: string): ParsedDelivery[] {
    try {
      const fileContent = fs.readFileSync(filePath, { encoding: 'utf-8' });

      // Parser CSV avec séparateur point-virgule
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

        deliveries.push({
          type: this.pick(row, ['Type de Service']) || '',
          warehouse: this.pick(row, ['Entrepôt']) || '',
          warehouseAddress: this.pick(row, ['adresses magasin', 'adresses magasins']) || '',
          driver: this.pick(row, ['Livreur']) || '',
          taskId: this.pick(row, ['ID de la tâche']) || '',
          date: this.pick(row, ['Date']) || '',
          progress: this.pick(row, ['Avancement']) || '',
          status: this.pick(row, ['Statut']) || '',
          route: this.pick(row, ['Tournée']) || '',
          sequence: this.pick(row, ['Séquence']) || '',
          startTime: this.pick(row, ['Début']) || '',
          endTime: this.pick(row, ['Fin']) || '',
          clientName: this.pick(row, ['Représentant du client']) || '',
          number: this.pick(row, ['Numéro']) || '',
          street: this.pick(row, ['Rue']) || '',
          postalCode: this.pick(row, ['Code postal']) || '',
          city: this.pick(row, ['Ville']) || '',
          country: this.pick(row, ['Pays']) || '',
        });
      }

      // NE FILTRER QUE les lignes complètement vides (pas de client du tout)
      const validDeliveries = deliveries.filter(
        (d) => d.clientName && d.clientName.trim() !== '',
      );

      console.log(
        `✅ ${validDeliveries.length} livraisons extraites du CSV (${deliveries.length - validDeliveries.length} lignes vides ignorées)`,
      );

      return validDeliveries;
    } catch (error: any) {
      console.error('❌ Erreur parsing CSV:', error);
      throw new Error(`Erreur lors du parsing du CSV: ${error.message}`);
    }
  }

  buildFullAddress(delivery: ParsedDelivery): string {
    const parts = [
      delivery.number,
      delivery.street,
      delivery.postalCode,
      delivery.city,
      delivery.country,
    ].filter((p) => p);

    return parts.join(', ');
  }
}
