import { db } from './db';
import {
  buildRecommendations,
  calculateConsumption,
  calculateMonthlyProjection,
  calculateTrend,
  generateAlerts,
  labelElectricityKwh,
  resolveTariff,
  type Alert,
  type Recommendation,
  type TariffScheme,
  type ValueStatus,
} from '@conso-ci/tariff-engine';

// ---------- Tarifs (la base est la source de vérité, §16 et §49) ----------

/**
 * Reconstruit une TariffScheme à partir de la base.
 *
 * flow.md §49 : les tarifs sont administrables sans modifier le front. On lit
 * donc les règles ligne par ligne (table TariffRule) au lieu de les écrire en
 * dur dans le code.
 */
export async function loadTariffs(): Promise<TariffScheme[]> {
  const rows = await db.tariffScheme.findMany({
    include: { rules: { orderBy: { position: 'asc' } } },
    orderBy: { version: 'desc' },
  });

  return rows.map((r) => {
    const num = (kind: string): number => Number(r.rules.find((x) => x.kind === kind)?.value ?? 0);
    const has = (kind: string): boolean => r.rules.some((x) => x.kind === kind);

    return {
      code: r.code,
      version: r.version,
      provider: r.provider,
      category: r.category as TariffScheme['category'],
      subscribedPower: r.subscribedPower,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      source: {
        sourceUrl: r.sourceUrl,
        sourceName: r.sourceName,
        documentReference: r.documentReference,
        verifiedAt: (r.verifiedAt ?? r.effectiveFrom).toISOString(),
      },
      rules: {
        fixedBimonthlyTtc: num('FIXED_BIMONTHLY'),
        tier1: {
          priceTtc: num('TIER1_PRICE'),
          ...(has('TIER1_THRESHOLD_KWH') ? { thresholdKwh: num('TIER1_THRESHOLD_KWH') } : {}),
          ...(has('TIER1_MULTIPLIER_HOURS') ? { multiplierHours: num('TIER1_MULTIPLIER_HOURS') } : {}),
        },
        tier2: { priceTtc: num('TIER2_PRICE') },
        taxes: {
          ruralPerBimonthly: num('TAX_RURAL_BIMONTHLY'),
          ruralPerKwh: num('TAX_RURAL_KWH'),
          RTIPerKwh: num('TAX_RTI_KWH'),
          garbageAbidjanPerKwh: num('TAX_GARBAGE_ABIDJAN_KWH'),
          garbageOtherPerKwh: num('TAX_GARBAGE_OTHER_KWH'),
        },
      },
    } satisfies TariffScheme;
  });
}

/** Grille applicable à un compteur CIE. Le prépaiement réutilise la grille ordinaire (§15). */
export async function resolveMeterTariff(input: {
  subscribedPower?: number | null;
  category?: 'DOMESTIC_SOCIAL' | 'DOMESTIC_GENERAL';
  at?: Date;
}): Promise<TariffScheme | null> {
  const tariffs = await loadTariffs();
  return resolveTariff(tariffs, {
    category: input.category ?? 'DOMESTIC_SOCIAL',
    subscribedPower: input.subscribedPower ?? undefined,
    at: input.at,
  });
}

// ---------- Ajout d'un relevé : crée la période de consommation ----------

