// Limites d'abonnement — flow.md §47.
//
// Principe : ne jamais bloquer la compréhension du produit. Les limites FREE
// portent sur le VOLUME (nombre de logements, de compteurs, d'historique), pas
// sur la capacité à comprendre ses propres données.
import { Prisma } from '@prisma/client';
import { db } from './db';

export type PlanName = 'FREE' | 'PREMIUM';

export const PLAN_LIMITS = {
  FREE: { properties: 1, meters: 2, historyMonths: 3 },
  PREMIUM: { properties: Infinity, meters: Infinity, historyMonths: Infinity },
} as const satisfies Record<PlanName, { properties: number; meters: number; historyMonths: number }>;

export type QuotaName = 'properties' | 'meters';

export function limitFor(plan: PlanName, quota: QuotaName): number {
  return PLAN_LIMITS[plan][quota];
}

/** Renvoie null si l'utilisateur peut encore créer, sinon un message en français. */
export function checkQuota(input: {
  plan: PlanName;
  quota: QuotaName;
  currentCount: number;
}): string | null {
  const limit = limitFor(input.plan, input.quota);
  if (input.currentCount < limit) return null;

  const label = input.quota === 'properties' ? 'logement' : 'compteur';
  if (input.plan === 'PREMIUM') return null;

  return `Votre formule gratuite est limitée à ${limit} ${label}${limit > 1 ? 's' : ''}. Passez à la formule Premium pour en ajouter davantage.`;
}

/**
 * Exécute `create` en réservant le quota, sans course (flow.md §47).
 *
 * ⚠ Compter, décider, puis créer laissait une fenêtre : deux requêtes
 * simultanées comptaient toutes deux « 0 logement », toutes deux étaient
 * autorisées, et le compte FREE finissait à 2.
 *
 * La vérification et la création ont donc lieu dans UNE SEULE transaction,
 * protégée par un verrou consultatif `pg_advisory_xact_lock` :
 * - le verrou est pris avant le comptage ;
 * - la requête concurrente attend au lieu de lire un état intermédiaire ;
 * - il disparaît au COMMIT ou au ROLLBACK, sans fuite.
 *
 * `pg_advisory_xact_lock` est préféré à `SELECT ... FOR UPDATE` sur `User` :
 * le second imposerait que chaque chemin d'écriture prenne ce verrou, et il
 * suffirait d'en oublier un pour rouvrir la faille. Celui-ci est pris ici, au
 * même endroit pour tous les appelants.
 *
 * @param create appelé DANS la transaction ; son annulation annule la réservation.
 * @returns ok avec la valeur créée, sinon le message de refus.
 */
export async function createWithinQuota<T>(input: {
  userId: string;
  plan: PlanName;
  quota: QuotaName;
  create: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  // PREMIUM n'est jamais limité : inutile de sérialiser ses écritures.
  if (input.plan === 'PREMIUM') {
    const value = await db.$transaction(input.create);
    return { ok: true, value };
  }

  try {
    const value = await db.$transaction(async (tx) => {
      // `pg_advisory_xact_lock` renvoie `void`, type que Prisma ne sait pas
      // désérialiser : le cast en `text` est ce qui rend la requête exécutable.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${input.userId}`}))::text`;

      const count =
        input.quota === 'properties'
          ? await tx.property.count({ where: { userId: input.userId } })
          : await tx.meter.count({ where: { property: { userId: input.userId } } });

      const refused = checkQuota({
        plan: input.plan,
        quota: input.quota,
        currentCount: count,
      });
      if (refused) throw new QuotaExceeded(refused);

      return input.create(tx);
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof QuotaExceeded) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Refus de quota, porté par une exception pour annuler la transaction.
 *
 * Lever est indispensable : le rollback annule aussi la création si elle avait
 * déjà eu lieu dans la transaction. Renvoyer un simple booléen la laisserait
 * passer.
 */
export class QuotaExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceeded';
  }
}

export const PREMIUM_FEATURES = [
  { label: 'Historique illimité', free: '3 mois', premium: 'Illimité' },
  { label: 'Logements', free: '1', premium: 'Illimité' },
  { label: 'Compteurs', free: '2', premium: 'Illimité' },
  { label: 'Prévisions avancées 30 / 90 jours', free: '30 jours', premium: '30 et 90 jours' },
  { label: 'Alertes avancées', free: 'Alertes essentielles', premium: 'Toutes les alertes' },
  { label: 'Rapports et analyse avancée', free: '—', premium: 'Inclus' },
  { label: 'Lecture automatique des reçus (OCR)', free: '—', premium: 'Prévu V1.1' },
] as const;