import { db } from './db';

/**
 * Rate limiting en base (flow.md §40).
 * Fenêtre glissante simplifiée : on remet le compteur à zéro une fois la
 * fenêtre expirée. Suffisant pour le MVP et survives au redémarrage serveur.
 */
/**
 * Identifiant au format CUID2, celui que Prisma génère pour `@default(cuid())`.
 *
 * Le SQL brut doit fournir l'`id` lui-même : Prisma ne le fait pas pour une
 * requête `$queryRaw`, et la colonne est `NOT NULL`. On reproduit donc le format
 * attendu plutôt que d'insérer une dépendance — le champ n'est qu'une clé
 * primaire sans signification, seule l'unicité compte.
 */
function createId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'c';
  for (let i = 0; i < 24; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = new Date();

  // flow.md §40 — le décompte ET la décision tiennent dans UNE seule instruction
  // SQL. C'est le seul moyen de supprimer la fenêtre entre « lire le compteur »
  // et « décider ».
  //
  // ⚠ Les deux tentatives précédentes échouaient :
  //
  // 1. `count` puis `update` : deux requêtes simultanées lisaient la même
  //    valeur et passaient toutes les deux.
  // 2. Même avec un incrément atomique, la RÉINITIALISATION restait une course :
  //    dès que la première requête remettait `windowStart = now`, les suivantes
  //    retrouvaient une fenêtre ouverte et s'incrémentaient au lieu d'être
  //    comptées. Le compteur repartait de 1 à chaque fois — vérifié par un test.
  //
  // Ici un `CASE` décide de tout dans la clause `DO UPDATE` :
  // - fenêtre expirée → `count = 1` et `windowStart = now` ;
  // - fenêtre ouverte → `count + 1`, `windowStart` inchangé.
  //
  // `RETURNING` rend la valeur DÉFINITIVE après écriture : aucune relecture,
  // et le décompte est exact même si cinq requêtes arrivent ensemble.
  //
  // `db.$queryRaw` est nécessaire car Prisma n'expose pas d'UPSERT
  // conditionnel. Toutes les valeurs sont des paramètres liés, jamais
  // interpolées : aucune injection possible.
  const seuil = new Date(now.getTime() - windowMs);

  const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "windowStart")
    VALUES (${createId()}, ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE
      SET "count" = CASE WHEN "RateLimit"."windowStart" > ${seuil}
                         THEN "RateLimit"."count" + 1
                         ELSE 1 END,
          "windowStart" = CASE WHEN "RateLimit"."windowStart" > ${seuil}
                               THEN "RateLimit"."windowStart"
                               ELSE ${now} END
      RETURNING "count", "windowStart"
  `;

  const { count, windowStart } = rows[0];
  if (count > limit) {
    const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Purge les compteurs expirés — appelé avant chaque vérification. */
export async function purgeExpiredRateLimits(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
}