'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, House, History, UserRound, Plus, Sparkles, Plug, Camera, Bell } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './ui';

// Navigation mobile : 4 onglets max autour du bouton d'action (flow.md §5).
// « Appareils » et « Alertes » sont volontairement absents de la barre basse : ils
// restent accessibles depuis la sidebar desktop et le profil, pour ne pas
// surcharger l'écran. Un 5e onglet ferait passer les libellés sous 44 px de large.
const MOBILE_ITEMS = [
  { href: '/', label: 'Accueil', icon: House },
  { href: '/consommation', label: 'Conso', icon: BarChart3 },
  { href: '/historique', label: 'Historique', icon: History },
  { href: '/profil', label: 'Profil', icon: UserRound },
];

// flow.md §46 — sur desktop, la navigation devient une sidebar. Le mobile reste
// prioritaire : la barre basse et le bouton d'action flottant sont conservés.
const DESKTOP_ITEMS = [
  { href: '/', label: 'Accueil', icon: House },
  { href: '/consommation', label: 'Consommation', icon: BarChart3 },
  { href: '/historique', label: 'Historique', icon: History },
  { href: '/recus', label: 'Reçus', icon: Camera },
  { href: '/appareils', label: 'Appareils', icon: Plug },
  { href: '/alertes', label: 'Alertes', icon: Bell },
  { href: '/profil', label: 'Profil', icon: UserRound },
  { href: '/premium', label: 'Formule', icon: Sparkles },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function Nav({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof House;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] transition-colors',
        active ? 'font-semibold text-gray-900' : 'text-gray-500',
      )}
    >
      <Icon size={18} />
      {label}
    </Link>
  );
}

/**
 * Coquille applicative : header + navigation basse sur mobile, sidebar sur desktop.
 * flow.md §5 et §45 (mobile-first) + §46 (sidebar desktop).
 */
export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen pb-20 lg:flex lg:pb-0">
      {/* Sidebar desktop — flow.md §46 */}
      <aside className="hidden w-60 shrink-0 border-r border-gray-200/80 bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gray-900 text-white">C</div>
          <span className="font-semibold">ConsoCI</span>
        </div>

        <nav aria-label="Navigation principale" className="flex flex-1 flex-col gap-1 px-3">
          {DESKTOP_ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={isActive(pathname, it.href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                isActive(pathname, it.href)
                  ? 'bg-gray-100 font-semibold text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <it.icon size={18} />
              {it.label}
            </Link>
          ))}
        </nav>

        <div className="p-3">
          <Link
            href="/ajouter"
            className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            <Plus size={16} />
            Ajouter une donnée
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="glass sticky top-0 z-20 border-b border-gray-200/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-gray-900 text-white lg:hidden">
                C
              </div>
              <span className="font-semibold lg:hidden">ConsoCI</span>
              <div className="hidden text-sm text-gray-500 lg:block">{title}</div>
            </div>
            <div className="h-8 w-8 rounded-full bg-gray-100" aria-hidden />
          </div>
        </header>

        {children}
      </div>

      {/* Barre basse mobile — flow.md §5 et §45 */}
      <nav
        aria-label="Navigation principale"
        className="fixed bottom-0 left-0 right-0 z-30 border-t bg-white/95 backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-xl items-center justify-around px-2 py-2">
          {MOBILE_ITEMS.slice(0, 2).map((it) => (
            <Nav key={it.href} {...it} active={isActive(pathname, it.href)} />
          ))}
          <Link
            href="/ajouter"
            aria-label="Ajouter une donnée"
            className="-mt-8 grid h-14 w-14 place-items-center rounded-full bg-gray-900 text-white shadow-xl transition-colors hover:bg-gray-800"
          >
            <Plus />
          </Link>
          {MOBILE_ITEMS.slice(2).map((it) => (
            <Nav key={it.href} {...it} active={isActive(pathname, it.href)} />
          ))}
        </div>
      </nav>
    </div>
  );
}