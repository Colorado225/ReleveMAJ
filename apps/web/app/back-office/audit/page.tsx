// Journal d'audit — flow.md §40 et §49.
// Lecture seule : aucune action d'écriture n'est exposée ici.
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { requireBackOffice } from '@/lib/backoffice';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import {
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');
  if (!(await requireBackOffice(session)).allowed) {
    return (
      <AppShell title="Journal d'audit">
        <main className="mx-auto max-w-2xl px-4 py-5">
          <EmptyState title="Accès réservé." body="Seuls les administrateurs peuvent consulter le journal." />
        </main>
      </AppShell>
    );
  }

  const params = await searchParams;
  const action = params.action;

  const [logs, actions] = await Promise.all([
    db.auditLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { phone: true } } },
    }),
    db.auditLog.findMany({ distinct: ['action'], select: { action: true } }),
  ]);

  return (
    <AppShell title="Journal d'audit">
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Journal d’audit</h1>
        <p className="mt-1 text-sm text-gray-500">
          Demandes OTP, échecs de connexion et publications tarifaires.
        </p>

        <nav aria-label="Type d’action" className="mt-5 flex flex-wrap gap-2">
          <a
            href="/back-office/audit"
            aria-current={!action ? 'page' : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              !action ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            Tout
          </a>
          {actions.map((a) => (
            <a
              key={a.action}
              href={`/back-office/audit?action=${encodeURIComponent(a.action)}`}
              aria-current={action === a.action ? 'page' : undefined}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                action === a.action
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {a.action}
            </a>
          ))}
        </nav>

        <Card className="mt-5 p-5">
          {logs.length === 0 ? (
            <EmptyState title="Aucune entrée." body="Le journal est vide pour ce filtre." />
          ) : (
            <div className="overflow-x-auto">
              {/*
                `TableCaption` est le titre accessible du tableau. L'ancien
                `<table>` n'en avait pas : un lecteur d'écran annonçait
                « tableau » sans dire ce qu'il contenait (flow.md §43).
                Il est masqué visuellement (`sr-only`) car le titre de la page
                et l'introduction disent déjà la même chose.
              */}
              <Table>
                <TableCaption className="sr-only">
                  Journal des actions enregistrées, de la plus récente à la plus ancienne
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pr-4">Date</TableHead>
                    <TableHead className="pr-4">Action</TableHead>
                    <TableHead className="pr-4">Entité</TableHead>
                    <TableHead className="pr-4">Utilisateur</TableHead>
                    <TableHead>Détails</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap pr-4 text-gray-500">
                        {log.createdAt.toLocaleString('fr-FR')}
                      </TableCell>
                      <TableCell className="pr-4 font-medium">{log.action}</TableCell>
                      <TableCell className="pr-4 text-gray-600">{log.entity}</TableCell>
                      <TableCell className="pr-4 text-gray-600">{log.user?.phone ?? '—'}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {log.metadata ? JSON.stringify(log.metadata) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </main>
    </AppShell>
  );
}