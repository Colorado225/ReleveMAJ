// PATCH + DELETE /api/v1/budgets/[id] — flow.md §24, §30 et §21.
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, notFound, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { updateBudgetSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await params;

  const budget = await db.budget.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!budget) return notFound('Budget introuvable.');

  // Seul le montant est modifiable : changer la catégorie d'une enveloppe
  // existante produirait un historique trompeur.
  const body = await parseBody(request, (input) => parse(updateBudgetSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  const updated = await db.budget.update({
    where: { id: budget.id },
    data: { monthlyAmount: body.data.monthlyAmount },
  });

  await audit({ action: 'budget_updated', entity: 'Budget', entityId: updated.id, userId: session.id });

  return ok({
    id: updated.id,
    propertyId: updated.propertyId,
    category: updated.category,
    monthlyAmount: updated.monthlyAmount,
    currency: 'XOF',
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'budget:delete', 30, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de suppressions. Réessayez plus tard.', 429);

  const { id } = await params;

  const budget = await db.budget.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!budget) return notFound('Budget introuvable.');

  // Aucune cascade : le budget est un point de comparaison, pas une donnée
  // d'historique. Les factures et périodes déjà saisies restent intactes.
  await db.budget.delete({ where: { id: budget.id } });
  await audit({ action: 'budget_deleted', entity: 'Budget', entityId: budget.id, userId: session.id });

  return ok({ deleted: true, id: budget.id });
}