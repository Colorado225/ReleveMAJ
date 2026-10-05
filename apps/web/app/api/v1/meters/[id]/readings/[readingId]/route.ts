// DELETE /api/v1/meters/[id]/readings/[readingId] — flow.md §21 et §36.
//
// ⚠ PAS de `PATCH` sur cette ressource, volontairement (cf. `validation.ts`) :
// la valeur d'un relevé EST la mesure. La modifier réécrirait l'historique
// financier en silence. Un relevé se saisit, se signale ou se supprime — jamais
// se réécrit. Le client qui veut corriger une valeur doit supprimer puis
// recréer, et l'interface expose exactement ce chemin.
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string; readingId: string }> };

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'reading:delete', 120, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id, readingId } = await params;

  // flow.md §40 — le relevé doit appartenir à l'UTILISATEUR **et** au compteur
  // de l'URL : sans le second filtre, un identifiant deviné permettrait de supprimer
  // un relevé d'un compteur qui n'est pas le sien.
  const reading = await db.meterReading.findFirst({
    where: { id: readingId, meterId: id, meter: { property: { userId: session.id } } },
    select: { id: true },
  });
  if (!reading) return notFound('Relevé introuvable.');

  // flow.md §21 — les périodes de consommation sont DÉRIVÉES des relevés. Cette
  // route ne les supprime pas : `ConsumptionPeriod` ne conserve pas l'identifiant
  // du relevé qui l'a produite, il n'existe donc aucun lien fiable sur lequel
  // faire une cascade. Une période peut rester orpheline après la suppression
  // d'un relevé — c'est une limite connue du modèle, pas de cette route, et la
  // corriger demanderait d'ajouter une colonne `readingId`.
  // La Server Action `deleteReadingAction` se comporte de même : on ne prétend
  // pas nettoyer ce qu'on ne sait pas rattacher.
  await db.meterReading.delete({ where: { id: reading.id } });
  await audit({
    action: 'meter_reading_deleted',
    entity: 'MeterReading',
    entityId: reading.id,
    userId: session.id,
  });

  return ok({ deleted: true, id: reading.id });
}