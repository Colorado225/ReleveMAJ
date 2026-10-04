// GET /api/v1/me — flow.md §38.
import { db } from '@/lib/db';
import { authenticate, ok, unauthorized } from '@/lib/api';
import { PLAN_LIMITS, type PlanName } from '@/lib/plans';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const user = await db.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      plan: true,
      createdAt: true,
      _count: { select: { properties: true } },
    },
  });
  if (!user) return unauthorized('Compte introuvable.');

  const plan = user.plan as PlanName;

  // flow.md §51 — une limite non applicable est signalée explicitement.
  // `Infinity` n'est pas sérialisable en JSON (JSON.stringify le transforme en
  // `null`) : l'envoyer tel quel ferait croire à un client que la limite vaut 0.
  const raw = PLAN_LIMITS[plan];
  const serializable = (value: number) => (Number.isFinite(value) ? value : null);

  return ok({
    id: user.id,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    plan,
    createdAt: user.createdAt.toISOString(),
    limits: {
      properties: serializable(raw.properties),
      meters: serializable(raw.meters),
      historyMonths: serializable(raw.historyMonths),
    },
    propertyCount: user._count.properties,
  });
}