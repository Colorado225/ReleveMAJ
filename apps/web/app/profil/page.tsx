import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadTariffs } from '@/lib/services';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState, StatusBadge } from '@/components/ui';
import { LogoutButton, MeterForm, PropertyForm } from '@/components/profile-forms';
import {
  MeterDeleteControl,
  MeterEditForm,
  PropertyDeleteControl,
  PropertyEditForm,
} from '@/components/crud-forms';
import { validateEligibility } from '@conso-ci/tariff-engine';
import { ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const properties = await db.property.findMany({
    where: { userId: session.id },
    include: { meters: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  // eligibilityRules et les compteurs CIE servent à afficher un constat indicatif,
// jamais une affirmation de changement de tarif (flow.md §17).
const [eligibilityRules, userPlan] = await Promise.all([
  db.eligibilityRule.findMany(),
  db.user.findUnique({ where: { id: session.id }, select: { plan: true } }),
]);

const tariff = await loadTariffs();
const tariffs = tariff;
const socialRule = eligibilityRules.find((r) => r.schemeCode.includes('SOCIAL'));

// Consommation moyenne observée sur l'historique réel des compteurs CIE
const electricMeters = properties.flatMap((p) => p.meters).filter((m) => m.utilityType === 'ELECTRICITY');
const purchaseRows = electricMeters.length
  ? await db.electricityPurchase.findMany({
      where: { meterId: { in: electricMeters.map((m) => m.id) } },
      orderBy: { purchasedAt: 'asc' },
      select: { purchasedAt: true, energyCreditedKwh: true, estimatedEnergyKwh: true },
    })
  : [];

let eligibility: { status: string; message: string; thresholdKwh?: number; averageMonthlyConsumption?: number } | null = null;

if (socialRule && purchaseRows.length > 0) {
  const first = purchaseRows[0].purchasedAt;
  const last = purchaseRows[purchaseRows.length - 1].purchasedAt;
  const observationDays = Math.max(1, Math.round((+last - +first) / 86_400_000));
  const totalKwh = purchaseRows.reduce(
    (s, p) => s + (p.energyCreditedKwh ?? p.estimatedEnergyKwh ?? 0),
    0,
  );
  const averageMonthlyConsumption = Math.round((totalKwh / observationDays) * 30 * 100) / 100;

  const result = validateEligibility(
    (tariff.find((t) => t.code === socialRule.schemeCode) ?? tariff[0])!,
    {
      subscribedPower: electricMeters[0]?.subscribedPower ?? 5,
      usageType: 'DOMESTIC',
      averageMonthlyConsumption,
      observationDays,
      thresholdKwh: socialRule.thresholdKwh,
      minimumObservationPeriodDays: socialRule.minimumObservationPeriodDays,
    },
  );
  eligibility = result;
}

  return (
    <AppShell title="Profil">
      <main className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Profil</h1>
        <p className="mt-1 text-sm text-gray-500">{session.phone}</p>

        {/* Logements et compteurs */}
        <div className="mt-6 flex flex-col gap-4">
          {properties.length === 0 ? (
            <EmptyState
              title="Aucun logement."
              body="Commencez par créer votre logement pour y rattacher vos compteurs."
            />
          ) : (
            properties.map((p) => (
              <Card key={p.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{p.name}</h2>
                    {p.address && <p className="text-sm text-gray-500">{p.address}</p>}
                  </div>
                  {/* flow.md §21 — la suppression se demande en deux temps */}
                  <PropertyDeleteControl id={p.id} name={p.name} />
                </div>

                <ul className="mt-4 flex flex-col gap-2">
                  {p.meters.length === 0 ? (
                    <li className="text-sm text-gray-500">Aucun compteur sur ce logement.</li>
                  ) : (
                    p.meters.map((m) => (
                      <li key={m.id} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span>
                            {m.label ?? `${m.provider}`}
                            <span className="ml-2 text-xs text-gray-500">
                              {m.utilityType === 'ELECTRICITY' ? 'Électricité' : 'Eau'} ·{' '}
                              {m.paymentMode === 'PREPAID'
                                ? 'Prépayé'
                                : m.paymentMode === 'POSTPAID'
                                  ? 'Postpayé'
                                  : 'Mode inconnu'}
                              {m.subscribedPower != null && ` · ${m.subscribedPower} A`}
                            </span>
                          </span>
                          <MeterDeleteControl id={m.id} label={m.label ?? m.provider} />
                        </div>

                        {/* edition du compteur */}
                        <MeterEditForm
                          id={m.id}
                          provider={m.provider}
                          utilityType={m.utilityType}
                          paymentMode={m.paymentMode}
                          meterNumber={m.meterNumber}
                          subscribedPower={m.subscribedPower}
                          label={m.label}
                        />
                      </li>
                    ))
                  )}
                </ul>

                {/* edition du logement */}
                <PropertyEditForm
                  id={p.id}
                  name={p.name}
                  address={p.address}
                  isAbidjan={p.isAbidjan}
                />
              </Card>
            ))
          )}
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <PropertyForm />
          {properties.length > 0 && (
            <MeterForm properties={properties.map((p) => ({ id: p.id, name: p.name }))} />
          )}
        </div>

        {/* Sources tarifaires — flow.md §50 */}
        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Grilles tarifaires appliquées</h2>
          <p className="mt-1 text-sm text-gray-500">
            Chaque grille est versionnée et vérifiable. Elles sont administrables sans modifier l’application.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {tariffs.map((t) => (
              <li key={`${t.code}-v${t.version}`} className="text-sm">
                <b>
                  {t.code} v{t.version}
                </b>
                <p className="text-xs text-gray-500">
                  Applicable depuis le{' '}
                  {new Date(t.effectiveFrom).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
                <a
                  href={t.source.sourceUrl}
                  className="text-xs text-gray-600 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.source.sourceName} — {t.source.documentReference}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-gray-400">
            ANARE : il n’existe pas de grille prépayée distincte. La grille des compteurs ordinaires
            s’applique au prépaiement.
          </p>
        </Card>

        {/* Appareils — flow.md §32 */}
        <a
          href="/appareils"
          className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm transition-colors hover:bg-gray-50"
        >
          <div>
            <h2 className="font-semibold">Vos appareils</h2>
            <p className="mt-1 text-sm text-gray-500">
              Estimez la consommation de la climatisation, du chauffe-eau ou de la machine à laver.
            </p>
          </div>
          <ArrowRight size={16} className="shrink-0 text-gray-400" />
        </a>

        {/* Éligibilité — flow.md §17 */}
        {eligibility && (
          <Card className="mt-5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Votre régime CIE</h2>
              <StatusBadge status={eligibility.status === 'ELIGIBLE' ? 'REAL' : 'CALCULATED'} />
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">{eligibility.message}</p>
            {eligibility.thresholdKwh != null && (
              <p className="mt-2 text-xs text-gray-500">
                Seuil de la grille : {eligibility.thresholdKwh} kWh
                {eligibility.averageMonthlyConsumption != null &&
                  ` · votre moyenne observée : ${eligibility.averageMonthlyConsumption} kWh/mois`}
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-gray-400">
              Ce constat repose uniquement sur vos données saisies. Il ne constitue ni une confirmation
              ni un changement de tarif : seule la CIE peut le confirmer.
            </p>
          </Card>
        )}

        {/* Formule — flow.md §47 */}
        <Card className="mt-5 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-semibold">
              Formule {userPlan?.plan === 'PREMIUM' ? 'Premium' : 'Gratuite'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {userPlan?.plan === 'PREMIUM'
                ? 'Historique illimité et projections 90 jours.'
                : '1 logement, 2 compteurs, 3 mois d’historique.'}
            </p>
          </div>
          <a
            href="/premium"
            className="shrink-0 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Voir les formules
          </a>
        </Card>

        <div className="mt-5">
          <LogoutButton />
        </div>
      </main>
    </AppShell>
  );
}