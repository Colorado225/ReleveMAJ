// GET + PATCH /api/v1/me — flow.md §38.
//
// Le téléphone et le palier ne sont PAS modifiables : le téléphone est
// l'identité de connexion (le changer exige une vérification OTP sur le nouveau
// numéro), et le palier relève de la facturation. `updateProfileSchema` ne les
// expose donc pas — un client qui les envoie verra simplement les voir ignorés.
import { db } from '@/lib/db';
import { authenticate, fail, guardRateLimit, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { PLAN_LIMITS, type PlanName } from '@/lib/plans';
import { updateProfileSchema } from '@/lib/validation';

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

export async function PATCH(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'profile:update', 20, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de modifications. Réessayez plus tard.', 429);

  const body = await parseBody(request, (input) => parse(updateProfileSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  // Un champ absent ne doit pas effacer une valeur existante : on ne touche que
  // les champs réellement transmis.
  //
  // ⚠ `?? null` ne suffirait PAS : `''` n'est ni `null` ni `undefined`, donc
  // `'' ?? null` vaut `''`. Une chaîne vide eftée réellement le champ, ce qui
  // laisserait « prénom renseigné mais vide » dans la base et à l'affichage.
  // D'où la normalisation explicite.
  const data: { firstName?: string | null; lastName?: string | null } = {};
  if ('firstName' in body.data) {
    const v = body.data.firstName?.trim();
    data.firstName = v ? v : null;
  }
  if ('lastName' in body.data) {
    const v = body.data.lastName?.trim();
    data.lastName = v ? v : null;
  }

  if (Object.keys(data).length === 0) return fail('Aucun champ à modifier.', 422);

  const user = await db.user.update({ where: { id: session.id }, data });
  await audit({ action: 'profile_updated', entity: 'User', entityId: user.id, userId: session.id });

  return ok({
    id: user.id,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    plan: user.plan,
    updatedAt: user.updatedAt.toISOString(),
  });
}