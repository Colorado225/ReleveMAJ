// Back-office — vue d'ensemble — flow.md §49.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Receipt, Sparkles, TrendingUp, Users, Zap } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BackOfficePage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  // flow.md §40 — RBAC : réservé aux propriétaires et administrateurs
  const member = await db.organizationMember.findFirst({
    where: { userId: session.id, role: { in: ['OWNER', 'ADMIN'] } },
  });
  if (!member) {
    return (
      <AppShell title="Back-office">
        <main className="mx-auto max-w-2xl px-4 py-5">
          <EmptyState title="Accès réservé." body="Seuls les administrateurs peuvent consulter cette section." />
        </main>
      </AppShell>
    );
  }

  const since30 = new Date(Date.now() - 30 * 86_400_000);

  const [userCount, meterCount, purchaseCount, billCount, premiumCount, recentEvents] = await Promise.all([
    db.user.count(),
    db.meter.count(),
    db.electricityPurchase.count({ where: { purchasedAt: { gte: since30 } } }),
    db.waterBill.count(),
    db.user.count({ where: { plan: 'PREMIUM' } }),
    db.productEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);

  const SECTIONS = [
    { href: '/back-office/tarifs', label: 'Tarifs', icon: Receipt, detail: 'Grilles versionnées et sourcées' },
    { href: '/back-office/analytics', label: 'Analytics', icon: TrendingUp, detail: 'Événements produit et rétention' },
    { href: '/back-office/audit', label: 'Journal d’audit', icon: Zap, detail: 'Traçabilité des actions sensibles' },
  ];

  return (
    <AppShell title="Back-office">
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Back-office</h1>
        <p className="mt-1 text-sm text-gray-500">
          Supervision de la plateforme. Les tarifs restent administrables sans modifier l’application.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Utilisateurs" value={String(userCount)} icon={<Users size={20} />} />
          <Stat label="Compteurs" value={String(meterCount)} icon={<Zap size={20} />} />
          <Stat label="Recharges (30 j)" value={String(purchaseCount)} icon={<TrendingUp size={20} />} />
          <Stat label="Factures SODECI" value={String(billCount)} icon={<Receipt size={20} />} />
          <Stat
            label="Formule Premium"
            value={String(premiumCount)}
            detail={
              userCount > 0
                ? `${Math.round((premiumCount / userCount) * 1000) / 10} % des comptes`
                : undefined
            }
            icon={<Sparkles size={20} />}
          />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-start justify-between gap-3 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm transition-colors hover:bg-gray-50"
            >
              <span>
                <span className="flex items-center gap-2 font-semibold">
                  <s.icon size={16} />
                  {s.label}
                </span>
                <span className="mt-1 block text-sm text-gray-500">{s.detail}</span>
              </span>
              <ArrowRight size={16} className="mt-1 shrink-0 text-gray-400" />
            </Link>
          ))}
        </div>

        <Card className="mt-6 p-5">
          <h2 className="font-semibold">Activité récente</h2>
          <p className="mt-1 text-sm text-gray-500">20 derniers événements produit (flow.md §48).</p>
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-medium">{e.event}</span>
                <span className="text-xs text-gray-500">
                  {e.createdAt.toLocaleString('fr-FR')}
                </span>
              </li>
            ))}
            {recentEvents.length === 0 && (
              <li className="py-3 text-gray-500">Aucun événement enregistré pour le moment.</li>
            )}
          </ul>
        </Card>
      </main>
    </AppShell>
  );
}