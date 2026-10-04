import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/ui';
import { PurchaseForm, ReadingForm, WaterBillForm } from '@/components/entry-forms';

export const dynamic = 'force-dynamic';

export default async function AddPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const meters = await db.meter.findMany({
    where: { property: { userId: session.id }, active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, utilityType: true, provider: true },
  });

  const options = meters.map((m) => ({
    id: m.id,
    label: m.label ?? `${m.provider} · ${m.utilityType === 'ELECTRICITY' ? 'Électricité' : 'Eau'}`,
    utilityType: m.utilityType,
    provider: m.provider,
  }));

  const electricity = options.filter((m) => m.utilityType === 'ELECTRICITY');
  const water = options.filter((m) => m.utilityType === 'WATER');

  return (
    <AppShell title="Ajouter une donnée">
      <main className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ajouter</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mesurez, comprenez, anticipez. Chaque donnée précise vos projections.
        </p>

        {options.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Aucun compteur enregistré."
              body="Ajoutez d’abord un compteur CIE ou SODECI depuis votre profil."
              cta={
                <a href="/profil" className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white">
                  Aller au profil
                </a>
              }
            />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            {electricity.length > 0 && <PurchaseForm meters={electricity} />}
            {options.length > 0 && <ReadingForm meters={options} />}
            {water.length > 0 && <WaterBillForm meters={water} />}
          </div>
        )}
      </main>
    </AppShell>
  );
}