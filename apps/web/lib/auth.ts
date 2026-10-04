// Couche « requête » : lecture/écriture du cookie de session.
// Tout le reste (signature, vérification, OTP) vit dans auth-core.ts afin d'être
// partagé avec l'API REST (flow.md §38).
import { cookies } from 'next/headers';
import {
  MAX_AGE_SECONDS,
  SESSION_COOKIE,
  signAccessToken,
  verifyAccessToken,
  type SessionUser,
} from './auth-core';

export type { SessionUser };

/** Crée un JWT court (2 h) stocké en cookie httpOnly. */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await signAccessToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Retourne l'utilisateur de la requête courante, ou null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}