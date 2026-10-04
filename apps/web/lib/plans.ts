// Limites d'abonnement — flow.md §47.
//
// Principe : ne jamais bloquer la compréhension du produit. Les limites FREE
// portent sur le VOLUME (nombre de logements, de compteurs, d'historique), pas
// sur la capacité à comprendre ses propres données.
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

export const PREMIUM_FEATURES = [
  { label: 'Historique illimité', free: '3 mois', premium: 'Illimité' },
  { label: 'Logements', free: '1', premium: 'Illimité' },
  { label: 'Compteurs', free: '2', premium: 'Illimité' },
  { label: 'Prévisions avancées 30 / 90 jours', free: '30 jours', premium: '30 et 90 jours' },
  { label: 'Alertes avancées', free: 'Alertes essentielles', premium: 'Toutes les alertes' },
  { label: 'Rapports et analyse avancée', free: '—', premium: 'Inclus' },
  { label: 'Lecture automatique des reçus (OCR)', free: '—', premium: 'Prévu V1.1' },
] as const;