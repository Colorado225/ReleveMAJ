import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireBackOffice } from '@/lib/backoffice';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState } from '@/components/ui';
import { PublishTariffForm } from '@/components/tariff-admin';

export const dynamic = 'force-dynamic';

const date = (d: Date | null) =>
  d
    ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

export default async function TariffAdminPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  // flow.md §40 — RBAC : réservé aux propriétaires et administrateurs
  if (!(await requireBackOffice(session)).allowed) {
    return (
      <AppShell title="Back-office">
        <main className="mx-auto max-w-2xl px-4 py-5">
          <EmptyState
            title="Accès réservé."
            body="Seuls les administrateurs peuvent modifier les grilles tarifaires."
          />
        </main>
      </AppShell>
    );
  }

  const schemes = await db.tariffScheme.findMany({
    include: { rules: { orderBy: { position: 'asc' } } },
    orderBy: [{ code: 'asc' }, { version: 'desc' }],
  });

  const codes = [...new Set(schemes.map((s) => s.code))];

  return (
    <AppShell title="Back-office · Tarifs">
      <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Grilles tarifaires</h1>
        <p className="mt-1 text-sm text-gray-500">
          Les tarifs sont administrables ici, sans modifier l’application. Chaque changement crée une
          nouvelle version datée.
        </p>

        {codes.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Aucune grille enregistrée."
              body="Lancez le seed pour charger les grilles CIE publiées."
            />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {codes.map((code) => {
              const versions = schemes.filter((s) => s.code === code);
              const current = versions[0];

              return (
                <section key={code}>
                  <h2 className="font-semibold">{code}</h2>
                  <Card className="mt-3 p-5">
                    <ul className="flex flex-col gap-2 text-sm">
                      {versions.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-3">
                          <span>
                            <b>Version {v.version}</b>
                            <span className="ml-2 text-gray-500">
                              du {date(v.effectiveFrom)}
                              {v.effectiveTo ? ` au ${date(v.effectiveTo)}` : ' — en vigueur'}
                            </span>
                          </span>
                          <a
                            href={v.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-gray-600 underline"
                          >
                            source
                          </a>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-gray-500">
                      Vérifiée le {date(current.verifiedAt)} — {current.sourceName}
                    </p>
                  </Card>

                  <div className="mt-3">
                    <PublishTariffForm
                      code={code}
                      rules={current.rules.map((r) => ({
                        kind: r.kind,
                        label: r.label,
                        value: r.value,
                        unit: r.unit,
                      }))}
                    />
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}