// PATCH + DELETE /api/v1/meters/[id] — flow.md §38 et §40.
//
// Le rattachement au logement n'est PAS modifiable : il détermine l'historique
// attaché au compteur. Un compteur se corrige, il ne se déplace pas.
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { patchMeterSchema } from '@/lib/validation';
import { checkMeterIdentityChange, meterHasHistory } from '@/lib/meter-identity';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  const meter = await db.meter.findFirst({
    where: { id, property: { userId: session.id } },
    // instr.md §11 — `provider` et `utilityType` sont lus pour comparer la
    // demande à l'identité enregistrée du compteur.
    select: { id: true, provider: true, utilityType: true },
  });
  if (!meter) return notFound('Compteur introuvable.');

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);

  // Un `PATCH` ne porte que les champs modifiés, mais les bornes restent celles
  // de la création. Le rattachement au logement n'en fait pas partie : il
  // détermine l'historique attaché au compteur.
  const body = parse(patchMeterSchema, json.raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  if (Object.keys(body.data).length === 0) return fail('Aucun champ à modifier.', 422);

  // instr.md §11 — `provider` et `utilityType` décrivent le même réseau, et
  // faire passer un compteur d'eau en électricité rendrait ses relevés
  // incohérents avec lui. Refusé dès qu'une donnée existe, pas seulement quand
  // le type change : une facture SODECI est un document financier, même sans
  // aucun relevé d'index.
  if ('provider' in body.data || 'utilityType' in body.data) {
    const aDesDonnees = await meterHasHistory(id);
    const refus = checkMeterIdentityChange({
      actuel: { provider: meter.provider, utilityType: meter.utilityType },
      demande: {
        provider: body.data.provider,
        utilityType: body.data.utilityType,
      },
      aDesDonnees,
    });
    if (refus) return fail(refus, 422);
  }

  // flow.md §9 — l'unité suit le type : la laisser sans lien avec lui rendrait
  // les données incohérentes (un compteur d'eau qui stocke des kWh). On ne la
  // recalcule que si le type est fourni ; sinon elle suit le type inchangé.
  // Les enums sont typés explicitement : Zod valide déjà la liste fermée, mais
  // TypeScript exige le type Prisma et refusera un `string` nu.
  const data: Prisma.MeterUncheckedUpdateInput = {};
  if ('provider' in body.data) data.provider = body.data.provider as 'CIE' | 'SODECI';
  if ('utilityType' in body.data) {
    data.utilityType = body.data.utilityType as 'ELECTRICITY' | 'WATER';
    data.unit = body.data.utilityType === 'ELECTRICITY' ? 'KWH' : 'M3';
  }
  if ('paymentMode' in body.data) {
    data.paymentMode = body.data.paymentMode as 'PREPAID' | 'POSTPAID' | 'UNKNOWN';
  }
  if ('meterNumber' in body.data) data.meterNumber = body.data.meterNumber ?? null;
  if ('subscribedPower' in body.data) data.subscribedPower = body.data.subscribedPower ?? null;
  if ('label' in body.data) data.label = body.data.label ?? null;

  const updated = await db.meter.update({ where: { id: meter.id }, data });

  await audit({ action: 'meter_updated', entity: 'Meter', entityId: updated.id, userId: session.id });

  return ok({
    id: updated.id,
    provider: updated.provider,
    utilityType: updated.utilityType,
    paymentMode: updated.paymentMode,
    meterNumber: updated.meterNumber,
    subscribedPower: updated.subscribedPower,
    unit: updated.unit,
    label: updated.label,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'meter:delete', 30, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const meter = await db.meter.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!meter) return notFound('Compteur introuvable.');

  // flow.md §21 — cascade sur relevés, recharges et factures : la réponse
  // annonce ce qui disparaît, jamais en silence.
  const counts = await db.meter.findUnique({
    where: { id: meter.id },
    select: {
      _count: {
        select: { readings: true, electricityPurchases: true, waterBills: true },
      },
    },
  });

  await db.meter.delete({ where: { id: meter.id } });
  await audit({ action: 'meter_deleted', entity: 'Meter', entityId: meter.id, userId: session.id });

  return ok({
    deleted: true,
    id: meter.id,
    cascaded: {
      readings: counts?._count.readings ?? 0,
      purchases: counts?._count.electricityPurchases ?? 0,
      bills: counts?._count.waterBills ?? 0,
    },
  });
}