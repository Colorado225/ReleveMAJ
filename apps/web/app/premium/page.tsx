import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card } from '@/components/ui';
import { PLAN_LIMITS, PREMIUM_FEATURES, type PlanName } from '@/lib/plans';

export const dynamic = 'force-dynamic';

// Page Formule — flow.md §47.
// Le paiement n'est pas implémenté en V1 : on explique ce que Premium apporte et
// on laisse le choix, sans jamais bloquer l'accès aux données existantes.
export default async function PremiumPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const user = await db.user.findUnique({ where: { id: session.id }, select: { plan: true } });
  const plan = (user?.plan ?? 'FREE') as PlanName;
  const isPremium = plan === 'PREMIUM';

  return (
    <AppShell title="Formule">
      <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Votre formule</h1>
        <p className="mt-1 text-sm text-gray-500">
          {isPremium
            ? 'Vous disposez de la formule Premium. Merci de soutenir ConsoCI.'
            : 'La formule gratuite suffit pour comprendre vos dépenses. Premium débloque le volume et les projections longues.'}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-semibold">Gratuite</h2>
            <p className="mt-1 text-3xl font-semibold tracking-tight">0 FCFA</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-gray-600">
              <li className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                {PLAN_LIMITS.FREE.properties} logement
              </li>
              <li className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                {PLAN_LIMITS.FREE.meters} compteurs
              </li>
              <li className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                {PLAN_LIMITS.FREE.historyMonths} mois d’historique
              </li>
              <li className="flex gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                Projections sur 30 jours
              </li>
            </ul>
            {!isPremium && (
              <p className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
                Formule actuelle. Vos données restent accessibles et ne seront jamais supprimées.
              </p>
            )}
          </Card>

          <Card className="border-gray-900 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Premium</h2>
              {isPremium && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  Active
                </span>
              )}
            </div>
            <p className="mt-1 text-3xl font-semibold tracking-tight">Bientôt</p>
            <p className="mt-2 text-sm text-gray-500">
              Le paiement n’est pas encore disponible. Le passage à la formule Premium sera activé au
              lancement commercial.
            </p>
          </Card>
        </div>

        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Ce que change Premium</h2>
          <ul className="mt-4 flex flex-col divide-y divide-gray-100">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f.label} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="text-gray-700">{f.label}</span>
                <span className="text-right">
                  <span className="text-gray-400 line-through">{f.free}</span>
                  <span className="ml-2 font-medium text-gray-900">{f.premium}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <p className="mt-4 text-xs leading-5 text-gray-400">
          flow.md §47 — le paiement n’est jamais imposé avant que l’utilisateur ait compris la valeur du
          produit. Vos données et votre historique vous appartiennent quelle que soit la formule.
        </p>
      </main>
    </AppShell>
  );
}