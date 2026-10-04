// GET /api/v1/dashboard — flow.md §39.
// Le format reprend strictement la structure documentée dans le plan.
import { authenticate, ok, unauthorized } from '@/lib/api';
import { getDashboard } from '@/lib/services';
import { track } from '@/lib/analytics';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const data = await getDashboard(session.id);
  await track('dashboard_viewed', { userId: session.id });

  return ok({
    electricity: {
      spent: data.electricity.spent,
      consumptionKwh: data.electricity.consumptionKwh,
      consumptionConfidence: data.electricity.consumptionConfidence,
      consumptionStatus: data.electricity.consumptionStatus,
      forecastAmount: data.electricity.forecastAmount,
      trendPercent: data.electricity.trendPercent,
      hasData: data.electricity.hasData,
    },
    water: {
      consumptionM3: data.water.consumptionM3,
      consumptionStatus: data.water.hasData ? 'CALCULATED' : 'UNKNOWN',
      consumptionConfidence: data.water.hasData ? 'HIGH' : 'LOW',
      effectiveCost: data.water.effectiveCost,
      trendPercent: data.water.trendPercent,
      hasData: data.water.hasData,
    },
    forecast: data.forecast,
    alerts: data.alerts,
    recommendations: data.recommendations,
    series: {
      electricity: data.electricitySeries,
      water: data.waterSeries,
    },
    // flow.md §50 — provenance des grilles appliquées
    tariffs: data.tariffs,
  });
}