export async function addReading(input: {
  meterId: string;
  value: number;
  unit: 'KWH' | 'M3' | 'FCFA' | 'UNKNOWN';
  readingType: 'INDEX' | 'CREDIT' | 'ENERGY_AVAILABLE' | 'UNKNOWN';
  readingDate?: string;
  note?: string;
}) {
  const meter = await db.meter.findUnique({ where: { id: input.meterId } });
  if (!meter) throw new Error('Compteur introuvable.');
  if (!meter.active) throw new Error('Ce compteur est désactivé.');

  const readingDate = input.readingDate ? new Date(input.readingDate) : new Date();
  const reading = await db.meterReading.create({
    data: {
      meterId: input.meterId,
      value: input.value,
      unit: input.unit,
      readingType: input.readingType,
      readingDate,
      note: input.note,
      source: 'MANUAL',
      confidence: input.readingType === 'UNKNOWN' ? 'LOW' : 'HIGH',
    },
  });

  // Seuls les relevés d'INDEX alimentent un calcul déterministe (§10 et §2).
  if (input.readingType !== 'INDEX') return { reading, period: null };

  const previous = await db.meterReading.findFirst({
    where: { meterId: input.meterId, id: { not: reading.id }, readingType: 'INDEX', readingDate: { lt: readingDate } },
    orderBy: { readingDate: 'desc' },
  });
  if (!previous) return { reading, period: null };

  const result = calculateConsumption({
    previous: previous.value,
    current: input.value,
    start: previous.readingDate,
    end: readingDate,
  });

  // flow.md §21 — un index régressif est conservé et signalé, jamais supprimé
  const period = await db.consumptionPeriod.create({
    data: {
      meterId: input.meterId,
      startDate: previous.readingDate,
      endDate: readingDate,
      startValue: previous.value,
      endValue: input.value,
      quantity: result.quantity,
      dailyAverage: result.dailyAverage,
      anomaly: result.anomaly,
      anomalyNote: result.anomaly
        ? 'Le nouvel index est inférieur au précédent. Compteur remplacé, correction ou erreur de saisie ?'
        : null,
    },
  });

  return { reading, period };
}
// ---------- Agrégation dashboard (flow.md §8 et §39) ----------

