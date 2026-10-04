import type { Confidence, Unit, ValueStatus } from './types';

export type ConsumptionInput = {
  previous: number;
  current: number;
  start: Date;
  end: Date;
};

export type ConsumptionResult = {
  quantity: number;
  dailyAverage: number;
  days: number;
  /** l'index a régressé : compteur remplacé, correction ou erreur de saisie (§21) */
  anomaly: boolean;
  anomalyReason?: 'INDEX_DECREASED';
};

/**
 * calculateConsumption — moteur déterministe (flow.md §28).
 * Un index décroissant n'est JAMAIS corrigé ni supprimé silencieusement : la
 * valeur est conservée et signalée (§21).
 */
export function calculateConsumption(input: ConsumptionInput): ConsumptionResult {
  const msPerDay = 86_400_000;
  const days = Math.max(1, (input.end.getTime() - input.start.getTime()) / msPerDay);
  const raw = input.current - input.previous;
  const anomaly = raw < 0;
  // une régression ne doit jamais produire une consommation négative
  const quantity = Math.max(0, raw);
  return {
    quantity: round2(quantity),
    dailyAverage: round2(quantity / days),
    days: round2(days),
    anomaly,
    ...(anomaly ? { anomalyReason: 'INDEX_DECREASED' as const } : {}),
  };
}

export function calculateDailyAverage(quantity: number, days: number): number {
  return round2(quantity / Math.max(1, days));
}

export type Projection = {
  dailyAverage: number;
  projectedQuantity: number;
  projectedAmount: number | null;
  days: number;
  status: 'FORECAST';
  caveat: string;
};

/**
 * calculateMonthlyProjection — V1 sans ML (flow.md §29) :
 * moyenne journalière × jours restants. Toujours étiqueté « Projection ».
 */
export function calculateMonthlyProjection(input: {
  dailyAverage: number;
  days?: number;
  amountPerDay?: number | null;
}): Projection {
  const days = input.days ?? 30;
  const projectedQuantity = input.dailyAverage * days;
  return {
    dailyAverage: round2(input.dailyAverage),
    projectedQuantity: round2(projectedQuantity),
    projectedAmount: input.amountPerDay == null ? null : round2(input.amountPerDay * days),
    days,
    status: 'FORECAST',
    caveat:
      "Projection basée sur votre rythme récent. Ce n'est pas une prévision garantie et ce n'est pas une facture.",
  };
}

/** calculateTrend — variation en % entre deux valeurs de même unité. */
export function calculateTrend(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return round2(((current - previous) / previous) * 100);
}

/** calculateBaseline — moyenne des valeurs fournies, valeurs aberrantes exclues. */
export function calculateBaseline(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (valid.length === 0) return 0;
  return round2(valid.reduce((s, v) => s + v, 0) / valid.length);
}

/**
 * detectAnomaly — écart à la ligne de base au-delà d'un seuil relatif.
 * Renvoie une_ratio_de_déviation et non un verdict de fuite (§30).
 */
export function detectAnomaly(input: {
  value: number;
  baseline: number;
  thresholdRatio?: number;
}): { anomaly: boolean; ratio: number | null } {
  const threshold = input.thresholdRatio ?? 1.5;
  if (input.baseline <= 0) return { anomaly: false, ratio: null };
  const ratio = input.value / input.baseline;
  return { anomaly: ratio > threshold, ratio: round2(ratio) };
}

/** Valeur affichée + statut, pour garantir la distinction réel/estimé (§1, §51). */
export type LabelledValue = {
  value: number;
  status: ValueStatus;
  unit: Unit;
  confidence: Confidence;
};

export function labelElectricityKwh(input: {
  creditedKwh: number | null;
  estimatedKwh: number | null;
}): LabelledValue {
  if (input.creditedKwh != null) {
    return { value: round2(input.creditedKwh), status: 'REAL', unit: 'KWH', confidence: 'HIGH' };
  }
  return {
    value: round2(input.estimatedKwh ?? 0),
    status: 'ESTIMATE',
    unit: 'KWH',
    confidence: 'LOW',
  };
}

/** Appareil — flow.md §32 */
export type ApplianceType =
  | 'AC'
  | 'Fridge'
  | 'Freezer'
  | 'WaterHeater'
  | 'Pump'
  | 'TV'
  | 'Iron'
  | 'WashingMachine'
  | 'Other';

export const APPLIANCE_LABELS: Record<ApplianceType, string> = {
  AC: 'Climatisation',
  Fridge: 'Réfrigérateur',
  Freezer: 'Congélateur',
  WaterHeater: 'Chauffe-eau',
  Pump: 'Pompe',
  TV: 'Télévision',
  Iron: 'Fer à repasser',
  WashingMachine: 'Machine à laver',
  Other: 'Autre appareil',
};

export type Appliance = {
  type: ApplianceType;
  label: string;
  powerWatts: number;
  hoursPerDay: number;
  daysPerMonth: number;
};

export type ApplianceEstimate = {
  id: string;
  label: string;
  type: ApplianceType;
  powerWatts: number;
  hoursPerDay: number;
  daysPerMonth: number;
  /** kWh mensuels estimés — jamais présentés comme une mesure */
  monthlyKwh: number;
  /** coût mensuel estimé sous la grille applicable */
  monthlyCostTtc: number | null;
  /** part de la consommation estimée du logement */
  sharePercent: number;
  status: ValueStatus;
};

/**
 * flow.md §32 — consommation estimée d'un appareil :
 *
 *   kWh = (powerWatts / 1000) × hoursPerDay × daysPerMonth
 *
 * Le résultat est une ESTIMATION fondée sur l'usage déclaré par l'utilisateur.
 * Elle sert à comparer les appareils entre eux, pas à mesurer la consommation réelle.
 */
export function estimateApplianceKwh(a: Appliance): number {
  return round2((a.powerWatts / 1000) * a.hoursPerDay * a.daysPerMonth);
}

/**
 * Classe les appareils du logement par consommation estimée décroissante.
 *
 * `costPerKwh` permet de convertir en FCFA avec le coût effectif observé sur les
 * recharges réelles — jamais avec un prix réglementaire inventé (flow.md §18).
 */
export function estimateAppliances(
  appliances: (Appliance & { id: string })[],
  opts: { costPerKwh?: number | null } = {},
): ApplianceEstimate[] {
  const rows = appliances.map((a) => {
    const monthlyKwh = estimateApplianceKwh(a);
    return {
      id: a.id,
      label: a.label,
      type: a.type,
      powerWatts: a.powerWatts,
      hoursPerDay: a.hoursPerDay,
      daysPerMonth: a.daysPerMonth,
      monthlyKwh,
      monthlyCostTtc:
        opts.costPerKwh != null && opts.costPerKwh > 0
          ? round2(monthlyKwh * opts.costPerKwh)
          : null,
      sharePercent: 0,
      status: 'ESTIMATE' as const,
    };
  });

  const total = rows.reduce((s, r) => s + r.monthlyKwh, 0);
  return rows
    .map((r) => ({
      ...r,
      sharePercent: total > 0 ? round2((r.monthlyKwh / total) * 100) : 0,
    }))
    .sort((a, b) => b.monthlyKwh - a.monthlyKwh);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}