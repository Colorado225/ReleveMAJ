// GET + POST /api/v1/water/bills — flow.md §38 et §22.
import { db } from '@/lib/db';
import { authenticate, fail, forbidden, guardRateLimit, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';
import { createWaterBillSchema } from '@/lib/validation';

function serializeBill(b: {
  id: string;
  meterId: string;
  periodStart: Date;
  periodEnd: Date;
  consumptionM3: number;
  amountTtc: number;
  effectiveCostPerM3: number | null;
  invoiceReference: string | null;
  source: string;
  receiptImagePath: string | null;
}) {
  return {
    id: b.id,
    meterId: b.meterId,
    periodStart: b.periodStart.toISOString(),
    periodEnd: b.periodEnd.toISOString(),
    consumptionM3: b.consumptionM3,
    amountTtc: b.amountTtc,
    // flow.md §23 — libellé imposé : coût effectif observé, PAS tarif officiel
    effectiveCostPerM3: b.effectiveCostPerM3,
    effectiveCostLabel: 'Coût effectif observé sur cette facture',
    invoiceReference: b.invoiceReference,
    source: b.source,
    hasReceipt: Boolean(b.receiptImagePath),
  };
}

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const meterId = url.searchParams.get('meterId');

  const bills = await db.waterBill.findMany({
    where: {
      property: { userId: session.id },
      ...(meterId ? { meterId } : {}),
    },
    orderBy: { periodEnd: 'desc' },
    take: 200,
  });

  return ok(bills.map(serializeBill));
}

export async function POST(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'waterbill:create', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de factures. Réessayez plus tard.', 429);

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);
  const raw = json.raw;

  const meterId = typeof raw.meterId === 'string' ? raw.meterId : '';
  const meter = await db.meter.findFirst({
    where: { id: meterId, property: { userId: session.id } },
    select: { id: true, propertyId: true, utilityType: true },
  });
  if (!meter) return forbidden('Compteur introuvable ou inaccessible.');
  if (meter.utilityType !== 'WATER') return forbidden('Ce compteur n’est pas un compteur d’eau.');

  const body = parse(createWaterBillSchema, raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  const { periodStart, periodEnd, consumptionM3, amountTtc } = body.data;

  // flow.md §52 — facture incohérente
  if (new Date(periodEnd) < new Date(periodStart)) {
    return fail('La fin de période doit être postérieure au début.', 422, 'periodEnd');
  }
  if (new Date(periodEnd) > new Date()) {
    return fail('La fin de période ne peut pas être dans le futur.', 422, 'periodEnd');
  }
  if (consumptionM3 === 0 && amountTtc > 0) {
    return fail('Indiquez la consommation en m³ pour calculer le coût effectif.', 422, 'consumptionM3');
  }

  const bill = await db.waterBill.create({
    data: {
      meterId: meter.id,
      propertyId: meter.propertyId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      consumptionM3,
      amountTtc,
      // flow.md §23 — coût effectif observé sur CETTE facture
      effectiveCostPerM3: consumptionM3 > 0 ? amountTtc / consumptionM3 : null,
      invoiceReference: body.data.invoiceReference,
      source: 'MANUAL',
    },
  });

  await audit({ action: 'water_bill_created', entity: 'WaterBill', entityId: bill.id, userId: session.id });

  const previous = await db.waterBill.count({
    where: { property: { userId: session.id }, id: { not: bill.id } },
  });
  if (previous === 0) await track('first_bill', { userId: session.id });

  return ok(serializeBill(bill), 201);
}