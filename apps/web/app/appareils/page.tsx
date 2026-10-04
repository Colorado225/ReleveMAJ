import { redirect } from 'next/navigation';
import { Plug } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState, StatusBadge } from '@/components/ui';
import { ApplianceForm, ApplianceRow } from '@/components/appliance-forms';
import {
  estimateAppliances,
  APPLIANCE_LABELS,
  type Appliance,
  type ApplianceType,
} from '@conso-ci/tariff-engine';

export const dynamic = 'force-dynamic';

const money = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';

// flow.md §32 — la base stocke `type` en texte ; on le restreint à la liste
// fermée du moteur. Un type inconnu ne casse pas la page : il devient 'Other'.
const toApplianceType = (raw: string): ApplianceType =>
  (Object.keys(APPLIANCE_LABELS) as ApplianceType[]).includes(raw as ApplianceType)
    ? (raw as ApplianceType)
    : 'Other';

/**
 * Forme de la ligne `Appliance` telle que la page la consomme.
 *
 * On la déclare explicitement plutôt que de dépendre de l'inférence du `select`
 * Prisma : le mapping vers le moteur ne doit charger que ces six champs, et le
 * type reste vérifiable même si le client généré est en retard sur le schéma.
 */
type ApplianceInput = {
  id: string;
  type: string;
  label: string;
  powerWatts: number;
  hoursPerDay: number;
  daysPerMonth: number;
};

const toEstimateInput = (a: ApplianceInput): Appliance & { id: string } => ({
  id: a.id,
  type: toApplianceType(a.type),
  label: a.label,
  powerWatts: a.powerWatts,
  hoursPerDay: a.hoursPerDay,
  daysPerMonth: a.daysPerMonth,
});

export default async function AppliancesPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const properties = await db.property.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      appliances: {
        // select explicite (et non `appliances: true`) : on ne charge que ce
        // que le moteur consomme, et le type de la relation est complet même si
        // le client Prisma généré est plus ancien que le schéma.
        select: {
          id: true,
          type: true,
          label: true,
          powerWatts: true,
          hoursPerDay: true,
          daysPerMonth: true,
        },
      },
      meters: {
        where: { utilityType: 'ELECTRICITY' },
        // borne sur la relation imbriquée : un compte ancien accumule des
        // centaines de recharges, toutes chargées ici sans raison
        select: {
          electricityPurchases: {
            orderBy: { purchasedAt: 'desc' },
            take: 200,
            select: { amountPaid: true, energyCreditedKwh: true },
          },
        },
      },
    },
  });

  // flow.md §18 — le coût effectif observé est calculé UNIQUEMENT à partir de
  // recharges ayant des kWh crédités. Sinon on ne l'invente pas.
  const observedCostPerKwh = (() => {
    let amount = 0;
    let kwh = 0;
    for (const p of properties) {
      for (const m of p.meters) {
        for (const purchase of m.electricityPurchases) {
          if (purchase.energyCreditedKwh != null && purchase.energyCreditedKwh > 0) {
            amount += purchase.amountPaid;
            kwh += purchase.energyCreditedKwh;
          }
        }
      }
    }
    return kwh > 0 ? amount / kwh : null;
  })();

  const byProperty = properties.map((property) => ({
    id: property.id,
    name: property.name,
    appliances: estimateAppliances(property.appliances.map(toEstimateInput), {
      costPerKwh: observedCostPerKwh,
    }),
  }));

  const total = byProperty.reduce(
    (s, p) => s + p.appliances.reduce((x, a) => x + a.monthlyKwh, 0),
    0,
  );
  const hasAppliances = byProperty.some((p) => p.appliances.length > 0);

  return (
    <AppShell title="Appareils">
      <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Vos appareils</h1>
        <p className="mt-1 text-sm text-gray-500">
          Estimez la consommation de chaque appareil pour savoir où agir en premier.
        </p>

        {!hasAppliances ? (
          <div className="mt-6">
            <EmptyState
              title="Aucun appareil enregistré."
              body="Ajoutez la climatisation, le chauffe-eau ou la machine à laver pour voir où part votre électricité."
            />
          </div>
        ) : (
          <>
            <Card className="mt-6 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Consommation estimée des appareils</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">
                    {Math.round(total * 10) / 10} kWh <span className="text-base font-normal">/ mois</span>
                  </p>
                </div>
                <StatusBadge status="ESTIMATE" />
              </div>
              <p className="mt-3 text-xs leading-5 text-gray-500">
                Calculée à partir de la puissance et de la durée d’usage que vous déclarez. Cette
                estimation sert à comparer vos appareils entre eux : elle ne remplace pas vos kWh réels,
                comptés sur vos recharges CIE.
              </p>
            </Card>

            {byProperty.map((property) =>
              property.appliances.length === 0 ? null : (
                <section key={property.id} className="mt-6">
                  <h2 className="font-semibold">{property.name}</h2>
                  <Card className="mt-3 overflow-hidden">
                    <ul className="divide-y divide-gray-100">
                      {property.appliances.map((a) => (
                        <ApplianceRow
                          key={a.id}
                          appliance={a}
                          costLabel={a.monthlyCostTtc != null ? money(a.monthlyCostTtc) : null}
                          costKnown={observedCostPerKwh != null}
                        />
                      ))}
                    </ul>
                  </Card>
                </section>
              ),
            )}

            {observedCostPerKwh == null && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-500">
                <Plug size={14} className="mt-0.5 shrink-0" />
                Ajoutez au moins une recharge avec les kWh crédités du reçu pour obtenir aussi le coût
                en FCFA de chaque appareil.
              </p>
            )}
          </>
        )}

        {properties.length > 0 && (
          <div className="mt-6">
            <ApplianceForm
              properties={properties.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
        )}
      </main>
    </AppShell>
  );
}