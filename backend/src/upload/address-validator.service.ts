import { Injectable } from '@nestjs/common';

export type AddressValidationResult = {
  isValid: boolean;
  cleanedAddress: string;
  issues: string[];
};

@Injectable()
export class AddressValidatorService {
  validateAddress(
    number: string,
    street: string,
    postalCode: string,
    city: string,
    country: string,
  ): AddressValidationResult {
    const issues: string[] = [];

    const n = (number ?? '').toString().trim();
    const s = (street ?? '').toString().trim();
    const pc = (postalCode ?? '').toString().trim();
    const c = (city ?? '').toString().trim();
    const co = (country ?? '').toString().trim();

    // ----------------------------
    // Règles : numéro OBLIGATOIRE
    // ----------------------------
    if (!n) {
      issues.push('NUMERO_MANQUANT');
    } else {
      // autorise "10", "10 bis", "10B", "12 ter", "5A" etc.
      // On exige au moins un chiffre au début
      if (!/^\d+([a-zA-Z]|\s*(bis|ter|quater))?$/i.test(n)) {
        // On reste permissif: si ça commence par des chiffres, on accepte quand même
        if (!/^\d+/.test(n)) {
          issues.push('NUMERO_INVALIDE');
        }
      }
    }

    // ----------------------------
    // Règles : rue obligatoire
    // ----------------------------
    if (!s) {
      issues.push('RUE_MANQUANTE');
    } else {
      if (s.length < 3) issues.push('RUE_TROP_COURTE');

      // Rue uniquement chiffres => suspect
      if (/^\d+$/.test(s)) issues.push('RUE_INVALIDE');

      // Rue trop générique seule ("Rue", "Avenue", ...)
      const normalized = s.toLowerCase().replace(/\./g, '').trim();
      const generic = new Set(['rue', 'avenue', 'av', 'boulevard', 'bd', 'route', 'chemin', 'impasse']);
      if (generic.has(normalized)) issues.push('RUE_TROP_GENERIQUE');
    }

    // ----------------------------
    // Code postal (FR strict)
    // ----------------------------
    if (!pc) {
      issues.push('CODE_POSTAL_MANQUANT');
    } else {
      // format FR: 5 chiffres
      if (!/^\d{5}$/.test(pc)) issues.push('CODE_POSTAL_INVALIDE');
    }

    // ----------------------------
    // Ville obligatoire
    // ----------------------------
    if (!c) {
      issues.push('VILLE_MANQUANTE');
    } else if (c.length < 2) {
      issues.push('VILLE_TROP_COURTE');
    }

    // ----------------------------
    // Pays : optionnel mais recommandé
    // (on ne bloque pas si vide)
    // ----------------------------
    // Si tu veux rendre le pays obligatoire plus tard:
    // if (!co) issues.push('PAYS_MANQUANT');

    const cleanedAddress = this.buildCleanedAddress(n, s, pc, c, co);

    return {
      isValid: issues.length === 0,
      cleanedAddress,
      issues,
    };
  }

  private buildCleanedAddress(
    number: string,
    street: string,
    postalCode: string,
    city: string,
    country: string,
  ) {
    // On construit l’adresse propre même si invalide, pour affichage UI
    const parts = [number, street, postalCode, city, country]
      .map((p) => (p ?? '').toString().trim())
      .filter((p) => p.length > 0);

    return parts.join(', ');
  }
}
