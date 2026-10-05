import { jwtVerify } from 'jose';
import { db } from './db';
import { audit } from './audit';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  secretKey,
  signTokenPair,
  type SessionUser,
} from './auth-core';

// Rotation de jeton de rafraîchissement — flow.md §40.
//
// Trois règles :
// 1. le jeton n'est stocké que haché ;
// 2. chaque usage le RÉVOQUE et en émet un nouveau (rotation) ;
// 3. présenter un jeton déjà révoqué = vol probable → on révoque TOUTES les
//    sessions du compte. L'utilisateur devra se reconnecter.

export type RefreshContext = { userAgent?: string | null; ip?: string | null };

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshJti: string;
  user: SessionUser;
};

/**
 * Ouvre une session à la connexion.
 *
 * Purge opportuniste des sessions expirées : la connexion étant l'opération la
 * plus fréquente, elle suffit à faire décroître la table sans cron externe.
 */
export async function issueSession(user: SessionUser, ctx: RefreshContext = {}): Promise<TokenPair> {
  const pair = await signTokenPair(user);

  await db.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(pair.refreshJti),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    },
  });

  // purification best-effort : elle ne doit jamais faire échouer une connexion
  await purgeExpiredSessions().catch(() => 0);

  return { ...pair, user };
}

export type RefreshResult =
  | { ok: true; pair: TokenPair }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REUSE_DETECTED' };

/** Vérifie un jeton de rafraîchissement et en fait la rotation. */
export async function rotateSession(
  refreshToken: string,
  ctx: RefreshContext = {},
): Promise<RefreshResult> {
  // 1. le jeton doit être signé par nous et non expiré
  let payload: { sub?: string; phone?: string; jti?: string; firstName?: string | null };
  try {
    const { payload: p } = await jwtVerify(refreshToken, secretKey());
    payload = p as typeof payload;
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (!payload.sub || !payload.jti) return { ok: false, reason: 'INVALID' };

  // 2. le hash du jti doit correspondre à une session existante
  const session = await db.session.findUnique({
    where: { refreshTokenHash: hashRefreshToken(payload.jti) },
    include: { user: { select: { id: true, phone: true, firstName: true } } },
  });
  if (!session) return { ok: false, reason: 'INVALID' };

  // 3. réutilisation d'un jeton déjà révoqué → compromission suspectée
  //
  // ⚠ La vérification ci-dessous est une LECTURE. Deux requêtes simultanées
  // pourraient toutes deux voir `revokedAt = null` et toutes deux révoquer
  // puis émettre un nouveau couple : le même jeton produirait deux rotations
  // valides, et la détection de vol n’arrêterait plus rien.
  //
  // Le verrou est posé plus bas, à l'étape 4, par une mise à jour CONDITIONNELLE
  // : PostgreSQL ne peut mettre à jour que la ligne qui n'est pas encore
  // révoquée, donc une seule requête gagne la course.
  if (session.revokedAt) {
    await db.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit({
      action: 'refresh_token_reuse_detected',
      entity: 'Session',
      entityId: session.id,
      userId: session.userId,
      metadata: { ip: ctx.ip ?? null },
    });
    return { ok: false, reason: 'REUSE_DETECTED' };
  }

  if (session.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };

  // 4. ROTATION ATOMIQUE — c'est ici que se joue la course.
  //
  // `updateMany` avec `revokedAt: null` dans le WHERE pose un verrou de ligne
  // et ne touche que la session ENCORE ACTIVE. Si la requête concurrente est
  // arrivée avant, `count` vaut 0 : elle a gagné la course, et celle-ci est un
  // doublon écarté — sans être sanctionné, voir ci-dessous.
  const claimed = await db.session.updateMany({
    where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });

  if (claimed.count === 0) {
    // La session a été révoquée entre la lecture et l'écriture : une requête
    // concurrente a déjà roté CE jeton. C'est le comportement attendu d'une
    // rotation — le perdant perd, sans conséquence.
    //
    // ⚠ On ne sanctionne PAS ici. Une double-clic, un retry de proxy ou deux
    // onglets qui rafraîchissent en parallèle produiraient exactement ce cas :
    // sanctionner déconnecterait l'utilisateur alors que rien n'a été volé.
    //
    // La vraie réutilisation — un jeton rejoué APRÈS sa rotation, donc
    // durablement révoqué — reste prise en charge à l'étape 3.
    await audit({
      action: 'refresh_token_rotation_raced',
      entity: 'Session',
      entityId: session.id,
      userId: session.userId,
      metadata: { ip: ctx.ip ?? null },
    });
    return { ok: false, reason: 'INVALID' };
  }

  const user: SessionUser = {
    id: session.user.id,
    phone: session.user.phone,
    firstName: session.user.firstName,
  };
  const pair = await signTokenPair(user);

  // La nouvelle session est créée APRÈS la revendication : si la création
  // échouait, l'utilisateur resterait simplement déconnecté, sans jeton actif
  // orphelin pointant vers une session révoquée.
  await db.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(pair.refreshJti),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    },
  });

  await audit({ action: 'session_refreshed', entity: 'Session', userId: user.id });
  return { ok: true, pair: { ...pair, user } };
}

/** Révoque une session précise (déconnexion). */
export async function revokeByRefreshToken(refreshToken: string): Promise<void> {
  try {
    const { payload } = await jwtVerify(refreshToken, secretKey());
    if (!payload.jti) return;
    await db.session.updateMany({
      where: { refreshTokenHash: hashRefreshToken(payload.jti), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // jeton invalide : rien à révoquer
  }
}

/** Purge les sessions expirées — appelé périodiquement. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}