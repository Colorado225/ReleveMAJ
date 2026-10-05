// PATCH + DELETE /api/v1/properties/[id] — flow.md §38 et §21.
//
// `PATCH` plutôt que `PUT` : une correction partielle (renommer sans changer
// l'adresse) est le cas d'usage réel. `PUT` exigerait de renvoyer la ressource
// entière et écraserait de proche en proche les champs absents.
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { patchPropertySchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  // flow.md §40 — le filtre `userId` est ce qui distingue « absent » de « à autrui »
  const property = await db.property.findFirst({
    where: { id, userId: session.id },
    select: { id: true },
  });
  if (!property) return notFound('Logement introuvable.');

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);

  // Un `PATCH` ne porte que les champs modifiés ; chaque champ fourni est
  // validé avec les mêmes règles que la création.
  const body = parse(patchPropertySchema, json.raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  if (Object.keys(body.data).length === 0) return fail('Aucun champ à modifier.', 422);

  // On ne construit le `data` qu'avec les clés transmises : envoyer
  // `isAbidjan: undefined` effacerait le drapeau chez Prisma.
  const data: { name?: string; address?: string | null; isAbidjan?: boolean } = {};
  if ('name' in body.data) data.name = body.data.name;
  if ('address' in body.data) data.address = body.data.address ?? null;
  if ('isAbidjan' in body.data) data.isAbidjan = body.data.isAbidjan;

  const updated = await db.property.update({ where: { id: property.id }, data });

  await audit({
    action: 'property_updated',
    entity: 'Property',
    entityId: updated.id,
    userId: session.id,
  });

  return ok({
    id: updated.id,
    name: updated.name,
    address: updated.address,
    isAbidjan: updated.isAbidjan,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'property:delete', 20, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const property = await db.property.findFirst({
    where: { id, userId: session.id },
    select: { id: true, _count: { select: { meters: true } } },
  });
  if (!property) return notFound('Logement introuvable.');

  // flow.md §21 — l'interface prévient de la cascade ; l'API l'annonce aussi
  // dans le détail de la réponse, sinon un client ne comprendrait pas ce qui part.
  const deletedMeters = property._count.meters;

  await db.property.delete({ where: { id: property.id } });

  await audit({
    action: 'property_deleted',
    entity: 'Property',
    entityId: property.id,
    userId: session.id,
    metadata: { cascadedMeters: deletedMeters },
  });

  return ok({ deleted: true, id: property.id, cascadedMeters: deletedMeters });
}