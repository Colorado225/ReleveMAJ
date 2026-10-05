'use server';

import { randomInt } from 'node:crypto';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from './db';
import { createSession, destroySession } from './auth';
import { hashOtpCode, otpCodeMatches } from './auth-core';
import { checkRateLimit, purgeExpiredRateLimits } from './rate-limit';
import { rateLimitKey } from './client-ip';
import { deliverOtp } from './sms';
import { audit } from './audit';
import { requestOtpSchema, verifyOtpSchema } from './validation';
import { track } from './analytics';

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// flow.md §40 — on borne les abus sur les deux axes
const REQUEST_LIMIT = 3; // 3 demandes par téléphone par heure
const VERIFY_LIMIT = 10; // 10 vérifications par IP par heure

function hashCode(phone: string, code: string): string {
  return hashOtpCode(phone, code);
}

async function clientIp(): Promise<string> {
  const h = await headers();
  // §19 — la clé du quota ne se forge plus avec un `x-forwarded-for`.
  return rateLimitKey(h, 'otp');
}

/**
 * flow.md §33 — demande de code OTP.
 * En développement le code est renvoyé dans la réponse pour faciliter la
 * démonstration ; en production il ne doit jamais être exposé.
 */
export async function requestOtp(_prev: string | null, formData: FormData) {
  const parsed = requestOtpSchema.safeParse({ phone: formData.get('phone') });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Numéro invalide.';

  const { phone } = parsed.data;
  await purgeExpiredRateLimits();

  const limit = await checkRateLimit(`otp:request:${phone}`, REQUEST_LIMIT, 60 * 60 * 1000);
  if (!limit.allowed) {
    await audit({ action: 'otp_request_rate_limited', entity: 'OtpChallenge', metadata: { phone } });
    return `Trop de demandes. Réessayez dans ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  // les anciens codes encore valides sont invalidés : un seul code actif par numéro
  await db.otpChallenge.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const challenge = await db.otpChallenge.create({
    data: { phone, codeHash: hashCode(phone, code), expiresAt },
  });

  const delivery = await deliverOtp(phone, code);
  await audit({
    action: delivery.sent ? 'otp_requested' : 'otp_request_failed',
    entity: 'OtpChallenge',
    entityId: challenge.id,
    metadata: { phone, delivered: delivery.sent, reason: delivery.reason },
  });

  // flow.md §40 — les challenges OTP périmés n'ont plus d'intérêt et
  // la table croît à chaque demande.
  await db.otpChallenge
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } })
    .catch(() => ({ count: 0 }));

  if (delivery.devCode) return `Code de démonstration : ${delivery.devCode}`;
  if (!delivery.sent) {
    return "L'envoi du code a échoué. Réessayez dans quelques instants.";
  }
  return 'Code envoyé par SMS.';
}

export async function verifyOtp(_prev: string | null, formData: FormData) {
  const parsed = verifyOtpSchema.safeParse({
    phone: formData.get('phone'),
    code: formData.get('code'),
    firstName: formData.get('firstName') || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Données invalides.';

  const { phone, code, firstName } = parsed.data;

  const ip = await clientIp();
  const limit = await checkRateLimit(`otp:verify:${ip}`, VERIFY_LIMIT, 60 * 60 * 1000);
  if (!limit.allowed) {
    await audit({
      action: 'otp_verify_rate_limited',
      entity: 'OtpChallenge',
      metadata: { phone, ip },
    });
    return 'Trop de tentatives. Réessayez plus tard.';
  }

  const challenge = await db.otpChallenge.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge || challenge.expiresAt < new Date()) {
    await audit({ action: 'otp_verify_expired', entity: 'OtpChallenge', entityId: challenge?.id });
    return 'Code expiré. Demandez un nouveau code.';
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await audit({
      action: 'otp_verify_locked',
      entity: 'OtpChallenge',
      entityId: challenge.id,
    });
    return 'Trop de tentatives incorrectes. Demandez un nouveau code.';
  }

  // comparaison à temps constant pour ne pas fuir le code par timing
  if (!otpCodeMatches(phone, code, challenge.codeHash)) {
    await db.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    await audit({
      action: 'otp_verify_failed',
      entity: 'OtpChallenge',
      entityId: challenge.id,
      metadata: { phone, ip, attempts: challenge.attempts + 1 },
    });
    return 'Code incorrect.';
  }

  // consommation ATOMIQUE — c'est ici que se joue la course.
  //
  // ⚠ Le `challenge` ci-dessus est une LECTURE. Deux vérifications simultanées
  // du même code pourraient toutes deux le voir `consumedAt = null`, valider,
  // puis toutes deux consommer : un OTP à 6 chiffres donnerait deux sessions.
  //
  // `updateMany` avec `consumedAt: null` dans le WHERE ne met à jour que la
  // ligne ENCORE disponible : une seule des deux requêtes obtient `count === 1`.
  const consumed = await db.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  if (consumed.count === 0) {
    // Un concurrent a consommé ce code entre-temps : le même OTP servi
    // deux fois est exactement ce qu'on refuse d'accorder.
    await audit({
      action: 'otp_verify_replay_detected',
      entity: 'OtpChallenge',
      entityId: challenge.id,
      metadata: { phone, ip },
    });
    return 'Ce code vient d’être utilisé. Demandez-en un nouveau.';
  }

  const user = await db.user.upsert({
    where: { phone },
    update: firstName ? { firstName } : {},
    create: { phone, firstName: firstName ?? null },
  });

  await createSession({ id: user.id, phone: user.phone, firstName: user.firstName });
  await audit({ action: 'otp_verified', entity: 'User', entityId: user.id, userId: user.id });
  // flow.md §48 — activation mesurée
  await track('otp_verified', { userId: user.id });
  redirect('/');
}

export async function logout() {
  await destroySession();
  redirect('/connexion');
}
