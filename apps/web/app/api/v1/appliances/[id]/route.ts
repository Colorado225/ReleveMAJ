// PATCH + DELETE /api/v1/appliances/[id] — flow.md §38 et §32.
//
// Un appareil est une ESTIMATION, jamais une mesure : c'est ce qui autorise sa
// modification. Le moteur recalcule la consommation à chaque affichage, aucune
// valeur dérivée n'est stockée, donc corriger un appareil ne réécrit rien.
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { patchApplianceSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  const appliance = await db.appliance.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!appliance) return notFound('Appareil introuvable.');

  // Un `PATCH` ne porte que les champs modifiés : `patchApplianceSchema` les
  // valide avec les mêmes bornes que la création, mais n'exige pas la ligne
  // entière. `updateApplianceSchema` (exigeant) reste utilisé par le formulaire.
  const body = await parseBody(request, (input) => parse(patchApplianceSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  // Un corps vide ne modifie rien : on le dit plutôt que de renvoyer 200.
  if (Object.keys(body.data).length === 0) return fail('Aucun champ à modifier.', 422);

  // `propertyId` n'est pas dans le schéma : le rattachement au logement
  // détermine le périmètre de l'estimation et ne bouge pas.
  const updated = await db.appliance.update({ where: { id: appliance.id }, data: body.data });

  await audit({
    action: 'appliance_updated',
    entity: 'Appliance',
    entityId: updated.id,
    userId: session.id,
  });

  return ok({
    id: updated.id,
    propertyId: updated.propertyId,
    type: updated.type,
    label: updated.label,
    powerWatts: updated.powerWatts,
    hoursPerDay: updated.hoursPerDay,
    daysPerMonth: updated.daysPerMonth,
    // flow.md §32 — une estimation reste annoncée comme telle après correction
    consumptionStatus: 'ESTIMATE',
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'appliance:delete', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const appliance = await db.appliance.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!appliance) return notFound('Appareil introuvable.');

  await db.appliance.delete({ where: { id: appliance.id } });
  await audit({ action: 'appliance_deleted', entity: 'Appliance', entityId: appliance.id, userId: session.id });

  return ok({ deleted: true, id: appliance.id });
}