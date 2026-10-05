// GET + POST + PATCH + DELETE /api/v1/appliances — flow.md §38 et §32.
//
// Un appareil est une ESTIMATION, jamais une mesure : c'est ce qui autorise sa
// modification. Le moteur recalcule la consommation à chaque affichage, aucune
// valeur dérivée n'est stockée, donc corriger un appareil ne réécrit rien.
import { db } from '@/lib/db';
import { authenticate, fail, forbidden, guardRateLimit, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { createApplianceSchema } from '@/lib/validation';

function serializeAppliance(a: {
  id: string;
  propertyId: string;
  type: string;
  label: string;
  powerWatts: number;
  hoursPerDay: number;
  daysPerMonth: number;
  createdAt: Date;
}) {
  return {
    id: a.id,
    propertyId: a.propertyId,
    type: a.type,
    label: a.label,
    powerWatts: a.powerWatts,
    hoursPerDay: a.hoursPerDay,
    daysPerMonth: a.daysPerMonth,
    // flow.md §32 — une estimation est toujours annoncée comme telle
    consumptionStatus: 'ESTIMATE',
    createdAt: a.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const propertyId = url.searchParams.get('propertyId');

  const appliances = await db.appliance.findMany({
    where: {
      property: { userId: session.id },
      ...(propertyId ? { propertyId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  return ok(appliances.map(serializeAppliance));
}

export async function POST(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'appliance:create', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop d’appareils ajoutés. Réessayez plus tard.', 429);

  const body = await parseBody(request, (input) => parse(createApplianceSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  const property = await db.property.findFirst({
    where: { id: body.data.propertyId, userId: session.id },
    select: { id: true },
  });
  if (!property) return forbidden('Logement introuvable ou inaccessible.');

  const appliance = await db.appliance.create({
    data: { ...body.data, propertyId: property.id },
  });

  await audit({
    action: 'appliance_created',
    entity: 'Appliance',
    entityId: appliance.id,
    userId: session.id,
    metadata: { type: appliance.type },
  });

  return ok(serializeAppliance(appliance), 201);
}

// `PATCH` et `DELETE` vivent dans `appliances/[id]/route.ts` : une route Next.js
// ne peut pas déclarer à la fois des handlers avec et sans paramètre dynamique,
// le contrat de `params` diffère.