// PATCH + DELETE /api/v1/water/bills/[id] — flow.md §38, §21 et §22.
//
// La facture SODECI est la référence financière de l'eau : elle se corrige, mais
// le coût effectif est toujours redérivé du couple montant / consommation pour
// qu'il corresponde exactement à ce qui est enregistré.
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { deleteUploadedFile } from '@/lib/upload';
import { patchWaterBillSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  // `periodStart`, `periodEnd`, `consumptionM3` et `amountTtc` sont relus pour
  // valider la période APRÈS fusion et redériver le coût effectif : un `PATCH`
  // d'un seul champ doit être vérifié contre les valeurs déjà enregistrées.
  const bill = await db.waterBill.findFirst({
    where: { id, property: { userId: session.id } },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      consumptionM3: true,
      amountTtc: true,
    },
  });
  if (!bill) return notFound('Facture introuvable.');

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);

  // Un `PATCH` ne porte que les champs modifiés. Les bornes restent celles de
  // la création pour chaque champ fourni.
  const body = parse(patchWaterBillSchema, json.raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  if (Object.keys(body.data).length === 0) return fail('Aucun champ à modifier.', 422);

  // Une période inversée rendrait toute moyenne journalière incalculable. On
  // contrôle le résultat APrès fusion avec l'existant, pas seulement les champs
  // transmis : corriger la date de fin seule doit être vérifié contre le début.
  const start = body.data.periodStart ?? bill.periodStart;
  const end = body.data.periodEnd ?? bill.periodEnd;
  if (new Date(end).getTime() < new Date(start).getTime()) {
    return fail('La fin de période ne peut pas précéder le début.', 422, 'periodEnd');
  }

  // flow.md §23 — coût effectif OBSERVÉ, pas le tarif réglementaire. Il est
  // redérivé dès qu'un des deux termes bouge, sinon il deviendrait faux.
  const consumptionM3 = body.data.consumptionM3 ?? bill.consumptionM3;
  const amountTtc = body.data.amountTtc ?? bill.amountTtc;

  const data: Prisma.WaterBillUncheckedUpdateInput = {};
  if (body.data.periodStart) data.periodStart = new Date(body.data.periodStart);
  if (body.data.periodEnd) data.periodEnd = new Date(body.data.periodEnd);
  if ('consumptionM3' in body.data) data.consumptionM3 = body.data.consumptionM3;
  if ('amountTtc' in body.data) data.amountTtc = body.data.amountTtc;
  if ('consumptionM3' in body.data || 'amountTtc' in body.data) {
    data.effectiveCostPerM3 = consumptionM3 > 0 ? amountTtc / consumptionM3 : null;
  }
  if ('invoiceReference' in body.data) data.invoiceReference = body.data.invoiceReference ?? null;

  const updated = await db.waterBill.update({ where: { id: bill.id }, data });

  await audit({
    action: 'water_bill_updated',
    entity: 'WaterBill',
    entityId: updated.id,
    userId: session.id,
  });

  return ok({
    id: updated.id,
    periodStart: updated.periodStart.toISOString(),
    periodEnd: updated.periodEnd.toISOString(),
    consumptionM3: updated.consumptionM3,
    amountTtc: updated.amountTtc,
    effectiveCostPerM3: updated.effectiveCostPerM3,
    invoiceReference: updated.invoiceReference,
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'bill:delete', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const bill = await db.waterBill.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true, receiptImagePath: true },
  });
  if (!bill) return notFound('Facture introuvable.');

  await db.waterBill.delete({ where: { id: bill.id } });
  if (bill.receiptImagePath) await deleteUploadedFile(bill.receiptImagePath);

  await audit({ action: 'water_bill_deleted', entity: 'WaterBill', entityId: bill.id, userId: session.id });

  return ok({ deleted: true, id: bill.id });
}