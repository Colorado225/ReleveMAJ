'use client';

// Implémentation réelle des graphiques (Recharts via le ChartContainer shadcn).
// Elle est chargée À LA DEMANDE via components/charts-lazy.tsx — les pages ne
// doivent jamais importer ce fichier directement (flow.md §42).
import type { DashboardPayload } from '@/lib/services';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

// flow.md §42 : graphiques chargés à la demande, pas bloquants pour le premier rendu.
//
// Le dégradé est déclaré via `fill="url(#…)"` : Recharts n'accepte pas un
// `stopColor="currentColor"`, on garde donc une couleur explicite issue de la
// variable CSS `--chart-1`.
const ENERGY_CONFIG = {
  kwh: { label: 'Énergie', color: 'var(--chart-1)' },
} as const;

export function ElectricityChart({ data }: { data: DashboardPayload['electricitySeries'] }) {
  return (
    <ChartContainer config={ENERGY_CONFIG} className="h-64 w-full">
      <AreaChart data={data} accessibilityLayer>
        <defs>
          <linearGradient id="fillEnergy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
        />
        <YAxis hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''}
              formatter={(value) => [`${value} kWh`, 'Énergie']}
            />
          }
        />
        <Area
          dataKey="kwh"
          type="monotone"
          stroke="var(--color-chart-1)"
          fill="url(#fillEnergy)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

const WATER_CONFIG = {
  m3: { label: 'Eau', color: 'var(--chart-2)' },
} as const;

export function WaterChart({ data }: { data: DashboardPayload['waterSeries'] }) {
  return (
    <ChartContainer config={WATER_CONFIG} className="h-64 w-full">
      <AreaChart data={data} accessibilityLayer>
        <defs>
          <linearGradient id="fillWater" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
        />
        <YAxis hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''}
              formatter={(value) => [`${value} m³`, 'Eau']}
            />
          }
        />
        <Area
          dataKey="m3"
          type="monotone"
          stroke="var(--color-chart-2)"
          fill="url(#fillWater)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}