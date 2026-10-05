import { redirect } from 'next/navigation';
import { Droplets, Lightbulb, Plus, ArrowUpRight, WalletCards } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getDashboard } from '@/lib/services';
import { AppShell } from '@/components/app-shell';
import { ElectricityChart, WaterChart } from '@/components/charts-lazy';
import { AlertCard, Card, EmptyState, Progress, Stat, StatusBadge } from '@/components/ui';
import { Reveal, AnimatedValue } from '@/components/motion';

const money = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';

/** flow.md §44 — KPI animé au changement de valeur. */
const Kpi = ({ value }: { value: string }) => (
  <AnimatedValue value={value} className="block text-2xl font-semibold tracking-tight" />
);

// Le dashboard est rendu côté serveur : les données viennent de la base, pas du client.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSessionUser();
  // flow.md §33 — la landing précède la connexion
  if (!session) redirect('/accueil');

  const data = await getDashboard(session.id);
  const rec = data.recommendations[0];
  const confidenceScore = data.electricity.consumptionConfidence === 'HIGH' ? 90 : 55;

  return (
    <AppShell title="Maison principale · Abidjan">
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        {/* Bloc 1 — Vue globale */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Bonjour {session.firstName ?? ''} 👋</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Votre consommation</h1>
            <p className="mt-1 text-sm text-gray-500">Aujourd’hui, vous savez où vous en êtes.</p>
          </div>
          <a
            href="/ajouter"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm"
          >
            <Plus size={17} />
            Ajouter
          </a>
        </div>

        {/* Bloc 2 et 3 — Électricité et Eau. flow.md §44 : apparition en cascade. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Reveal delay={0}>
            <Stat
              label="Électricité dépensée"
              value={<Kpi value={data.electricity.hasData ? money(data.electricity.spent) : '—'} />}
              detail={
                data.electricity.hasData
                  ? `${data.electricity.consumptionStatus === 'ESTIMATE' ? '≈' : ''} ${data.electricity.consumptionKwh} kWh`
                  : 'Aucune recharge enregistrée'
              }
              icon={<Lightbulb size={20} />}
            />
          </Reveal>
          <Reveal delay={0.04}>
            <Stat
              label="Eau consommée"
              value={<Kpi value={data.water.hasData ? `${data.water.consumptionM3} m³` : '—'} />}
              detail={data.water.hasData ? 'Depuis vos derniers relevés' : 'Aucun relevé enregistré'}
              icon={<Droplets size={20} />}
            />
          </Reveal>
          <Reveal delay={0.08}>
            <Stat
              label="Projection 30 jours"
              value={<Kpi value={data.forecast ? `≈ ${money(data.forecast.projectedAmount)}` : '—'} />}
              detail="Projection, pas une facture"
              icon={<WalletCards size={20} />}
            />
          </Reveal>
        </div>
{/* Graphiques */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.7fr_1fr]">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Électricité</h2>
                <p className="text-sm text-gray-500">Évolution récente</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">30 jours</span>
            </div>
            {data.electricitySeries.length > 0 ? (
              <div className="mt-5">
                <ElectricityChart data={data.electricitySeries} />
              </div>
            ) : (
              <div className="mt-5">
                <EmptyState
                  title="Aucune donnée pour le moment."
                  body="Ajoutez votre première recharge pour commencer à suivre votre consommation."
                  cta={
                    <a href="/ajouter" className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white">
                      Ajouter une recharge
                    </a>
                  }
                />
              </div>
            )}
          </Card>

          {/* Bloc 5 — Recommandation */}
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">À surveiller</h2>
                <p className="mt-1 text-sm text-gray-500">Une action utile, pas du bruit.</p>
              </div>
              <ArrowUpRight size={18} />
            </div>
            {rec && (
              <div className="mt-6 rounded-2xl bg-gray-50 p-4">
                <p className="text-sm font-medium">{rec.title}</p>
                <p className="mt-2 text-sm leading-6 text-gray-600">{rec.body}</p>
              </div>
            )}
            <div className="mt-5">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Qualité des données</span>
                <span>{data.electricity.consumptionConfidence === 'HIGH' ? 'Bonne' : 'À améliorer'}</span>
              </div>
              <Progress value={confidenceScore} />
            </div>
          </Card>
        </div>

        {/* Alertes — flow.md §30 */}
        {data.alerts.length > 0 && (
          <div className="mt-4">
            <div className="grid gap-3 md:grid-cols-2">
              {data.alerts.map((a) => (
                <AlertCard key={a.type} title={a.title} body={a.body} severity={a.severity} />
              ))}
            </div>
            {/* flow.md §33 — le dashboard montre, la page /alertes permet de
                TRAITER : résoudre, rouvrir, supprimer. Un constat affiché sans
                action possible n'est qu'un rappel qu'on ne peut pas éteindre. */}
            <a
              href="/alertes"
              className="mt-3 inline-flex items-center gap-1 text-sm text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              Gérer mes alertes
            </a>
          </div>
        )}
{/* Eau + méthode */}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-semibold">Eau</h2>
            {data.waterSeries.length > 0 ? (
              <div className="mt-4">
                <WaterChart data={data.waterSeries} />
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  title="Aucune donnée pour le moment."
                  body="Ajoutez votre premier relevé pour commencer à suivre votre consommation d’eau."
                />
              </div>
            )}
            {data.water.effectiveCost != null && (
              <p className="mt-4 text-sm text-gray-600">
                Coût effectif observé sur votre dernière facture :{' '}
                <b>{new Intl.NumberFormat('fr-FR').format(Math.round(data.water.effectiveCost))} FCFA/m³</b>
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Votre méthode</h2>
            <div className="mt-4 space-y-4 text-sm">
              {[
                ['Mesurer', 'Ajoutez les index SODECI et les recharges CIE.'],
                ['Comprendre', 'L’application calcule la consommation entre deux points.'],
                ['Anticiper', 'Les projections utilisent votre rythme réel.'],
              ].map(([t, d], i) => (
                <div key={t} className="flex gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 font-semibold">
                    {i + 1}
                  </span>
                  <div>
                    <b>{t}</b>
                    <p className="text-gray-500">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Provenance des données — flow.md §51 */}
        <Card className="mt-4 p-5">
          <h2 className="font-semibold">Fiabilité de vos chiffres</h2>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <StatusBadge status={data.electricity.consumptionStatus} />
            <span>
              {data.electricity.consumptionStatus === 'ESTIMATE'
                ? 'Vos kWh sont estimés depuis les montants payés. Saisissez les kWh crédités pour une mesure réelle.'
                : 'Vos kWh proviennent de recharges avec kWh crédités.'}
            </span>
          </div>
          {data.tariffs.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              Grilles tarifaires : {data.tariffs.map((t) => `${t.code} v${t.version}`).join(' · ')} — source{' '}
              {data.tariffs[0].sourceName}.
            </p>
          )}
        </Card>
      </main>
    </AppShell>
  );
}