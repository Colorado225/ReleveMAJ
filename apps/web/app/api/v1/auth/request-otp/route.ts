// POST /api/v1/auth/request-otp — flow.md §38.
// Retourne le code en réponse UNIQUEMENT hors production (aide au développement).
import { randomInt } from 'node:crypto';
import { db } from '@/lib/db';
import { hashOtpCode } from '@/lib/auth-core';
import { checkRateLimit, purgeExpiredRateLimits } from '@/lib/rate-limit';
import { deliverOtp } from '@/lib/sms';
import { audit } from '@/lib/audit';
import { requestOtpSchema } from '@/lib/validation';
import { fail, guardRateLimit, ok, parse, parseBody } from '@/lib/api';

const OTP_TTL_MINUTES = 10;
const REQUEST_LIMIT = 3; // 3 demandes par téléphone par heure

export async function POST(request: Request) {
  const body = await parseBody(request, (input) => parse(requestOtpSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  const { phone } = body.data;
  await purgeExpiredRateLimits();

  // flow.md §40 — on borne l'abus sur les deux axes : par téléphone et par IP
  const perPhone = await checkRateLimit(`otp:request:${phone}`, REQUEST_LIMIT, 60 * 60 * 1000);
  if (!perPhone.allowed) {
    await audit({ action: 'otp_request_rate_limited', entity: 'OtpChallenge', metadata: { phone } });
    return fail(`Trop de demandes. Réessayez dans ${Math.ceil(perPhone.retryAfterSeconds / 60)} minute(s).`, 429);
  }
  const perIp = await guardRateLimit(request, 'otp:request', 10, 60 * 60 * 1000);
  if (!perIp.allowed) return fail('Trop de demandes depuis ce réseau. Réessayez plus tard.', 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  // un seul code actif par numéro : les anciens sont invalidés
  await db.otpChallenge.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date() } });
  const challenge = await db.otpChallenge.create({
    data: { phone, codeHash: hashOtpCode(phone, code), expiresAt },
  });

  const delivery = await deliverOtp(phone, code);
  await audit({
    action: delivery.sent ? 'otp_requested' : 'otp_request_failed',
    entity: 'OtpChallenge',
    entityId: challenge.id,
    metadata: { phone, delivered: delivery.sent, reason: delivery.reason },
  });

  if (!delivery.sent && !delivery.devCode) {
    return fail("L'envoi du code a échoué. Réessayez dans quelques instants.", 502);
  }

  return ok({
    sent: delivery.sent || Boolean(delivery.devCode),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
  });
}