// PATCH + DELETE /api/v1/electricity/purchases/[id] — flow.md §38, §21 et §35.
//
// La recharge est modifiable : un montant mal saisi ou une date erronée se
// corrige. En revanche la valeur de kWh-crédité reste LE kWh du compteur : si
// l'utilisateur ne le connaît pas, on ne l'invente pas à la correction (§11).
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { deleteUploadedFile } from '@/lib/upload';
import { patchPurchaseSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  // `amountPaid` et `energyCreditedKwh` sont relus pour REDÉRIVER le coût effectif
// quand un seul des deux change : sans eux, un `PATCH` du seul montant laisserait
// un `costPerKwh` incohérent avec le couple réellement enregistré.
  const purchase = await db.electricityPurchase.findFirst({
    where: { id, meter: { property: { userId: session.id } } },
    select: { id: true, purchasedAt: true, energyCreditedKwh: true, amountPaid: true },
  });
  if (!purchase) return notFound('Recharge introuvable.');

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);

  // Un `PATCH` ne porte que les champs modifiés. Les bornes restent celles de
  // la création pour chaque champ fourni.
  const body = parse(patchPurchaseSchema, json.raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  if (Object.keys(body.data).length === 0) return fail('Aucun champ à modifier.', 422);

  const data: Prisma.ElectricityPurchaseUncheckedUpdateInput = {};

  // Le coût effectif est redérivé dès qu'un des deux termes bouge : il doit
  // toujours correspondre au couple montant / kWh réellement enregistré.
  const amountPaid = 'amountPaid' in body.data ? body.data.amountPaid! : purchase.amountPaid;
  const kwh =
    'energyCreditedKwh' in body.data
      ? body.data.energyCreditedKwh ?? null
      : purchase.energyCreditedKwh;

  if ('amountPaid' in body.data) data.amountPaid = body.data.amountPaid;
  if ('energyCreditedKwh' in body.data) data.energyCreditedKwh = kwh;
  if ('amountPaid' in body.data || 'energyCreditedKwh' in body.data) {
    data.costPerKwh = kwh != null && kwh > 0 ? amountPaid / kwh : null;
  }
  if ('paymentMethod' in body.data) {
    data.paymentMethod = body.data.paymentMethod as
      | 'ORANGE_MONEY'
      | 'MTN_MOMO'
      | 'MOOV_MONEY'
      | 'WAVE'
      | 'CASH'
      | 'OTHER';
  }
  // La date est une donnée, pas un horodatage de saisie : sans elle, on
  // conserve celle déjà enregistrée.
  if (body.data.purchasedAt) {
    data.purchasedAt = new Date(body.data.purchasedAt);
  }
  if ('tokenReference' in body.data) data.tokenReference = body.data.tokenReference ?? null;

  const updated = await db.electricityPurchase.update({ where: { id: purchase.id }, data });

  await audit({
    action: 'electricity_purchase_updated',
    entity: 'ElectricityPurchase',
    entityId: updated.id,
    userId: session.id,
  });

  const real = updated.energyCreditedKwh != null;
  return ok({
    id: updated.id,
    amountPaid: updated.amountPaid,
    energyCreditedKwh: updated.energyCreditedKwh,
    // flow.md §11 — si l'utilisateur efface les kWh, l'estimation moteur redevient
    // la seule valeur disponible : on le dit plutôt que de laisser croire à une mesure.
    consumptionStatus: real ? 'REAL' : 'ESTIMATE',
    effectiveCostPerKwh:
      real && (updated.energyCreditedKwh ?? 0) > 0
        ? updated.amountPaid / updated.energyCreditedKwh!
        : null,
    paymentMethod: updated.paymentMethod,
    purchasedAt: updated.purchasedAt.toISOString(),
    tokenReference: updated.tokenReference,
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'purchase:delete', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const purchase = await db.electricityPurchase.findFirst({
    where: { id, meter: { property: { userId: session.id } } },
    select: { id: true, receiptImagePath: true },
  });
  if (!purchase) return notFound('Recharge introuvable.');

  await db.electricityPurchase.delete({ where: { id: purchase.id } });

  // La photo du disque ne doit pas survivre à la donnée qu'elle documente.
  if (purchase.receiptImagePath) await deleteUploadedFile(purchase.receiptImagePath);

  await audit({
    action: 'electricity_purchase_deleted',
    entity: 'ElectricityPurchase',
    entityId: purchase.id,
    userId: session.id,
  });

  return ok({ deleted: true, id: purchase.id });
}