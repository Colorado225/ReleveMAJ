// GET + POST /api/v1/budgets — flow.md §38, §24 et §30.
//
// Le budget est une ENVELOPPE choisie par l'utilisateur : elle n'est lisible
// que par lui, jamais utilisée pour facturer. C'est pour cette raison qu'elle
// ne dérive d'aucun tarif réglementaire et qu'aucune source n'est exigée.
import { db } from '@/lib/db';
import { authenticate, fail, forbidden, guardRateLimit, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { budgetSchema } from '@/lib/validation';

function serializeBudget(b: {
  id: string;
  propertyId: string;
  category: string;
  monthlyAmount: number;
  createdAt: Date;
}) {
  return {
    id: b.id,
    propertyId: b.propertyId,
    category: b.category,
    monthlyAmount: b.monthlyAmount,
    currency: 'XOF',
    createdAt: b.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const propertyId = url.searchParams.get('propertyId');

  const budgets = await db.budget.findMany({
    where: {
      property: { userId: session.id },
      ...(propertyId ? { propertyId } : {}),
    },
    orderBy: { category: 'asc' },
  });

  return ok(budgets.map(serializeBudget));
}

export async function POST(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'budget:create', 30, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de créations. Réessayez plus tard.', 429);

  const body = await parseBody(request, (input) => parse(budgetSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  const property = await db.property.findFirst({
    where: { id: body.data.propertyId, userId: session.id },
    select: { id: true },
  });
  if (!property) return forbidden('Logement introuvable ou inaccessible.');

  // Un budget par catégorie et par logement : deux enveloppes identiques ne
  // pourraient jamais être additionnées, et `services.ts` n'en lirait qu'une.
  const existing = await db.budget.findFirst({
    where: { propertyId: property.id, category: body.data.category },
    select: { id: true },
  });
  if (existing) {
    return fail('Un budget existe déjà pour cette catégorie. Modifiez-le plutôt.', 409, 'category');
  }

  const budget = await db.budget.create({
    data: {
      propertyId: property.id,
      category: body.data.category,
      monthlyAmount: body.data.monthlyAmount,
    },
  });

  await audit({
    action: 'budget_created',
    entity: 'Budget',
    entityId: budget.id,
    userId: session.id,
    metadata: { category: budget.category },
  });

  return ok(serializeBudget(budget), 201);
}