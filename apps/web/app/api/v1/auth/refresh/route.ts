// POST /api/v1/auth/refresh — flow.md §40.
// Rotation du jeton : l'ancien est révoqué, un nouveau couple est renvoyé.
// Un jeton déjà utilisé est refusé ET déclenche la révocation de toutes les
// sessions du compte (détection de vol).
import { fail, guardRateLimit, ok } from '@/lib/api';
import { rotateSession } from '@/lib/sessions';
import { REFRESH_TOKEN_TTL_SECONDS } from '@/lib/auth-core';

export async function POST(request: Request) {
  const limited = await guardRateLimit(request, 'auth:refresh', 30, 60 * 60 * 1000);
  if (!limited.allowed) return fail('Trop de tentatives. Réessayez plus tard.', 429);

  let body: { refreshToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail('Corps de requête JSON invalide.');
  }

  const token =
    typeof body.refreshToken === 'string'
      ? body.refreshToken
      : // le front web utilise le cookie httpOnly
        (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)consoci_refresh=([^;]+)/)?.[1];

  if (!token) return fail('Jeton de rafraîchissement manquant.', 401);

  const result = await rotateSession(decodeURIComponent(token), {
    userAgent: request.headers.get('user-agent'),
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      null,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'REUSE_DETECTED':
        // on ne détaille pas pourquoi : un attaquant ne doit rien apprendre
        return fail('Session invalide. Reconnectez-vous.', 401);
      case 'EXPIRED':
        return fail('Session expirée. Reconnectez-vous.', 401);
      default:
        return fail('Session invalide. Reconnectez-vous.', 401);
    }
  }

  return ok({
    accessToken: result.pair.accessToken,
    refreshToken: result.pair.refreshToken,
    tokenType: 'Bearer',
    expiresInSeconds: 7200,
    refreshExpiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
    user: result.pair.user,
  });
}