import type {
  BillBreakdown,
  Confidence,
  EligibilityInput,
  EligibilityResult,
  TariffRules,
  TariffScheme,
} from './types';

/** Seuil réglementaire de la grille (kWh par bimestre). */
export function resolveThreshold(rules: TariffRules, subscribedPower: number): number {
  const t1 = rules.tier1;
  if (t1.thresholdKwh != null) return t1.thresholdKwh;
  const hours = t1.multiplierHours ?? 180;
  // arrondi pour éviter les artefacts de virgule flottante (180 × 10 × 0.22)
  return Math.round(hours * (subscribedPower * 0.22) * 100) / 100;
}

/**
 * resolveTariff — déterministe, jamais d'IA (flow.md §4 et §13).
 * La grille s'applique selon catégorie + puissance + période, PAS selon le
 * mode de paiement : le prépaiement réutilise la grille ordinaire (§15).
 */
export function resolveTariff(
  schemes: TariffScheme[],
  input: { category: TariffScheme['category']; subscribedPower?: number; at?: Date | string },
): TariffScheme | null {
  const at = input.at ? new Date(input.at) : new Date();
  return (
    schemes
      .filter((s) => s.category === input.category)
      .filter((s) => new Date(s.effectiveFrom) <= at)
      .filter((s) => !s.effectiveTo || new Date(s.effectiveTo) > at)
      .filter((s) => (input.subscribedPower == null ? true : s.subscribedPower === input.subscribedPower))
      // version la plus élevée d'abord, puis entrée la plus récente
      .sort(
        (a, b) => b.version - a.version || +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom),
      )[0] ?? null
  );
}
/**
 * calculate — coût déterministe d'une consommation CIE.
 * Le résultat porte sa source et son statut : jamais présenté comme une facture
 * officielle par l'appelant (§1).
 */
export function calculate(
  kwh: number,
  scheme: TariffScheme,
  opts: { subscribedPower?: number; abidjan?: boolean } = {},
): BillBreakdown {
  const power = opts.subscribedPower ?? scheme.subscribedPower;
  const abidjan = opts.abidjan ?? true;
  const { rules } = scheme;
  const thresholdKwh = resolveThreshold(rules, power);

  const tier1Kwh = Math.min(Math.max(0, kwh), thresholdKwh);
  const tier2Kwh = Math.max(0, kwh - thresholdKwh);
  const energyTtc = tier1Kwh * rules.tier1.priceTtc + tier2Kwh * rules.tier2.priceTtc;

  const garbage = abidjan ? rules.taxes.garbageAbidjanPerKwh : rules.taxes.garbageOtherPerKwh;
  const perKwhTax = rules.taxes.ruralPerKwh + rules.taxes.RTIPerKwh + garbage;
  const taxesTtc = rules.taxes.ruralPerBimonthly + Math.max(0, kwh) * perKwhTax;

  const fixedTtc = rules.fixedBimonthlyTtc;
  const totalTtc = round2(energyTtc + taxesTtc + fixedTtc);

  return {
    schemeCode: scheme.code,
    schemeVersion: scheme.version,
    kwh: round2(kwh),
    thresholdKwh,
    tier1Kwh: round2(tier1Kwh),
    tier2Kwh: round2(tier2Kwh),
    energyTtc: round2(energyTtc),
    fixedTtc: round2(fixedTtc),
    taxesTtc: round2(taxesTtc),
    totalTtc,
    // coût effectif observé — ce n'est PAS le prix réglementaire du kWh (§18)
    effectiveCostPerKwh: kwh > 0 ? round2(totalTtc / kwh) : 0,
    status: 'CALCULATED',
    source: scheme.source,
  };
}
/**
 * reverseEstimate — quantité de kWh correspondant à un montant payé.
 *
 * Le seuil bimestriel rend la fonction non linéaire (prime fixe + deux tranches
 * + taxes par kWh) : on résout donc par dichotomie sur le coût total, qui est
 * monotone croissant en kWh. Déterministe, 60 itérations, précision < 0.001 kWh.
 */
export function reverseEstimate(
  amountTtc: number,
  scheme: TariffScheme,
  opts: { subscribedPower?: number; abidjan?: boolean } = {},
): { kwh: number; confidence: Confidence; status: 'ESTIMATE'; assumption: string } {
  if (amountTtc <= 0) {
    return { kwh: 0, confidence: 'LOW', status: 'ESTIMATE', assumption: 'Montant nul ou négatif.' };
  }
  const cost = (k: number) => calculate(k, scheme, opts).totalTtc;
  // borne haute : le seuil seul suffit rarement, on double jusqu'à couvrir le montant
  let hi = 1;
  while (cost(hi) < amountTtc && hi < 1_000_000) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cost(mid) < amountTtc) lo = mid;
    else hi = mid;
  }
  return {
    kwh: round2((lo + hi) / 2),
    confidence: 'LOW',
    status: 'ESTIMATE',
    assumption:
      'Estimation déterministe à partir du montant payé, sous la grille CIE applicable. Le coût effectif observé peut différer du prix réglementaire.',
  };
}

/** estimate — alias explicite de reverseEstimate, conforme à l’API §13. */
export const estimate = reverseEstimate;

/**
 * validateEligibility — règles d'éligibilité au tarif social (flow.md §17).
 *
 * Contrainte forte : ne JAMAIS affirmer un changement officiel de tarif, on
 * invite à vérifier sa situation auprès de CIE.
 */
export function validateEligibility(scheme: TariffScheme, input: EligibilityInput): EligibilityResult {
  if (scheme.category !== 'DOMESTIC_SOCIAL') {
    return {
      status: 'UNKNOWN_SCHEME',
      message:
        "Cette grille ne relève pas du tarif domestique social. Vérifiez votre situation auprès de CIE.",
    };
  }
  if (input.usageType !== 'DOMESTIC') {
    return {
      status: 'UNKNOWN_SCHEME',
      message:
        "L'éligibilité au tarif social dépend de l'usage. Vérifiez votre situation auprès de CIE.",
    };
  }

  const thresholdKwh = input.thresholdKwh ?? resolveThreshold(scheme.rules, input.subscribedPower);
  const minDays = input.minimumObservationPeriodDays ?? 60;
  const avg = input.averageMonthlyConsumption;

  if (avg == null || (input.observationDays ?? 0) < minDays) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: `Historique insuffisant pour conclure. Continuez à enregistrer vos recharges et vos relevés pendant au moins ${minDays} jours.`,
      thresholdKwh,
    };
  }

  if (avg * 2 > thresholdKwh) {
    return {
      status: 'ABOVE_THRESHOLD',
      message:
        "Votre historique dépasse le seuil associé à votre régime actuel. Vérifiez votre situation auprès de CIE.",
      averageMonthlyConsumption: round2(avg),
      thresholdKwh,
    };
  }

  return {
    status: 'ELIGIBLE',
    message:
      'Votre consommation observée reste sous le seuil de la grille sociale. Ce constat est indicatif et ne vaut pas confirmation de CIE.',
    averageMonthlyConsumption: round2(avg),
    thresholdKwh,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
