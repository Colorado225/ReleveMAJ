// PATCH + DELETE /api/v1/alerts/[id] — flow.md §33 et §21.
//
// ⚠ Distinction importante avec `GET /api/v1/alerts` : celle-ci renvoie les
// alertes CALCULÉES à la volée depuis les données réelles (service
// `getDashboard`) et ne touche à aucune table. Les routes ci-dessous
// n'agissent que sur la table `Alert`, qui porte les alertes persistées
// (archivées ou marquées comme traitées).
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  const alert = await db.alert.findFirst({
    where: { id, userId: session.id },
    select: { id: true, resolvedAt: true },
  });
  if (!alert) return notFound('Alerte introuvable.');

  // Corps optionnel : `{ "resolved": true|false }`. Absent, l'état est inversé
  // — un client qui veut juste « traiter » l'alerte n'a rien à envoyer.
  const json = await readJson(request);
  const requested =
    json.raw && typeof json.raw.resolved === 'boolean' ? json.raw.resolved : !alert.resolvedAt;

  // flow.md §33 — `resolvedAt` est une DATE, jamais un booléen.
  const updated = await db.alert.update({
    where: { id: alert.id },
    data: { resolvedAt: requested ? new Date() : null },
  });

  await audit({ action: 'alert_updated', entity: 'Alert', entityId: updated.id, userId: session.id });

  return ok({
    id: updated.id,
    resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
    resolved: updated.resolvedAt !== null,
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'alert:delete', 60, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const alert = await db.alert.findFirst({
    where: { id, userId: session.id },
    select: { id: true, resolvedAt: true },
  });
  if (!alert) return notFound('Alerte introuvable.');

  // Résoudre est réversible, supprimer ne l'est pas : on refuse d'effacer une
  // alerte encore active. Elle doit d'abord être traitée.
  if (!alert.resolvedAt) {
    return fail('Traitez d’abord cette alerte avant de la supprimer.', 409);
  }

  await db.alert.delete({ where: { id: alert.id } });
  await audit({ action: 'alert_deleted', entity: 'Alert', entityId: alert.id, userId: session.id });

  return ok({ deleted: true, id: alert.id });
}