import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Robustesse du pool de connexions.
 *
 * `DATABASE_URL` pointe sur le pooler Neon (`…-pooler…` + `pgbouncer=true`) :
 * c'est la bonne pratique côté Neon, mais le pooler coupe lui-même les
 * connexions inactives au bout de quelques secondes. Le pool Prisma, lui, les
 * conserve : il ressort alors une connexion déjà morte et l'appel échoue
 *
 *     Invalid `prisma.user.findUnique()` invocation: Server has closed the connection.
 *     code: 'P1017'
 *
 * Ce n'est pas une panne de la base, c'est une connexion périmée. On la
 * détecte, on laisse Prisma rouvrir une connexion neuve et on rejoue l'appel.
 */

/** Codes Prisma qui signifient « connexion morte », pas « requête invalide ». */
const RETRYABLE_CODES = new Set(['P1001', 'P1017', 'P2024', 'P2028']);

/** Messages des erreurs qui remontent avant même d'avoir un code Prisma. */
const RETRYABLE_MESSAGES = [
  /server has closed the connection/i,
  /connection (?:was )?(?:reset|closed|terminated)/i,
  /terminating connection/i,
  /can't reach database server/i,
  /timed out fetching a new connection/i,
  /econnreset/i,
];

/** Nombre de tentatives au total (1 essai + 2 reprises). */
const MAX_ATTEMPTS = 3;

/** Pause avant chaque reprise : courte, la connexion neuve arrive en ms. */
const RETRY_DELAY_MS = 150;

/**
 * Cette erreur est-elle Due à une connexion morte et donc rejouable ?
 *
 * Exposé pour les tests : c'est la seule règle métier ici, tout le reste est
 * du câblage Prisma.
 */
export function isRetryableConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_CODES.has(error.code);
  }
  // `PrismaClientInitializationError` et les erreurs réseau brutes (wrappées
  // par Next.js) ne portent pas de code : seul le message les trahit.
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MESSAGES.some((pattern) => pattern.test(message));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rejoue `run` tant que l'échec vient d'une connexion morte.
 *
 * Limite volontairement étroite : seules ces erreurs sont rejouées. Une
 * violation de contrainte (`P2002`) ou une requête invalide (`P3xxx`) remonte
 * immédiatement — la rejouer ne donnerait qu'une seconde erreur identique.
 *
 * ⚠ Les écritures sont rejouées elles aussi. C'est sans conséquence ici parce
 * que Prisma lève `P1017` avant d'envoyer quoi que ce soit au serveur : la
 * connexion est déjà morte quand l'erreur remonte, la requête n'a donc jamais
 * été appliquée. Les transactions interactives (`db.$transaction`) ne passent
 * pas par ce middleware et ne sont pas rejouées.
 */
export async function withConnectionRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableConnectionError(error) || attempt === MAX_ATTEMPTS) throw error;
      lastError = error;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // `$extends` enveloppe chaque opération : le retry est donc appliqué
  // uniformément, sans que chaque appelant ait à s'en soucier.
  // Les arguments `model` et `operation` sont fournis par Prisma mais inutiles
  // ici : le retry ne dépend pas de l'entité visée.
  return client.$extends({
    name: 'retryOnClosedConnection',
    query: {
      $allOperations: ({ args, query }) => withConnectionRetry(() => query(args)),
    },
  }) as unknown as PrismaClient;
}

// Singleton : évite d'ouvrir un nouveau pool de connexions à chaque hot-reload
// en développement (recommandation officielle Next.js + Prisma).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;