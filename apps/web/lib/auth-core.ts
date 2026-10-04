// Noyau d'authentification — sans dépendance à next/headers, afin d'être
// réutilisable par les Server Actions ET par les routes /api/v1 (flow.md §38).
// flow.md §40 : JWT signé, secret obligatoire, comparaison à temps constant.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'consoci_session';
export const REFRESH_COOKIE = 'consoci_refresh';
export const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 jours
export const ACCESS_TOKEN_TTL = '2h';
/** flow.md §40 — le jeton de rafraîchissement dure plus longtemps que l'accès. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

export type SessionUser = {
  id: string;
  phone: string;
  firstName: string | null;
};

export function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET manquant dans .env');
  return new TextEncoder().encode(secret);
}

/** OTP haché avec un secret applicatif : un code seul ne doit rien révéler. */
export function hashOtpCode(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}:${process.env.AUTH_SECRET ?? ''}`).digest('hex');
}

/**
 * flow.md §40 — hash du jeton de rafraîchissement.
 * SHA-256 suffit ici : le jeton est une valeur aléatoire à haute entropie
 * (JTI), pas un mot de passe choisi par un humain. Le secret applicatif évite
 * qu'une fuite de base seule permette le rapprochement par dictionnaire.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256')
    .update(`${token}:${process.env.AUTH_SECRET ?? ''}`)
    .digest('hex');
}

/** Comparaison à temps constant : ne jamais fuir le code par timing. */
export function otpCodeMatches(phone: string, code: string, expectedHash: string): boolean {
  return constantTimeEquals(Buffer.from(hashOtpCode(phone, code), 'hex'), Buffer.from(expectedHash, 'hex'));
}

function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Signe un jeton d'accès JWT (HS256). */
export async function signAccessToken(
  user: SessionUser,
  ttl: string = ACCESS_TOKEN_TTL,
): Promise<string> {
  return new SignJWT({ phone: user.phone, firstName: user.firstName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secretKey());
}

/**
 * Signe un couple de jetons (accès + rafraîchissement).
 *
 * Le jeton d'accès est un JWT court used par l'API. Le jeton de rafraîchissement
 * est un JWT distinct portant un `jti` unique : c'est ce `jti` qui est haché et
 * stocké en base. Il n'est jamais renvoyé ailleurs que dans la réponse / cookie.
 */
export async function signTokenPair(user: SessionUser): Promise<{
  accessToken: string;
  refreshToken: string;
  refreshJti: string;
}> {
  const accessToken = await signAccessToken(user);
  const refreshJti = randomUUID();
  const refreshToken = await new SignJWT({ phone: user.phone, jti: refreshJti, typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());

  return { accessToken, refreshToken, refreshJti };
}

/** Vérifie un jeton et renvoie l'utilisateur, ou null si invalide/expiré. */
export async function verifyAccessToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      phone: String(payload.phone ?? ''),
      firstName: (payload.firstName as string | null) ?? null,
    };
  } catch {
    return null;
  }
}