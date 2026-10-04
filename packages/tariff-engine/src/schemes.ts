import type { TariffScheme } from './types';

/**
 * Grilles CIE publiées. Ces constantes servent de référence de seed vers la base
 * (flow.md §16 « ne pas hardcoder dans le frontend », §49 « administrables sans
 * modifier le frontend »). La base reste la source de vérité à l'exécution.
 *
 * ANARE : il n'existe pas de grille prépayée distincte ; la grille des
 * compteurs ordinaires s'applique au prépaiement (flow.md §15).
 */

export const CIE_SOURCE_2023 = {
  sourceUrl: 'https://www.cie.ci/particuliers/tarifs-electricite',
  sourceName: "CIE — Tarifs d'électricité",
  documentReference: 'Grille tarifs domestiques CIE, applicable depuis le 27/12/2023',
  verifiedAt: '2023-12-27T00:00:00.000Z',
} as const;

export const CIE_DOMESTIC_SOCIAL_5A: TariffScheme = {
  code: 'CIE-DOM-SOCIAL-5A',
  version: 1,
  provider: 'CIE',
  category: 'DOMESTIC_SOCIAL',
  subscribedPower: 5,
  effectiveFrom: '2023-12-27',
  effectiveTo: null,
  source: CIE_SOURCE_2023,
  rules: {
    fixedBimonthlyTtc: 614.9,
    tier1: { priceTtc: 31.72, thresholdKwh: 80 },
    tier2: { priceTtc: 65.11 },
    taxes: {
      ruralPerBimonthly: 100,
      ruralPerKwh: 1,
      RTIPerKwh: 2,
      garbageAbidjanPerKwh: 2.5,
      garbageOtherPerKwh: 1,
    },
  },
};

export const CIE_DOMESTIC_GENERAL_5A: TariffScheme = {
  code: 'CIE-DOM-GENERAL-5A',
  version: 1,
  provider: 'CIE',
  category: 'DOMESTIC_GENERAL',
  subscribedPower: 5,
  effectiveFrom: '2023-12-27',
  effectiveTo: null,
  source: CIE_SOURCE_2023,
  rules: {
    fixedBimonthlyTtc: 1618.04,
    // seuil = multiplierHours × (puissance × 0.22) = 180 × 1.1 = 198 kWh
    tier1: { priceTtc: 86.92, multiplierHours: 180 },
    tier2: { priceTtc: 75.34 },
    taxes: {
      ruralPerBimonthly: 100,
      ruralPerKwh: 1.06,
      RTIPerKwh: 2,
      garbageAbidjanPerKwh: 2.5,
      garbageOtherPerKwh: 1,
    },
  },
};

export const CIE_SCHEMES: TariffScheme[] = [CIE_DOMESTIC_SOCIAL_5A, CIE_DOMESTIC_GENERAL_5A];

export function toJsonRules(scheme: TariffScheme) {
  return scheme.rules as unknown as Record<string, unknown>;
}