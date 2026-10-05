// Alertes — flow.md §30, §31 et §33.
//
// Deux listes distinctes, et la distinction est le fond de cette page :
// - les alertes CALCULÉES par le moteur, recalculées à chaque affichage et
//   jamais stockées. Traiter une alerte ne fait pas disparaître la situation
//   qu'elle décrit, seulement le rappel qui la signale ;
// - les alertes TRAITÉES, persistées dans `Alert` avec leur date de résolution.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getDashboard } from '@/lib/services';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState } from '@/components/ui';
import { AlertItem, ComputedAlertItem } from '@/components/alert-forms';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const [dashboard, storedAlerts] = await Promise.all([
    getDashboard(session.id),
    db.alert.findMany({
      where: { userId: session.id },
      orderBy: [{ resolvedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  ]);

  // Une alerte calculée déjà traitée est retirée de la liste active : le moteur
  // la produira toujours, mais l'utilisateur a dit qu'il l'avait vue.
  const acknowledgedTypes = new Set(
    storedAlerts.filter((a) => a.resolvedAt !== null).map((a) => a.type),
  );
  const pendingAlerts = dashboard.alerts.filter((a) => !acknowledgedTypes.has(a.type));
  const resolvedAlerts = storedAlerts.filter((a) => a.resolvedAt !== null);

  return (
    <AppShell title="Alertes">
      <main className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Alertes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Des constats calculés à partir de vos données réelles. Ce sont des invitations à vérifier,
          pas des diagnostics.
        </p>

        <section className="mt-6">
          <h2 className="font-semibold">À vérifier</h2>

          {pendingAlerts.length === 0 ? (
            <div className="mt-3">
              {/* flow.md §34 — jamais de « 0 alerte » présenté comme un problème */}
              <EmptyState
                title="Aucune situation inhabituelle détectée."
                body={
                  acknowledgedTypes.size > 0
                    ? 'Les alertes que vous avez traitées ne sont plus affichées ici.'
                    : 'Sur vos données actuelles, rien ne demande une vérification particulière.'
                }
              />
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {pendingAlerts.map((alert) => (
                <ComputedAlertItem
                  key={alert.type}
                  type={alert.type}
                  severity={alert.severity}
                  title={alert.title}
                  body={alert.body}
                  actionable={alert.actionable}
                />
              ))}
            </ul>
          )}
        </section>

        {resolvedAlerts.length > 0 && (
          <section className="mt-8">
            <h2 className="font-semibold">Alertes traitées</h2>
            <p className="mt-1 text-sm text-gray-500">
              Vous pouvez rouvrir une alerte si le constat revient à l’intérieur.
            </p>
            <Card className="mt-3 p-0">
              <ul className="divide-y divide-gray-100">
                {resolvedAlerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    id={alert.id}
                    title={alert.title}
                    body={alert.body}
                    severity={alert.severity}
                    resolvedAt={alert.resolvedAt?.toISOString() ?? null}
                  />
                ))}
              </ul>
            </Card>
          </section>
        )}
      </main>
    </AppShell>
  );
}