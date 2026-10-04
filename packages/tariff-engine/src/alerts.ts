import { calculateBaseline, calculateTrend, detectAnomaly } from './consumption';

export type AlertType =
  | 'HIGH_CONSUMPTION'
  | 'RAPID_INCREASE'
  | 'RAPID_DECREASE'
  | 'WATER_RAPID_INCREASE'
  | 'POSSIBLE_WATER_LEAK'
  | 'MISSING_READING'
  | 'INVALID_READING'
  | 'HIGH_SPENDING';

export type Alert = {
  type: AlertType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string;
  /** toujours formulé comme une vérification, jamais comme un verdict (§30) */
  actionable: boolean;
};

export type AlertInput = {
  /** consommation d’eau par période, du plus ancien au plus récent */
  waterPeriodQuantities: number[];
  waterLastReadingDaysAgo?: number;
  indexJustDecreased?: boolean;
  electricityDailyAverageHistory: number[];
  electricitySpentThisMonth?: number;
  electricitySpentPreviousMonth?: number;
  budgetMonthly?: number | null;
};

/**
 * generateAlerts — moteur déterministe, maximum 3 alertes (flow.md §30-31).
 * Formulation prudente : « Vérifiez… » et jamais « Vous avez une fuite ».
 */
export function generateAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];

  const water = input.waterPeriodQuantities.filter((q) => q > 0);
  if (water.length >= 3) {
    const baseline = calculateBaseline(water.slice(0, -1));
    const { anomaly } = detectAnomaly({
      value: water[water.length - 1],
      baseline,
      thresholdRatio: 1.5,
    });
    if (anomaly) {
      alerts.push({
        type: 'POSSIBLE_WATER_LEAK',
        severity: 'WARNING',
        title: 'Consommation d’eau inhabituelle',
        body: 'Votre consommation d’eau est inhabituellement élevée par rapport à vos périodes précédentes. Vérifiez les robinets, chasses d’eau, réservoirs et éventuelles fuites.',
        actionable: true,
      });
    }
    const waterTrend = calculateTrend(water[water.length - 1], water[water.length - 2]);
    if (waterTrend != null && waterTrend >= 25) {
      alerts.push({
        type: 'WATER_RAPID_INCREASE',
        severity: 'WARNING',
        title: 'Votre consommation d’eau augmente',
        body: 'Vérifiez les robinets et les chasses d’eau.',
        actionable: true,
      });
    }
  }

  if (input.indexJustDecreased) {
    alerts.push({
      type: 'INVALID_READING',
      severity: 'INFO',
      title: 'Index inhabituel',
      body: 'Le nouvel index est inférieur au précédent. Le compteur a-t-il été remplacé, réinitialisé ou corrigé ?',
      actionable: false,
    });
  }

  if (input.waterLastReadingDaysAgo != null && input.waterLastReadingDaysAgo >= 45) {
    const days = Math.round(input.waterLastReadingDaysAgo);
    alerts.push({
      type: 'MISSING_READING',
      severity: 'INFO',
      title: 'Relevé SODECI manquant',
      body: `Votre dernier relevé date de ${days} jours. Ajoutez-en un pour maintenir vos projections à jour.`,
      actionable: true,
    });
  }

const elec = input.electricityDailyAverageHistory.filter((n) => n > 0);
  if (elec.length >= 3) {
    const trend = calculateTrend(elec[elec.length - 1], calculateBaseline(elec.slice(0, -1)));
    if (trend != null && trend >= 25) {
      alerts.push({
        type: 'RAPID_INCREASE',
        severity: 'WARNING',
        title: 'Votre consommation électrique augmente',
        body: 'Vérifiez les appareils à forte puissance : climatisation, ballon d’eau chaude, machine à laver.',
        actionable: true,
      });
    }
  }

  if (input.budgetMonthly != null && (input.electricitySpentThisMonth ?? 0) > input.budgetMonthly) {
    alerts.push({
      type: 'HIGH_SPENDING',
      severity: 'CRITICAL',
      title: 'Dépense au-dessus du budget',
      body: `Vos recharges CIE dépassent votre budget mensuel de ${Math.round(input.budgetMonthly)} FCFA.`,
      actionable: true,
    });
  } else {
    const spentTrend = calculateTrend(input.electricitySpentThisMonth ?? 0, input.electricitySpentPreviousMonth ?? 0);
    if (spentTrend != null && spentTrend >= 30 && (input.electricitySpentThisMonth ?? 0) > 0) {
      alerts.push({
        type: 'HIGH_SPENDING',
        severity: 'WARNING',
        title: 'Dépense en hausse',
        body: `Vos recharges sont en hausse de ${spentTrend.toFixed(1)} % par rapport au mois précédent.`,
        actionable: true,
      });
    }
  }

  return alerts.slice(0, 3);
}
export type Recommendation = {
  id: string;
  title: string;
  body: string;
  /** la recommandation doit être justifiée par les données, pas générique (§31) */
  basis: string;
};

/** buildRecommendations — maximum 3, toutes justifiées par des données réelles (§31). */
export function buildRecommendations(input: {
  hasPurchaseWithKwh: boolean;
  hasPurchase: boolean;
  hasWaterReading: boolean;
  waterTrend?: number | null;
  electricityTrend?: number | null;
  alerts: Alert[];
}): Recommendation[] {
  const recs: Recommendation[] = [];

  if (!input.hasPurchase) {
    recs.push({
      id: 'first-purchase',
      title: 'Commencez par une recharge',
      body: 'Ajoutez votre première recharge CIE pour suivre vos dépenses réelles.',
      basis: 'Aucune recharge enregistrée.',
    });
  } else if (!input.hasPurchaseWithKwh) {
    recs.push({
      id: 'record-kwh',
      title: 'Suivez vos recharges',
      body: 'Enregistrez chaque recharge avec les kWh crédités si le reçu les indique : vos calculs deviennent beaucoup plus fiables.',
      basis: 'Recharges saisies sans kWh crédités.',
    });
  }

  if (!input.hasWaterReading) {
    recs.push({
      id: 'first-reading',
      title: 'Ajoutez votre premier relevé SODECI',
      body: 'Sans relevé, votre consommation d’eau ne peut pas être calculée.',
      basis: 'Aucun relevé d’index enregistré.',
    });
  } else if (input.waterTrend != null && input.waterTrend >= 15) {
    recs.push({
      id: 'water-up',
      title: 'Votre consommation d’eau augmente',
      body: 'Vérifiez les robinets et les chasses d’eau.',
      basis: `Hausse de ${input.waterTrend.toFixed(1)} % vs période précédente.`,
    });
  }

  if (input.electricityTrend != null && input.electricityTrend >= 15) {
    recs.push({
      id: 'electricity-up',
      title: 'Votre consommation électrique augmente',
      body: 'Vérifiez les appareils à forte puissance et ceux qui fonctionnent longtemps.',
      basis: `Hausse de ${input.electricityTrend.toFixed(1)} % vs période précédente.`,
    });
  }

  if (recs.length === 0) {
    const alert = input.alerts[0];
    recs.push({
      id: 'on-track',
      title: 'Votre suivi est à jour',
      body: alert
        ? alert.body
        : 'Continuez à enregistrer vos recharges et vos relevés : plus vos données sont précises, plus vos projections le seront.',
      basis: alert ? `Alerte active : ${alert.type}.` : 'Aucune anomalie détectée sur les données disponibles.',
    });
  }

  return recs.slice(0, 3);
}