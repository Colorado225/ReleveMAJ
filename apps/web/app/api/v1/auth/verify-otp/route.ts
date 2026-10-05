// POST /api/v1/auth/verify-otp — flow.md §38 et §40.
// Renvoie un jeton d'accès JWT à présenter ensuite en `Authorization: Bearer`.
import { db } from '@/lib/db';
import { otpCodeMatches, hashRefreshToken, signTokenPair, REFRESH_TOKEN_TTL_SECONDS } from '@/lib/auth-core';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';
import { verifyOtpSchema } from '@/lib/validation';
import { fail, guardRateLimit, ok, parse, parseBody, unauthorized } from '@/lib/api';
import { resolveClientIp } from '@/lib/client-ip';

const MAX_ATTEMPTS = 5;
const VERIFY_LIMIT = 10; // 10 vérifications par IP par heure

export async function POST(request: Request) {
  const body = await parseBody(request, (input) => parse(verifyOtpSchema, input));
  if (body.error) return fail(body.error.error, 422, body.error.field);

  const { phone, code, firstName } = body.data;

  const perIp = await guardRateLimit(request, 'otp:verify', VERIFY_LIMIT, 60 * 60 * 1000);
  if (!perIp.allowed) return fail('Trop de tentatives. Réessayez plus tard.', 429);

  const challenge = await db.otpChallenge.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge || challenge.expiresAt < new Date()) {
    await audit({ action: 'otp_verify_expired', entity: 'OtpChallenge', entityId: challenge?.id });
    return unauthorized('Code expiré. Demandez un nouveau code.');
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await audit({ action: 'otp_verify_locked', entity: 'OtpChallenge', entityId: challenge.id });
    return unauthorized('Trop de tentatives incorrectes. Demandez un nouveau code.');
  }

  if (!otpCodeMatches(phone, code, challenge.codeHash)) {
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    await audit({
      action: 'otp_verify_failed',
      entity: 'OtpChallenge',
      entityId: challenge.id,
      metadata: { phone, attempts: challenge.attempts + 1 },
    });
    return unauthorized('Code incorrect.');
  }

  await db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

  const existing = await db.user.findUnique({ where: { phone } });
  const user = await db.user.upsert({
    where: { phone },
    update: firstName ? { firstName } : {},
    create: { phone, firstName: firstName ?? null },
  });

  await audit({ action: 'otp_verified', entity: 'User', entityId: user.id, userId: user.id });
  // flow.md §48 — premier signup differentiated de la simple vérification
  await track(existing ? 'otp_verified' : 'signup', { userId: user.id });

  const { accessToken, refreshToken, refreshJti } = await signTokenPair({
    id: user.id,
    phone: user.phone,
    firstName: user.firstName,
  });

  // flow.md §40 — le refresh token n'est stocké que haché, et sa durée dépasse
  // celle du jeton d'accès pour permettre un renouvellement silencieux.
  await db.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshJti),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      // §19 — une IP non établie vaut mieux qu'une IP forgée : elle est absente
      // de l'audit plutôt que fausse.
      ip: resolveClientIp(request.headers).ip,
      userAgent: request.headers.get('user-agent'),
    },
  });

  return ok({
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresInSeconds: 7200,
    refreshExpiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
    user: { id: user.id, phone: user.phone, firstName: user.firstName, plan: user.plan },
  });
}