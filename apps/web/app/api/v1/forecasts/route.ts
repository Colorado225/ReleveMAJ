// GET /api/v1/forecasts — flow.md §38 et §29.
//
// V1 sans machine learning : moyenne journalière observée × jours restants.
// flow.md §47 : l'horizon 90 jours est réservé au Premium, le 30 jours est
// toujours accessible — on n'interdit jamais de comprendre ses données.
import { db } from '@/lib/db';
import { authenticate, ok, unauthorized } from '@/lib/api';
import { projectionInput } from '@/lib/services';
import { track } from '@/lib/analytics';
import { calculateMonthlyProjection } from '@conso-ci/tariff-engine';
import type { PlanName } from '@/lib/plans';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  // On ne charge PAS getDashboard ici : ses alertes et recommandations ne sont
  // pas exposées par cette route, et le calculer coutait une requête de plus
  // par appel.
  const [user, budgets] = await Promise.all([
    db.user.findUnique({ where: { id: session.id }, select: { plan: true } }),
    db.budget.findMany({
      where: { property: { userId: session.id } },
      select: { category: true, monthlyAmount: true },
    }),
  ]);

  const isPremium = (user?.plan ?? 'FREE') === ('PREMIUM' as PlanName);
  const now = new Date();

  // Montant moyen journalier observé, fenêtre glissante de 90 jours (flow.md §29)
  const purchases = await db.electricityPurchase.findMany({
    where: { meter: { property: { userId: session.id } } },
    select: { purchasedAt: true, amountPaid: true },
  });
  const proj = projectionInput(purchases, now);
  const amountPerDay = proj.amountPerDay;

  const horizons = [30, 90];
  const forecasts = horizons
    // flow.md §47 — horizons avancés réservés au Premium
    .filter((days) => isPremium || days === 30)
    // flow.md §34 — pas de projection sans historique suffisant
    .filter(() => proj.reliable)
    .map((days) => {
      const p = calculateMonthlyProjection({
        dailyAverage: amountPerDay ?? 0,
        days,
        amountPerDay,
      });
      return {
        horizonDays: days,
        projectedAmount: p.projectedAmount,
        dailyAverageAmount: p.dailyAverage,
        // flow.md §29 et §51 — toujours « projection », jamais « prévision garantie »
        status: 'FORECAST' as const,
        label: 'Projection',
        caveat: p.caveat,
        locked: false,
      };
    });

  const budget = budgets.find((b) => b.category === 'ELECTRICITY') ?? null;
  const projected30 = forecasts.find((f) => f.horizonDays === 30)?.projectedAmount ?? null;

  await track('forecast_viewed', { userId: session.id, metadata: { hasBudget: Boolean(budget) } });

  return ok({
    plan: user?.plan ?? 'FREE',
    forecasts,
    // L'horizon 90 jours reste visible en Free (verrouillé) pour que la valeur
    // Premium soit compréhensible avant toute décision de paiement (flow.md §61).
    upgrade: isPremium
      ? null
      : {
          available: horizons.filter((d) => d !== 30).map((days) => ({
            horizonDays: days,
            locked: true,
            reason: 'La projection 90 jours fait partie de la formule Premium.',
          })),
        },
    budget: budget
      ? {
          category: budget.category,
          monthlyAmount: budget.monthlyAmount,
          projected30,
          willExceed: projected30 != null && projected30 > budget.monthlyAmount,
        }
      : null,
    basedOn: {
      amountPerDay: Math.round((amountPerDay ?? 0) * 100) / 100,
      observedDays: proj.observedDays,
      observedSpend: proj.observedSpend,
      windowDays: 90,
      reliable: proj.reliable,
      method: 'moyenne journalière observée sur 90 jours',
    },
  });
}