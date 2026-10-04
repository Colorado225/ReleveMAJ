// GET /api/v1/consumption — flow.md §38.
//
// Vue plate de la consommation : la même agrégation que /summary, exposée sous la
// forme d'une liste unique de périodes, plus simple à consommer côté client.
import { db } from '@/lib/db';
import { authenticate, ok, unauthorized } from '@/lib/api';
import { labelElectricityKwh } from '@conso-ci/tariff-engine';

type ConsumptionItem = {
  id: string;
  meterId: string;
  utilityType: 'ELECTRICITY' | 'WATER';
  date: string;
  quantity: number;
  unit: 'KWH' | 'M3';
  status: string;
  confidence: string;
  amountTtc: number | null;
  anomaly?: boolean;
};

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const utility = url.searchParams.get('utility'); // ELECTRICITY | WATER

  // flow.md §40 — les relations imbriquées sont BORNÉES.
  //
  // Sans `take`, un compte accumulant des années de relevés fait charger toutes
  // les lignes d'un coup : la réponse grossit sans limite et la requête sature
  // la mémoire. Un utilisateur légitime peut le déclencher sans être malveillant.
  const HISTORY_LIMIT = 500;

  const meters = await db.meter.findMany({
    where: {
      property: { userId: session.id },
      active: true,
      ...(utility === 'ELECTRICITY' || utility === 'WATER' ? { utilityType: utility } : {}),
    },
    include: {
      consumptionPeriods: { orderBy: { endDate: 'desc' }, take: HISTORY_LIMIT },
      electricityPurchases: { orderBy: { purchasedAt: 'desc' }, take: HISTORY_LIMIT },
    },
  });

  const items: ConsumptionItem[] = meters.flatMap((meter): ConsumptionItem[] => {
    if (meter.utilityType === 'ELECTRICITY') {
      return meter.electricityPurchases.map((p) => {
        const labelled = labelElectricityKwh({
          creditedKwh: p.energyCreditedKwh,
          estimatedKwh: p.estimatedEnergyKwh,
        });
        return {
          id: p.id,
          meterId: meter.id,
          utilityType: 'ELECTRICITY' as const,
          date: p.purchasedAt.toISOString(),
          quantity: labelled.value,
          unit: 'KWH' as const,
          status: labelled.status,
          confidence: labelled.confidence,
          amountTtc: p.amountPaid,
        };
      });
    }
    return meter.consumptionPeriods.map((p) => ({
      id: p.id,
      meterId: meter.id,
      utilityType: 'WATER' as const,
      date: p.endDate.toISOString(),
      quantity: p.quantity,
      unit: 'M3' as const,
      // flow.md §21 — un index décroissant reste signalé, jamais masqué
      status: (p.anomaly ? 'UNKNOWN' : 'CALCULATED') as 'UNKNOWN' | 'CALCULATED',
      confidence: 'HIGH' as const,
      amountTtc: null,
      anomaly: p.anomaly,
    }));
  });

  items.sort((a, b) => b.date.localeCompare(a.date));
  return ok(items);
}