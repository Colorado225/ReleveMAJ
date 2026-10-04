'use client';

// flow.md §42 — « les graphiques lourds doivent être chargés à la demande ».
// Recharts est le poste le plus lourd du bundle : on le sort du chemin critique
// du premier rendu et on affiche un squelette à sa place.
//
// Ce fichier doit être un Client Component : `ssr: false` n'est pas autorisé
// depuis un Server Component.
import dynamic from 'next/dynamic';
import { Skeleton } from './ui';

const ElectricityChart = dynamic(
  () => import('./charts').then((m) => m.ElectricityChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);

const WaterChart = dynamic(() => import('./charts').then((m) => m.WaterChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

export { ElectricityChart, WaterChart };
export type { DashboardPayload } from '@/lib/services';