import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState, StatusBadge } from '@/components/ui';
import { DeleteControl } from '@/components/entity-actions';
import { PurchaseEditForm, WaterBillEditForm } from '@/components/crud-forms';
import { deletePurchaseAction, deleteWaterBillAction } from '@/lib/data-actions';

export const dynamic = 'force-dynamic';

const money = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';
const day = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// flow.md §37 — filtres de période imposés par le plan.
const RANGES = [
  { key: '7d', label: '7 jours', days: 7 },
  { key: '30d', label: '30 jours', days: 30 },
  { key: '3m', label: '3 mois', days: 90 },
  { key: '6m', label: '6 mois', days: 180 },
  { key: '1y', label: '1 an', days: 365 },
] as const;

/** Nombre de mois d'historique autorisé par la formule (flow.md §47). */
function maxHistoryMonths(plan: 'FREE' | 'PREMIUM'): number | null {
  return plan === 'PREMIUM' ? null : 3;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const params = await searchParams;
  const requested = RANGES.find((r) => r.key === params.range)?.key ?? '3m';
  const user = await db.user.findUnique({ where: { id: session.id }, select: { plan: true } });
  const maxMonths = maxHistoryMonths((user?.plan ?? 'FREE') as 'FREE' | 'PREMIUM');

  // flow.md §47 — la formule limite la fenêtre consultée, sans supprimer de donnée
  const range = RANGES.find((r) => r.key === requested)!;
  const limited =
    maxMonths != null && range.days > maxMonths * 30
      ? {
          ...range,
          days: maxMonths * 30,
          label: `${maxMonths} mois (limite formule gratuite)`,
          clamped: true,
        }
      : { ...range, clamped: false };

  const now = new Date();
  const from = new Date(now.getTime() - limited.days * 86_400_000);
  const prevFrom = new Date(now.getTime() - limited.days * 2 * 86_400_000);
  const inRange = { gte: from };
  const inPrev = { gte: prevFrom, lt: from };

  const [purchases, previousPurchases, periods, bills] = await Promise.all([
    db.electricityPurchase.findMany({
      where: { meter: { property: { userId: session.id } }, purchasedAt: inRange },
      orderBy: { purchasedAt: 'desc' },
      take: 200,
    }),
    db.electricityPurchase.findMany({
      where: { meter: { property: { userId: session.id } }, purchasedAt: inPrev },
      // borne aussi la période de comparaison : sans `take`, un compte ancien
      // charge toutes ses recharges de la période précédente pour additionner
      // un total.
      orderBy: { purchasedAt: 'desc' },
      take: 500,
      select: { amountPaid: true },
    }),
    db.consumptionPeriod.findMany({
      where: { meter: { property: { userId: session.id } }, endDate: inRange },
      orderBy: { endDate: 'desc' },
      take: 200,
    }),
    db.waterBill.findMany({
      where: { property: { userId: session.id }, periodEnd: inRange },
      orderBy: { periodEnd: 'desc' },
      take: 50,
    }),
  ]);

  // flow.md §37 — comparaison période actuelle vs période précédente
  const spent = purchases.reduce((s, p) => s + p.amountPaid, 0);
  const spentPrev = previousPurchases.reduce((s, p) => s + p.amountPaid, 0);
  const delta = spentPrev > 0 ? Math.round(((spent - spentPrev) / spentPrev) * 1000) / 10 : null;

  const isEmpty = purchases.length === 0 && periods.length === 0 && bills.length === 0;

  return (
    <AppShell title="Historique">
      <main className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Historique</h1>
        <p className="mt-1 text-sm text-gray-500">Vos recharges, relevés et factures.</p>

        {/* Filtres de période — flow.md §37 */}
        <nav aria-label="Période" className="mt-5 flex flex-wrap gap-2">
          {RANGES.map((r) => {
            const locked = maxMonths != null && r.days > maxMonths * 30;
            const selected = r.key === limited.key;
            return (
              <a
                key={r.key}
                href={`/historique?range=${r.key}`}
                aria-current={selected ? 'page' : undefined}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  selected
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {r.label}
                {locked && <span className="ml-1 text-[10px] opacity-70">Premium</span>}
              </a>
            );
          })}
        </nav>

        {!isEmpty && (
          <Card className="mt-5 p-5">
            <p className="text-sm text-gray-500">Dépenses CIE — {limited.label.toLowerCase()}</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-semibold tracking-tight">{money(spent)}</span>
              {delta != null && (
                <span
                  className={`text-sm font-medium ${delta >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}
                >
                  {delta >= 0 ? '+' : ''}
                  {delta} % vs période précédente
                </span>
              )}
            </div>
            {limited.clamped && (
              <p className="mt-2 text-xs text-gray-500">
                La formule gratuite limite l’historique affiché à {maxMonths} mois. Vos données plus
                anciennes restent enregistrées.
              </p>
            )}
          </Card>
        )}

        {isEmpty ? (
          <div className="mt-6">
            <EmptyState
              title="Aucune donnée pour le moment."
              body="Ajoutez votre premier relevé pour commencer à suivre votre consommation."
              cta={
                <a href="/ajouter" className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white">
                  Ajouter un relevé
                </a>
              }
            />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            {purchases.length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold">Recharges CIE</h2>
                <ul className="mt-4 divide-y divide-gray-100">
                  {purchases.map((p) => (
                    <li key={p.id} className="flex flex-col gap-1 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{money(p.amountPaid)}</p>
                          <p className="text-xs text-gray-500">
                            {day(p.purchasedAt)} · {p.paymentMethod.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm">
                            {p.energyCreditedKwh != null ? '' : '≈ '}
                            {(p.energyCreditedKwh ?? p.estimatedEnergyKwh ?? 0).toFixed(1)} kWh
                          </p>
                          <div className="mt-1 flex items-center justify-end gap-3">
                            <StatusBadge status={p.energyCreditedKwh != null ? 'REAL' : 'ESTIMATE'} />
                            <DeleteControl
                              id={p.id}
                              action={deletePurchaseAction}
                              entityLabel={`cette recharge de ${money(p.amountPaid)}`}
                            />
                          </div>
                        </div>
                      </div>

                      <PurchaseEditForm
                        id={p.id}
                        amountPaid={p.amountPaid}
                        energyCreditedKwh={p.energyCreditedKwh}
                        paymentMethod={p.paymentMethod}
                        purchasedAt={p.purchasedAt}
                        tokenReference={p.tokenReference}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {periods.length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold">Relevés et périodes</h2>
                <ul className="mt-4 divide-y divide-gray-100">
                  {periods.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm font-medium">{p.quantity} m³</p>
                        <p className="text-xs text-gray-500">
                          {day(p.startDate)} → {day(p.endDate)} · {p.startValue} → {p.endValue}
                        </p>
                      </div>
                      {/* flow.md §21 — l'anomalie est signalée, la donnée reste */}
                      {p.anomaly && <StatusBadge status="UNKNOWN" />}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {bills.length > 0 && (
              <Card className="p-5">
                <h2 className="font-semibold">Factures SODECI</h2>
                <ul className="mt-4 divide-y divide-gray-100">
                  {bills.map((b) => (
                    <li key={b.id} className="flex flex-col gap-1 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{money(b.amountTtc)}</p>
                          <p className="text-xs text-gray-500">
                            {day(b.periodStart)} → {day(b.periodEnd)} · {b.consumptionM3} m³
                          </p>
                        </div>
                        <div className="flex items-start gap-3">
                          {b.effectiveCostPerM3 != null && (
                            <p className="text-right text-xs text-gray-500">
                              Coût effectif observé
                              <br />
                              <b className="text-sm text-gray-900">
                                {new Intl.NumberFormat('fr-FR').format(Math.round(b.effectiveCostPerM3))}{' '}
                                FCFA/m³
                              </b>
                            </p>
                          )}
                          <DeleteControl
                            id={b.id}
                            action={deleteWaterBillAction}
                            entityLabel={`cette facture de ${money(b.amountTtc)}`}
                          />
                        </div>
                      </div>

                      <WaterBillEditForm
                        id={b.id}
                        periodStart={b.periodStart}
                        periodEnd={b.periodEnd}
                        consumptionM3={b.consumptionM3}
                        amountTtc={b.amountTtc}
                        invoiceReference={b.invoiceReference}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}