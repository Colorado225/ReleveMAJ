import type { ReactNode } from 'react';
import { cn as cnImpl } from '@/lib/utils';

/**
 * Utilitaire de composition de classes, sans dépendance supplémentaire.
 *
 * Réexporté depuis `@/lib/utils` (emplacement canonique attendu par shadcn) :
 * une seule implémentation, quel que soit le chemin d'import.
 */
export const cn = cnImpl;

// Briques shadcn/ui — installées dans `components/ui/`. On les réexporte ici
// pour que `from '@/components/ui'` reste le point d'entrée unique du design
// system : un seul endroit à changer si l'implémentation évolue.
// Briques shadcn/ui — installées dans `components/ui/`. On les importe puis on
// les réexporte pour que `from '@/components/ui'` reste le point d'entrée unique
// du design system : un seul endroit à changer si l'implémentation évolue.
//
// `export { X } from '…'` ne crée PAS de liaison locale : sans ces imports, les
// wrappers ci-dessous ne verraient rien.
import { Button as ShadcnButton } from './ui/button';
import { Card as ShadcnCard } from './ui/card';
import { Skeleton as ShadcnSkeleton } from './ui/skeleton';
import { Progress as ShadcnProgress } from './ui/progress';
import { Badge as ShadcnBadge } from './ui/badge';

export { buttonVariants } from './ui/button';
export {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from './ui/card';
export { Badge, badgeVariants } from './ui/badge';
export { Alert, AlertTitle, AlertDescription } from './ui/alert';
export { Skeleton as ShadcnSkeleton } from './ui/skeleton';
export { Progress as ShadcnProgress } from './ui/progress';
export { Input } from './ui/input';
export { Label } from './ui/label';
// Réexporté pour que `entity-actions.tsx` n'importe que depuis '@/components/ui'.
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
// Consommés par `components/form-fields.tsx` (Radix piloté + FormData natif).
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
export { RadioGroup, RadioGroupItem } from './ui/radio-group';
export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

/**
 * Les composants suivants n'existent pas dans shadcn : ils portent une règle
 * métier du projet (flow.md §51, §34) qu'aucune brique générique ne peut
 * exprimer. Ils sont conservés tels quels, et s'appuient désormais sur `Badge`
 * et `Card` de shadcn pour le rendu.
 */
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  /**
   * Accepte un `ReactNode` : les pages qui veulent animer le KPI (flow.md §44)
   * passent un <AnimatedValue>. Ici on n'importe volontairement pas `motion`,
   * de ne pas l'alourdir de 40 ko si elle n'anime rien.
   */
  value: ReactNode;
  detail?: string;
  /** optionnel : les indicateurs du back-office sont lisibles sans icône */
  icon?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
        </div>
        {icon && <div className="rounded-xl bg-gray-100 p-2.5">{icon}</div>}
      </div>
    </Card>
  );
}

/**
 * Adaptateur de `Card` (shadcn).
 *
 * Le `Card` shadcn impose `py-6 gap-6` et rend un `div` ; l'ancien rendait un
 * `<section>` sans padding propre (les pages passaient `p-5`). Sans cet
 * adaptateur, le `py-6` l'emporterait sur le `p-5` des 12 pages et toutes les
 * cartes gagneraient 24 px de hauteur.
 *
 * On garde `<section>` : c'est le repère sémantique utilisé par l'ancien code.
 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <ShadcnCard
      className={cn(
        'gap-0 rounded-2xl border-gray-200/80 bg-white p-0 shadow-sm',
        className,
      )}
    >
      {children}
    </ShadcnCard>
  );
}

/**
 * Barre de progression — shadcn `Progress`.
 *
 * On garde l'appel `value={0..100}` de l'ancien composant : les pages et les
 * tests utilisent cette unité, alors que le Radix sous-jacent attend 0..100
 * également. La borne est appliquée ici pour qu'une valeur hors plage ne
 * produise jamais une barre cassée.
 */
export function Progress({ value }: { value: number }) {
  return <ShadcnProgress value={Math.min(100, Math.max(0, value))} />;
}
/**
 * flow.md §51 — la provenance d'une valeur doit toujours être visible.
 * Réel / Estimé / Calculé / Projection / Inconnu.
 *
 * Implémenté sur le `Badge` de shadcn : même API (`variant`), rendu homogène
 * avec les autres composants du design system.
 */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    REAL: { label: 'Réel', className: 'bg-emerald-50 text-emerald-700 border-transparent' },
    ESTIMATE: { label: 'Estimé', className: 'bg-amber-50 text-amber-700 border-transparent' },
    CALCULATED: { label: 'Calculé', className: 'bg-sky-50 text-sky-700 border-transparent' },
    FORECAST: { label: 'Projection', className: 'bg-violet-50 text-violet-700 border-transparent' },
    USER_ENTERED: { label: 'Saisi', className: 'bg-gray-100 text-gray-700 border-transparent' },
    UNKNOWN: { label: 'Inconnu', className: 'bg-gray-100 text-gray-500 border-transparent' },
  };
  const s = map[status] ?? map.UNKNOWN;
  return (
    <ShadcnBadge className={cn('text-[11px]', s.className)}>{s.label}</ShadcnBadge>
  );
}

/** flow.md §34 — jamais « 0 FCFA » quand l'utilisateur n'a aucune donnée. */
export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-gray-50 p-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-gray-500">{body}</p>
      {cta && <div className="mt-4 flex justify-center">{cta}</div>}
    </div>
  );
}

/** flow.md §6 — skeleton loader pour le chargement serveur (shadcn `Skeleton`). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <ShadcnSkeleton className={cn('rounded-2xl', className)} />;
}

/** flow.md §30 — alerte formulée comme une vérification, jamais comme un verdict. */
export function AlertCard({
  title,
  body,
  severity,
}: {
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}) {
  const tone =
    severity === 'CRITICAL'
      ? 'border-red-200 bg-red-50'
      : severity === 'WARNING'
        ? 'border-amber-200 bg-amber-50'
        : 'border-gray-200 bg-gray-50';
  const dot = severity === 'CRITICAL' ? 'bg-red-500' : severity === 'WARNING' ? 'bg-amber-500' : 'bg-gray-400';
  return (
    <div className={cn('rounded-2xl border p-4', tone)}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot)} />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm leading-6 text-gray-600">{body}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Adaptateur du `Button` shadcn.
 *
 * Le code existant appelle `variant="primary" | "ghost"`. shadcn utilise
 * `default` / `outline` / `ghost`. On traduit ici plutôt que dans les 12
 * fichiers appelants : une seule couche à maintenir si l'API évolue.
 *
 * Le rendu reste identique à l'ancien bouton (fond gris-900, coins arrondis),
 * grâce aux variables CSS calées sur la palette existante.
 */
export function Button({
  children,
  className,
  variant = 'primary',
  ...props
}: Omit<React.ComponentProps<typeof ShadcnButton>, 'variant'> & {
  /** `primary` = action principale, `ghost` = action discrète. */
  variant?: 'primary' | 'ghost' | 'outline' | 'destructive';
}) {
  const shadcnVariant =
    variant === 'primary'
      ? 'default'
      : variant === 'ghost'
        ? 'ghost'
        : variant === 'destructive'
          ? 'destructive'
          : 'outline';

  return (
    <ShadcnButton
      className={cn('h-auto rounded-xl px-4 py-2.5', className)}
      variant={shadcnVariant}
      {...props}
    >
      {children}
    </ShadcnButton>
  );
}