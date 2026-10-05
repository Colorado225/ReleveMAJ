// GET + POST /api/v1/meters — flow.md §38, §9 et §25.
import { db } from '@/lib/db';
import { authenticate, fail, forbidden, guardRateLimit, ok, parse, readJson, unauthorized } from '@/lib/api';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';
import { createWithinQuota, type PlanName } from '@/lib/plans';
import { createMeterSchema } from '@/lib/validation';
import { checkMeterCoherence } from '@/lib/meter-identity';

type MeterRow = {
  id: string;
  propertyId: string;
  provider: string;
  utilityType: string;
  meterType: string;
  paymentMode: string;
  meterNumber: string | null;
  subscribedPower: number | null;
  unit: string;
  label: string | null;
  active: boolean;
  createdAt: Date;
};

function serializeMeter(m: MeterRow) {
  return {
    id: m.id,
    propertyId: m.propertyId,
    provider: m.provider,
    utilityType: m.utilityType,
    meterType: m.meterType,
    paymentMode: m.paymentMode,
    meterNumber: m.meterNumber,
    subscribedPower: m.subscribedPower,
    unit: m.unit,
    label: m.label,
    active: m.active,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  // flow.md §40 — isolation par utilisateur
  const meters = await db.meter.findMany({
    where: { property: { userId: session.id } },
    orderBy: { createdAt: 'asc' },
    include: { property: { select: { name: true } } },
  });

  return ok(meters.map((m) => ({ ...serializeMeter(m), propertyName: m.property.name })));
}

export async function POST(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'meter:create', 30, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de créations. Réessayez plus tard.', 429);

  const json = await readJson(request);
  if (!json.raw) return fail(json.error.error, 400);
  const raw = json.raw;

  const propertyId = typeof raw.propertyId === 'string' ? raw.propertyId : '';
  const property = await db.property.findFirst({
    where: { id: propertyId, userId: session.id },
  });
  // flow.md §52 — logement inexistant ou appartenant à autrui : indistinguable
  if (!property) return forbidden('Logement introuvable ou inaccessible.');

  const body = parse(createMeterSchema, raw);
  if (!body.success) return fail(body.error.error, 422, body.error.field);

  // instr.md §11 — même cohérence réseau/type que la Server Action : un
  // compteur « CIE » en eau serait incohérent dès sa création, et impossible à
  // rattraper ensuite puisque `provider` ne bouge plus.
  const incoherent = checkMeterCoherence({
    provider: body.data.provider,
    utilityType: body.data.utilityType,
  });
  if (incoherent) return fail(incoherent, 422);

  // flow.md §47 — quota FREE : porte sur le volume, pas sur la compréhension.
  //
  // Comptage et création dans UNE transaction verrouillée : deux requêtes
  // simultanées ne peuvent pas toutes deux constater qu'il reste un compteur.
  const user = await db.user.findUnique({ where: { id: session.id } });

  // flow.md §9 — le mode de paiement est conservé tel quel, jamais supposé
  const unit = body.data.utilityType === 'ELECTRICITY' ? 'KWH' : 'M3';
  const created = await createWithinQuota({
    userId: session.id,
    plan: (user?.plan ?? 'FREE') as PlanName,
    quota: 'meters',
    create: (tx) =>
      tx.meter.create({
        data: {
          propertyId: property.id,
          provider: body.data.provider,
          utilityType: body.data.utilityType,
          paymentMode: body.data.paymentMode,
          meterNumber: body.data.meterNumber,
          subscribedPower: body.data.subscribedPower,
          label: body.data.label,
          unit,
        },
      }),
  });
  if (!created.ok) return fail(created.message, 402);
  const meter = created.value;

  await audit({ action: 'meter_created', entity: 'Meter', entityId: meter.id, userId: session.id });
  await track('meter_created', { userId: session.id, metadata: { utilityType: body.data.utilityType } });

  return ok(serializeMeter(meter), 201);
}
