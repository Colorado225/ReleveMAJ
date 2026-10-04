// Analytics produit — flow.md §48 et §49.
// Les indicateurs sont calculés depuis les événements réellement enregistrés.
// Aucun chiffre n'est estimé ni extrapolé sans source.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireBackOffice } from '@/lib/backoffice';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

export default async function AnalyticsPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');
  if (!(await requireBackOffice(session)).allowed) {
    return (
      <AppShell title="Analytics">
        <main className="mx-auto max-w-2xl px-4 py-5">
          <EmptyState title="Accès réservé." body="Seuls les administrateurs peuvent consulter les analytics." />
        </main>
      </AppShell>
    );
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);

  const [totalUsers, newUsers30, active7, activated, events, firstReading, firstPurchase] =
    await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: d30 } } }),
      db.user.count({ where: { productEvents: { some: { createdAt: { gte: d7 } } } } }),
      // activation = au moins un relevé ET au moins une recharge
      db.user.count({
        where: {
          AND: [
            { properties: { some: { meters: { some: { readings: { some: {} } } } } } },
            { properties: { some: { meters: { some: { electricityPurchases: { some: {} } } } } } },
          ],
        },
      }),
      db.productEvent.findMany({ where: { createdAt: { gte: d30 } }, select: { event: true } }),
      db.user.count({
        where: { productEvents: { some: { event: 'first_reading' } } },
      }),
      db.user.count({
        where: { productEvents: { some: { event: 'first_purchase' } } },
      }),
    ]);

  // Répartition des événements sur 30 jours
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.event, (counts.get(e.event) ?? 0) + 1);

  // Rétention D7 : signups des 30 derniers jours, puis activité à J+7
  const signups = await db.user.findMany({
    where: { createdAt: { gte: d30 } },
    select: { id: true, createdAt: true },
  });
  const cohortIds = signups
    .filter((u) => u.createdAt.getTime() <= now.getTime() - 7 * DAY)
    .map((u) => u.id);
  const retained7 =
    cohortIds.length === 0
      ? null
      : await db.productEvent.groupBy({
          by: ['userId'],
          where: { userId: { in: cohortIds }, createdAt: { gte: d7 } },
        });

  const retainedCount = retained7?.length ?? 0;
  const retention7 = cohortIds.length === 0 ? null : Math.round((retainedCount / cohortIds.length) * 1000) / 10;

  const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

  return (
    <AppShell title="Analytics">
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Indicateurs produits calculés depuis les événements réellement enregistrés (flow.md §48).
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Utilisateurs"
            value={String(totalUsers)}
            detail={`${newUsers30} sur 30 jours`}
          />
          <Stat
            label="Actifs (7 j)"
            value={String(active7)}
            detail={pct(active7, totalUsers) != null ? `${pct(active7, totalUsers)} % des utilisateurs` : undefined}
          />
          <Stat
            label="Activation"
            value={activated === 0 ? '—' : `${pct(activated, totalUsers) ?? 0} %`}
            detail="Relvé + recharge enregistrés"
          />
          <Stat
            label="Rétention J7"
            value={retention7 == null ? '—' : `${retention7} %`}
            detail={
              cohortIds.length === 0
                ? 'Cohorte insuffisante'
                : `${retainedCount} sur ${cohortIds.length} signup`
            }
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-semibold">Premiers pas</h2>
            <p className="mt-1 text-sm text-gray-500">Utilisateurs ayant effectué chaque action.</p>
            <ul className="mt-4 flex flex-col divide-y divide-gray-100 text-sm">
              <li className="flex items-center justify-between py-2.5">
                <span>Premier relevé</span>
                <b>{firstReading}</b>
              </li>
              <li className="flex items-center justify-between py-2.5">
                <span>Première recharge</span>
                <b>{firstPurchase}</b>
              </li>
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Événements (30 jours)</h2>
            <p className="mt-1 text-sm text-gray-500">Liste fermée définie dans lib/analytics.ts.</p>
            {counts.size === 0 ? (
              <p className="mt-4 text-sm text-gray-500">Aucun événement sur la période.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-gray-100 text-sm">
                {[...counts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([event, count]) => (
                    <li key={event} className="flex items-center justify-between py-2">
                      <span className="text-gray-700">{event}</span>
                      <b>{count}</b>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
    </AppShell>
  );
}