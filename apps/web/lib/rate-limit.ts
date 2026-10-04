import { db } from './db';

/**
 * Rate limiting en base (flow.md §40).
 * Fenêtre glissante simplifiée : on remet le compteur à zéro une fois la
 * fenêtre expirée. Suffisant pour le MVP et survives au redémarrage serveur.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = new Date();

  // flow.md §40 — le compteur doit être incrémenté de façon ATOMIQUE.
  //
  // La version lecture-puis-écriture avait une faille : deux requêtes
  // simultanées lisaient la même valeur et passaient toutes les deux, ce qui
  // doubleait la limite effective — inacceptable sur une protection anti-force
  // brute. On incrémente d'abord, puis on décide.
  //
  // `createMany` + `skipDuplicates` réserve la clé sans lever d'exception
  // (un `create` qui échouerait polluerait les journaux à chaque appel).
  const inserted = await db.rateLimit.createMany({
    data: [{ key, count: 1, windowStart: now }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return { allowed: true, retryAfterSeconds: 0 };

  // la clé existe déjà : on incrémente si la fenêtre est encore ouverte
  const incremented = await db.rateLimit.updateMany({
    where: { key, windowStart: { gt: new Date(now.getTime() - windowMs) } },
    data: { count: { increment: 1 } },
  });

  if (incremented.count === 0) {
    // fenêtre expirée : on repart à zéro
    await db.rateLimit.updateMany({
      where: { key },
      data: { count: 1, windowStart: now },
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // on relit pour connaître la valeur exacte après incrément
  const current = await db.rateLimit.findUnique({ where: { key } });
  if (!current) return { allowed: true, retryAfterSeconds: 0 };

  if (current.count > limit) {
    const retryAfterSeconds = Math.ceil(
      (current.windowStart.getTime() + windowMs - now.getTime()) / 1000,
    );
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Purge les compteurs expirés — appelé avant chaque vérification. */
export async function purgeExpiredRateLimits(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
}