// GET /api/v1/consumption/summary — flow.md §38 et §28.
//
// Agrégation par période : les écarts entre deux index d'eau et les recharges
// d'électricité, avec le statut réel/estimé de chaque valeur.
import { db } from '@/lib/db';
import { authenticate, ok, unauthorized } from '@/lib/api';
import { calculateTrend, labelElectricityKwh } from '@conso-ci/tariff-engine';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);

  const meters = await db.meter.findMany({
    where: { property: { userId: session.id }, active: true },
    include: {
      consumptionPeriods: { orderBy: { endDate: 'desc' }, take: limit },
      electricityPurchases: { orderBy: { purchasedAt: 'desc' }, take: limit },
    },
  });

  const electricity = meters.filter((m) => m.utilityType === 'ELECTRICITY');
  const water = meters.filter((m) => m.utilityType === 'WATER');

  const electricityMeters = electricity.map((meter) => {
    const rows = meter.electricityPurchases.map((p) => {
      const labelled = labelElectricityKwh({
        creditedKwh: p.energyCreditedKwh,
        estimatedKwh: p.estimatedEnergyKwh,
      });
      return {
        id: p.id,
        date: p.purchasedAt.toISOString(),
        amountPaid: p.amountPaid,
        kwh: labelled.value,
        status: labelled.status,
        confidence: labelled.confidence,
        // flow.md §18 — coût effectif observé
        effectiveCostPerKwh:
          p.energyCreditedKwh != null && p.energyCreditedKwh > 0
            ? Math.round((p.amountPaid / p.energyCreditedKwh) * 100) / 100
            : null,
      };
    });
    return {
      meterId: meter.id,
      label: meter.label ?? 'Compteur CIE',
      paymentMode: meter.paymentMode,
      totalSpent: rows.reduce((s, r) => s + r.amountPaid, 0),
      totalKwh: Math.round(rows.reduce((s, r) => s + r.kwh, 0) * 100) / 100,
      hasRealKwh: rows.some((r) => r.status === 'REAL'),
      entries: rows,
    };
  });

  const waterMeters = water.map((meter) => ({
    meterId: meter.id,
    label: meter.label ?? 'Compteur SODECI',
    unit: meter.unit,
    periods: meter.consumptionPeriods.map((p) => ({
      id: p.id,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
      startValue: p.startValue,
      endValue: p.endValue,
      quantity: p.quantity,
      dailyAverage: p.dailyAverage,
      status: p.anomaly ? 'UNKNOWN' : 'CALCULATED',
      // flow.md §21 — index régressif conservé et signalé
      anomaly: p.anomaly,
      anomalyNote: p.anomalyNote,
    })),
  }));

  // Tendance d'eau sur les 3 dernières périodes du compteur le plus actif
  const allWaterPeriods = waterMeters
    .flatMap((m) => m.periods)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const lastThree = allWaterPeriods.slice(-3);
  const waterTrendPercent =
    lastThree.length === 2 ? calculateTrend(lastThree[1].quantity, lastThree[0].quantity) : null;

  return ok({
    electricity: {
      meters: electricityMeters,
      totalSpent: electricityMeters.reduce((s, m) => s + m.totalSpent, 0),
      totalKwh: Math.round(electricityMeters.reduce((s, m) => s + m.totalKwh, 0) * 100) / 100,
    },
    water: {
      meters: waterMeters,
      totalM3: Math.round(allWaterPeriods.reduce((s, p) => s + p.quantity, 0) * 100) / 100,
      trendPercent: waterTrendPercent,
    },
    generatedAt: new Date().toISOString(),
  });
}