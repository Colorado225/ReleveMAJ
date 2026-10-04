// GET + POST /api/v1/meters/:id/readings — flow.md §38, §36, §21.
import { db } from '@/lib/db';
import { authenticate, fail, forbidden, guardRateLimit, notFound, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { addReading } from '@/lib/services';
import { track } from '@/lib/analytics';
import { createReadingSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const { id } = await context.params;
  // flow.md §40 — un compteur d'un autre utilisateur est « introuvable »
  const meter = await db.meter.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!meter) return notFound('Compteur introuvable.');

  const readings = await db.meterReading.findMany({
    where: { meterId: id },
    orderBy: { readingDate: 'desc' },
    take: 200,
  });

  return ok(
    readings.map((r) => ({
      id: r.id,
      value: r.value,
      unit: r.unit,
      // flow.md §10 — la nature de la valeur reste toujours explicite
      readingType: r.readingType,
      readingDate: r.readingDate.toISOString(),
      source: r.source,
      confidence: r.confidence,
      note: r.note,
    })),
  );
}

export async function POST(request: Request, context: Ctx) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const limited = await guardRateLimit(request, 'reading:create', 120, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de relevés. Réessayez plus tard.', 429);

  const { id } = await context.params;
  const meter = await db.meter.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true, active: true },
  });
  if (!meter) return notFound('Compteur introuvable.');
  // flow.md §52 — compteur désactivé
  if (!meter.active) return forbidden('Ce compteur est désactivé.');

  const body = await parseBody(request, (input) => parse(createReadingSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  try {
    const result = await addReading({
      meterId: meter.id,
      value: body.data.value,
      unit: body.data.unit,
      readingType: body.data.readingType,
      readingDate: body.data.readingDate,
      note: body.data.note,
    });

    // flow.md §48 — « first_reading » n'est émis qu'une fois, au tout premier relevé
    const previousReadings = await db.meterReading.count({
      where: {
        meter: { property: { userId: session.id } },
        id: { not: result.reading.id },
      },
    });
    if (previousReadings === 0) {
      await track('first_reading', { userId: session.id, metadata: { readingType: body.data.readingType } });
    }

    return ok(
      {
        reading: {
          id: result.reading.id,
          value: result.reading.value,
          unit: result.reading.unit,
          readingType: result.reading.readingType,
          readingDate: result.reading.readingDate.toISOString(),
          source: result.reading.source,
          confidence: result.reading.confidence,
        },
        period: result.period
          ? {
              id: result.period.id,
              quantity: result.period.quantity,
              unit: 'M3',
              dailyAverage: result.period.dailyAverage,
              startDate: result.period.startDate.toISOString(),
              endDate: result.period.endDate.toISOString(),
              status: result.period.anomaly ? 'UNKNOWN' : 'CALCULATED',
              // flow.md §21 — on signale, on ne supprime jamais la donnée
              anomaly: result.period.anomaly,
              anomalyNote: result.period.anomalyNote,
            }
          : null,
      },
      201,
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Enregistrement impossible.');
  }
}