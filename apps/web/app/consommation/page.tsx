import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getDashboard } from '@/lib/services';
import { AppShell } from '@/components/app-shell';
import { ElectricityChart, WaterChart } from '@/components/charts-lazy';
import { Card, EmptyState, Progress, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

const money = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';

export default async function ConsumptionPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');
  const data = await getDashboard(session.id);

  const hasData = data.electricity.hasData || data.water.hasData;

  return (
    <AppShell title="Votre consommation">
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Consommation</h1>
        <p className="mt-1 text-sm text-gray-500">Électricité et eau, période en cours.</p>

        {!hasData ? (
          <div className="mt-6">
            <EmptyState
              title="Aucune donnée pour le moment."
              body="Ajoutez votre premier relevé ou votre première recharge pour commencer à suivre votre consommation."
              cta={
                <a href="/ajouter" className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white">
                  Ajouter une donnée
                </a>
              }
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Électricité</h2>
                  <StatusBadge status={data.electricity.consumptionStatus} />
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-tight">{money(data.electricity.spent)}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {data.electricity.consumptionStatus === 'ESTIMATE' ? '≈' : ''}{' '}
                  {data.electricity.consumptionKwh} kWh ce mois
                </p>
                {data.electricity.trendPercent != null && (
                  <p className="mt-3 text-sm text-gray-600">
                    {data.electricity.trendPercent >= 0 ? '+' : ''}
                    {data.electricity.trendPercent} % vs mois précédent
                  </p>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="font-semibold">Eau</h2>
                <p className="mt-4 text-3xl font-semibold tracking-tight">{data.water.consumptionM3} m³</p>
                <p className="mt-1 text-sm text-gray-500">Depuis vos derniers relevés</p>
                {data.water.trendPercent != null && (
                  <p className="mt-3 text-sm text-gray-600">
                    {data.water.trendPercent >= 0 ? '+' : ''}
                    {data.water.trendPercent} % vs période précédente
                  </p>
                )}
              </Card>
            </div>

            {data.forecasts.length > 0 && (
              <Card className="mt-4 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Projections</h2>
                  <StatusBadge status="FORECAST" />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Calculées sur votre rythme récent. Ce ne sont pas des factures.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {data.forecasts.map((f) => (
                    <div key={f.horizonDays} className="rounded-xl bg-gray-50 p-4">
                      <p className="text-xs font-medium text-gray-500">{f.label}</p>
                      <p className="mt-1 text-xl font-semibold tracking-tight">
                        ≈ {money(f.projectedAmount)}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {data.budget && (
              <Card className="mt-4 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Budget mensuel</h2>
                  {data.budget.projectedWillExceed && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      Projection au-dessus du budget
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Budget {money(data.budget.monthlyAmount)} · déjà dépensé {money(data.budget.spent)}
                </p>
                <div className="mt-3">
                  <Progress
                    value={(data.budget.spent / data.budget.monthlyAmount) * 100}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {money(data.budget.remaining)} restants sur votre budget ce mois-ci.
                </p>
              </Card>
            )}

            {data.electricitySeries.length > 0 && (
              <Card className="mt-4 p-5">
                <h2 className="font-semibold">Énergie par recharge</h2>
                <p className="text-sm text-gray-500">kWh crédités ou estimés selon la recharge</p>
                <div className="mt-5">
                  <ElectricityChart data={data.electricitySeries} />
                </div>
              </Card>
            )}

            {data.waterSeries.length > 0 && (
              <Card className="mt-4 p-5">
                <h2 className="font-semibold">Eau par période</h2>
                <p className="text-sm text-gray-500">Différence entre deux index</p>
                <div className="mt-5">
                  <WaterChart data={data.waterSeries} />
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}