// GET + POST /api/v1/electricity/purchases — flow.md §38, §11 et §35.
import { db } from '@/lib/db';
import { authenticate, fail, forbidden, guardRateLimit, ok, parse, readJson, unauthorized } from '@/lib/api';
import { resolveMeterTariff } from '@/lib/services';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';
import { reverseEstimate } from '@conso-ci/tariff-engine';
import { createPurchaseSchema } from '@/lib/validation';

function serializePurchase(p: {
  id: string;
  meterId: string;
  amountPaid: number;
  energyCreditedKwh: number | null;
  estimatedEnergyKwh: number | null;
  costPerKwh: number | null;
  paymentMethod: string;
  purchasedAt: Date;
  tokenReference: string | null;
  source: string;
  confidence: string;
  receiptImagePath: string | null;
}) {
  // flow.md §18 et §51 — le coût effectif observé n'est PAS le prix réglementaire
  const real = p.energyCreditedKwh != null;
  return {
    id: p.id,
    meterId: p.meterId,
    amountPaid: p.amountPaid,
    energyCreditedKwh: p.energyCreditedKwh,
    estimatedEnergyKwh: p.estimatedEnergyKwh,
    effectiveCostPerKwh: real && (p.energyCreditedKwh ?? 0) > 0 ? p.amountPaid / p.energyCreditedKwh! : null,
    consumptionKwh: p.energyCreditedKwh ?? p.estimatedEnergyKwh,
    consumptionStatus: real ? 'REAL' : 'ESTIMATE',
    consumptionConfidence: p.confidence,
    paymentMethod: p.paymentMethod,
    purchasedAt: p.purchasedAt.toISOString(),
    tokenReference: p.tokenReference,
    hasReceipt: Boolean(p.receiptImagePath),
    source: p.source,
  };
}

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const meterId = url.searchParams.get('meterId');

  const purchases = await db.electricityPurchase.findMany({
    where: {
      meter: { property: { userId: session.id } },
      ...(meterId ? { meterId } : {}),
    },
    orderBy: { purchasedAt: 'desc' },
    take: 200,
  });

  return ok(purchases.map(serializePurchase));
}

export async function POST(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'purchase:create', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de recharges. Réessayez plus tard.', 429);

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);
  const raw = json.raw;

  const meterId = typeof raw.meterId === 'string' ? raw.meterId : '';
  const meter = await db.meter.findFirst({
    where: { id: meterId, property: { userId: session.id } },
  });
  if (!meter) return forbidden('Compteur introuvable ou inaccessible.');
  // flow.md §35 — une recharge concerne un compteur d'électricité
  if (meter.utilityType !== 'ELECTRICITY') return forbidden('Ce compteur n’est pas un compteur d’électricité.');

  const body = parse(createPurchaseSchema, raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  const { amountPaid, energyCreditedKwh } = body.data;

  // flow.md §19 — sans kWh crédités, on estime sous la grille applicable et on
  // marque le résultat ESTIMATE / confiance basse. Jamais de fausse précision.
  let estimated: number | null = null;
  if (energyCreditedKwh == null) {
    const tariff = await resolveMeterTariff({
      subscribedPower: meter.subscribedPower,
      category: 'DOMESTIC_SOCIAL',
    });
    if (tariff) {
      estimated = reverseEstimate(amountPaid, tariff, { subscribedPower: meter.subscribedPower ?? 5 }).kwh;
    }
  }

  const purchase = await db.electricityPurchase.create({
    data: {
      meterId: meter.id,
      amountPaid,
      energyCreditedKwh: energyCreditedKwh ?? null,
      estimatedEnergyKwh: estimated,
      costPerKwh:
        energyCreditedKwh != null && energyCreditedKwh > 0 ? amountPaid / energyCreditedKwh : null,
      paymentMethod: body.data.paymentMethod,
      purchasedAt: body.data.purchasedAt ? new Date(body.data.purchasedAt) : new Date(),
      // flow.md §12 — on ne stocke pas le token CIE brut
      tokenReference: body.data.tokenReference,
      source: 'MANUAL',
      confidence: energyCreditedKwh != null ? 'HIGH' : 'LOW',
    },
  });

  await audit({
    action: 'electricity_purchase_created',
    entity: 'ElectricityPurchase',
    entityId: purchase.id,
    userId: session.id,
  });

  // flow.md §48 — première recharge de l'utilisateur
  const previous = await db.electricityPurchase.count({
    where: { meter: { property: { userId: session.id } }, id: { not: purchase.id } },
  });
  if (previous === 0) await track('first_purchase', { userId: session.id });

  return ok(serializePurchase(purchase), 201);
}