export type DashboardPayload = {
  electricity: {
    spent: number;
    consumptionKwh: number;
    consumptionStatus: ValueStatus;
    consumptionConfidence: string;
    forecastAmount: number | null;
    trendPercent: number | null;
    hasData: boolean;
  };
  water: {
    consumptionM3: number;
    effectiveCost: number | null;
    trendPercent: number | null;
    hasData: boolean;
  };
  forecast: { projectedAmount: number; caveat: string } | null;
  /** flow.md §29 — horizons 30 et 90 jours, toujours des projections */
  forecasts: {
    horizonDays: number;
    projectedAmount: number;
    label: string;
    status: 'FORECAST';
  }[];
  /** flow.md §24 — budget mensuel saisi par l'utilisateur */
  budget: {
    monthlyAmount: number;
    spent: number;
    remaining: number;
    willExceed: boolean;
    projectedWillExceed: boolean;
  } | null;
  /** Base de calcul de la projection — flow.md §29 (traçabilité) */
  projectionBasis: {
    amountPerDay: number;
    observedDays: number;
    observedSpend: number;
    windowDays: number;
    reliable: boolean;
    method: string;
  };
  alerts: Alert[];
  recommendations: Recommendation[];
  electricitySeries: { label: string; kwh: number; status: ValueStatus }[];
  waterSeries: { label: string; m3: number }[];
  tariffs: { code: string; version: number; sourceName: string; sourceUrl: string }[];
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * flow.md §29 — projection sur les jours RESTANTS du mois.
 *
 * Deux garde-fous importants :
 * 1. on extrapole depuis un rythme observé sur une fenêtre glissante (90 jours),
 *    pas depuis les seuls jours écoulés du mois : en début de mois, 3 jours de
 *    données donneraient une projection absurde ;
 * 2. si l'historique est trop court pour être significatif, on ne projette pas
 *    du tout — mieux vaut afficher « — » qu'un chiffre trompeur.
 */
export function projectionInput(purchases: { purchasedAt: Date; amountPaid: number }[], now: Date) {
  const windowStart = new Date(now.getTime() - 90 * 86_400_000);
  const observed = purchases.filter((p) => p.purchasedAt >= windowStart);
  const observedSpend = observed.reduce((s, p) => s + p.amountPaid, 0);

  // jours écoulés depuis la PREMIÈRE recharge de la fenêtre
  //
  // ⚠ On retient la date minimale, pas `observed[0]` : l'ordre des lignes varie
  // selon la requête appelante (le tableau de bord charge en `desc` pour
  // borner le volume). Prendre l'élément 0 ferait croire qu'il n'y a qu'un
  // jour d'historique et supprimerait toute projection — le §29 serait muet.
  const firstObserved = observed.reduce<Date | null>(
    (min, p) => (min === null || p.purchasedAt < min ? p.purchasedAt : min),
    null,
  );
  const observedDays = firstObserved
    ? Math.max(1, Math.round((+now - +firstObserved) / 86_400_000) + 1)
    : 0;

  // moins de 7 jours d'historique : trop faible pour projeter
  const reliable = observedDays >= 7 && observed.length >= 2;
  const amountPerDay = reliable ? observedSpend / observedDays : null;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remainingDays = Math.max(0, daysInMonth - now.getDate());

  return { amountPerDay, remainingDays, observedDays, observedSpend, reliable };
}

function monthSum(rows: { purchasedAt: Date; amountPaid: number }[], offset: number): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return rows.filter((r) => r.purchasedAt >= start && r.purchasedAt < end).reduce((s, r) => s + r.amountPaid, 0);
}
export async function getDashboard(userId: string): Promise<DashboardPayload> {
  // flow.md §40 — bornes sur les relations imbriquées. Le tableau de bord
  // n'analyse que les 24 derniers mois : charger tout l'historique ferait
  // croître la charge inutilement sur un compte ancien.
  const DASHBOARD_WINDOW = 24;

  const meters = await db.meter.findMany({
    where: { property: { userId }, active: true },
    include: {
      electricityPurchases: { orderBy: { purchasedAt: 'desc' }, take: DASHBOARD_WINDOW },
      consumptionPeriods: { orderBy: { endDate: 'desc' }, take: DASHBOARD_WINDOW },
    },
  });

  const purchases = meters.filter((m) => m.utilityType === 'ELECTRICITY').flatMap((m) => m.electricityPurchases);
  const waterPeriods = meters.filter((m) => m.utilityType === 'WATER').flatMap((m) => m.consumptionPeriods);

  const now = new Date();
  const monthPurchases = purchases.filter((p) => p.purchasedAt >= startOfMonth(now));
  const spent = monthPurchases.reduce((s, p) => s + p.amountPaid, 0);
  const hasRealKwh = monthPurchases.some((p) => p.energyCreditedKwh != null);
  const rawKwh = monthPurchases.reduce((s, p) => s + (p.energyCreditedKwh ?? p.estimatedEnergyKwh ?? 0), 0);

  // flow.md §19 — des kWh estimés ne sont jamais présentés comme une mesure
  const kwh = labelElectricityKwh({
    creditedKwh: hasRealKwh ? rawKwh : null,
    estimatedKwh: rawKwh,
  });

  const spentPrev = monthSum(purchases, -1);
  const spentTrend = spent > 0 && spentPrev > 0 ? calculateTrend(spent, spentPrev) : null;

  // flow.md §29 — rythme observé sur 90 jours, projeté sur les jours restants
  const proj = projectionInput(purchases, now);
  const amountPerDay = proj.amountPerDay;
  const projection = calculateMonthlyProjection({
    dailyAverage: amountPerDay ?? 0,
    days: proj.remainingDays || 30,
    amountPerDay,
  });
  const projection90 = calculateMonthlyProjection({
    dailyAverage: amountPerDay ?? 0,
    days: 90,
    amountPerDay,
  });
// ---------- Eau ----------
  const recentWater = [...waterPeriods].sort((a, b) => +a.endDate - +b.endDate).slice(-6);
  const waterM3 = recentWater.reduce((s, p) => s + p.quantity, 0);
  const waterTrend =
    recentWater.length >= 2
      ? calculateTrend(recentWater[recentWater.length - 1].quantity, recentWater[recentWater.length - 2].quantity)
      : null;

  // flow.md §23 — la facture saisie reste la référence financière
  const lastBill = await db.waterBill.findFirst({ where: { property: { userId } }, orderBy: { periodEnd: 'desc' } });

  // flow.md §24 et §30 — le budget mensuel saisi par l'utilisateur
  const budget = await db.budget.findFirst({
    where: { property: { userId }, category: 'ELECTRICITY' },
    orderBy: { createdAt: 'desc' },
  });

  const lastWaterReading = await db.meterReading.findFirst({
    where: { meter: { utilityType: 'WATER', property: { userId } }, readingType: 'INDEX' },
    orderBy: { readingDate: 'desc' },
  });
  const waterLastReadingDaysAgo = lastWaterReading
    ? (now.getTime() - lastWaterReading.readingDate.getTime()) / 86_400_000
    : undefined;

  const alerts = generateAlerts({
    waterPeriodQuantities: recentWater.map((p) => p.quantity),
    waterLastReadingDaysAgo,
    indexJustDecreased: recentWater.some((p) => p.anomaly),
    electricityDailyAverageHistory: purchases.map((p) => (p.energyCreditedKwh ?? p.estimatedEnergyKwh ?? 0) / 30),
    electricitySpentThisMonth: spent,
    electricitySpentPreviousMonth: spentPrev,
    // flow.md §30 — l'alerte de dépassement n'a de sens qu'avec un budget saisi
    budgetMonthly: budget?.monthlyAmount ?? null,
  });

  const recommendations = buildRecommendations({
    hasPurchase: purchases.length > 0,
    hasPurchaseWithKwh: purchases.some((p) => p.energyCreditedKwh != null),
    hasWaterReading: waterPeriods.length > 0,
    waterTrend,
    electricityTrend: spentTrend,
    alerts,
  });

  // ---------- Séries : données réelles uniquement, plus de valeurs en dur ----------
  //
  // La requête charge les lignes les PLUS RÉCENTES (`desc`) pour que `take`
  // prenne les 24 dernières. On remet ici dans l'ordre chronologique : le
  // `slice(-7)` doit viser les 7 dernières, pas les 7 plus anciennes du lot.
  const purchasesChrono = [...purchases].sort((a, b) => +a.purchasedAt - +b.purchasedAt);

  const electricitySeries = purchasesChrono.slice(-7).map((p) => ({
    label: p.purchasedAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    kwh: Math.round((p.energyCreditedKwh ?? p.estimatedEnergyKwh ?? 0) * 100) / 100,
    status: (p.energyCreditedKwh != null ? 'REAL' : 'ESTIMATE') as ValueStatus,
  }));

  const waterSeries = recentWater.map((p) => ({
    label: p.endDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    m3: Math.round(p.quantity * 100) / 100,
  }));

  const tariffs = (await loadTariffs()).map((t) => ({
    code: t.code,
    version: t.version,
    sourceName: t.source.sourceName,
    sourceUrl: t.source.sourceUrl,
  }));

  return {
    electricity: {
      spent,
      consumptionKwh: kwh.value,
      consumptionStatus: kwh.status,
      consumptionConfidence: hasRealKwh ? 'HIGH' : 'LOW',
      forecastAmount: projection.projectedAmount,
      trendPercent: spentTrend,
      hasData: purchases.length > 0,
    },
    water: {
      consumptionM3: Math.round(waterM3 * 100) / 100,
      effectiveCost: lastBill?.effectiveCostPerM3 ?? null,
      trendPercent: waterTrend,
      hasData: waterPeriods.length > 0,
    },
    forecast:
      spent > 0 ? { projectedAmount: projection.projectedAmount ?? 0, caveat: projection.caveat } : null,
    // flow.md §29 — horizons multiples, toujours étiquetés « projection ».
    // Sans historique suffisant, on n'affiche AUCUNE projection plutôt qu'un
    // chiffre trompeur (§34 : jamais de « 0 » presented comme une mesure).
    forecasts: proj.reliable && spent > 0
      ? [
          {
            horizonDays: 30,
            projectedAmount: projection.projectedAmount ?? 0,
            label: '30 jours',
            status: 'FORECAST' as const,
          },
          {
            horizonDays: 90,
            projectedAmount: projection90.projectedAmount ?? 0,
            label: '90 jours',
            status: 'FORECAST' as const,
          },
        ]
      : [],
    /** Rythme observé servant de base à la projection (traçabilité du calcul). */
    projectionBasis: {
      amountPerDay: Math.round((amountPerDay ?? 0) * 100) / 100,
      observedDays: proj.observedDays,
      observedSpend: proj.observedSpend,
      windowDays: 90,
      reliable: proj.reliable,
      method: 'moyenne journalière observée sur 90 jours',
    },
    budget: budget
      ? {
          monthlyAmount: budget.monthlyAmount,
          spent,
          remaining: Math.max(0, budget.monthlyAmount - spent),
          willExceed: spent > budget.monthlyAmount,
          projectedWillExceed: (projection.projectedAmount ?? 0) > budget.monthlyAmount,
        }
      : null,
    alerts,
    recommendations,
    electricitySeries,
    waterSeries,
    tariffs,
  };
}
