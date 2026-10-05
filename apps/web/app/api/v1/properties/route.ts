// GET + POST /api/v1/properties — flow.md §38, §33 et §47.
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';
import { createWithinQuota, type PlanName } from '@/lib/plans';
import { createPropertySchema } from '@/lib/validation';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  // flow.md §40 — isolation : on ne retourne que les logements du demandeur
  const properties = await db.property.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'asc' },
    include: { meters: { orderBy: { createdAt: 'asc' } } },
  });

  return ok(
    properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      isAbidjan: p.isAbidjan,
      createdAt: p.createdAt.toISOString(),
      meters: p.meters.map((m) => ({
        id: m.id,
        provider: m.provider,
        utilityType: m.utilityType,
        meterType: m.meterType,
        paymentMode: m.paymentMode,
        meterNumber: m.meterNumber,
        subscribedPower: m.subscribedPower,
        unit: m.unit,
        label: m.label,
        active: m.active,
      })),
    })),
  );
}

// POST /api/v1/properties — flow.md §38, §33 et §47.
// L'utilisateur commence toujours par son logement : la suite du parcours en dépend.

export async function POST(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);
  const raw = json.raw;

  const limited = await guardRateLimit(request, 'property:create', 20, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de créations. Réessayez plus tard.', 429);

  const body = parse(createPropertySchema, raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) return unauthorized('Compte introuvable.');

  // flow.md §47 — quota FREE appliqué, sans jamais masquer la donnée existante.
  //
  // Le quota ET la création ont lieu dans la même transaction verrouillée
  // (`createWithinQuota`). Un `count` préalable resterait une course : deux
  // requêtes simultanées constateraient toutes deux « 0 logement ».
  const created = await createWithinQuota({
    userId: session.id,
    plan: user.plan as PlanName,
    quota: 'properties',
    create: (tx) =>
      tx.property.create({
        data: {
          name: body.data.name,
          address: body.data.address,
          isAbidjan: body.data.isAbidjan,
          userId: session.id,
        },
      }),
  });
  if (!created.ok) return fail(created.message, 402);
  const property = created.value;

  await audit({ action: 'property_created', entity: 'Property', entityId: property.id, userId: session.id });
  await track('property_created', { userId: session.id });

  return ok(
    {
      id: property.id,
      name: property.name,
      address: property.address,
      isAbidjan: property.isAbidjan,
      createdAt: property.createdAt.toISOString(),
    },
    201,
  );
}
