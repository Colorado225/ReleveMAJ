'use client';

import { useActionState } from 'react';
import { acknowledgeAlertAction, deleteAlertAction, updateAlertAction } from '@/lib/data-actions';
import { DeleteControl } from './entity-actions';

/**
 * Alertes — flow.md §33.
 *
 * Deux natures se superposent, et la page les sépare :
 *
 * 1. les alertes CALCULÉES, produites par le moteur à partir des données réelles
 *    et recalculées à chaque affichage. Elles ne sont pas en base : ce que
 *    l'utilisateur traite est enregistré, la constatation reste recalculée ;
 * 2. les alertes TRAITÉES, persistées avec leur date de résolution. Résoudre
 *    est réversible, supprimer ne l'est pas — d'où le placement de la
 *    suppression, proposée uniquement sur ce qui est déjà traité.
 */

const SEVERITY_LABELS: Record<string, string> = {
  INFO: 'Information',
  WARNING: 'À surveiller',
  CRITICAL: 'Important',
};

const day = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Alerte calculée, pas encore traitée.
 *
 * Le formulaire renvoie `type`, `severity`, `title` et `body`, mais l'action
 * REFUSE de leur faire confiance : elle relit le tableau calculé et n'utilise que
 * ce qu'il contient. Un client ne peut donc pas fabriquer une alerte.
 */
export function ComputedAlertItem({
  type,
  severity,
  title,
  body,
  actionable,
}: {
  type: string;
  severity: string;
  title: string;
  body: string;
  actionable: boolean;
}) {
  const [message, action, pending] = useActionState(acknowledgeAlertAction, null);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            <span className="shrink-0 text-xs text-gray-500">
              {SEVERITY_LABELS[severity] ?? severity}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-600">{body}</p>
          {/* flow.md §30 — une alerte est une invitation à vérifier, jamais un verdict */}
          {!actionable && (
            <p className="mt-1 text-xs text-gray-500">
              Ce constat est indicatif : vérifiez-le avant d’en tirer une conclusion.
            </p>
          )}
        </div>
      </div>

      <form action={action} className="flex flex-col gap-1">
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="severity" value={severity} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="body" value={body} />
        <button
          type="submit"
          disabled={pending}
          className="w-fit text-xs text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50"
        >
          {pending ? 'Enregistrement…' : 'Marquer comme traitée'}
        </button>
      </form>

      {message && <p className="text-xs text-red-600">{message}</p>}
    </li>
  );
}

/** Alerte traitée : consultable, rouvrable, supprimable. */
export function AlertItem({
  id,
  title,
  body,
  severity,
  resolvedAt,
}: {
  id: string;
  title: string;
  body: string;
  severity: string;
  resolvedAt: string | null;
}) {
  const [message, action, pending] = useActionState(updateAlertAction, null);
  const resolved = resolvedAt !== null;

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border p-4 ${
        resolved ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            <span className="shrink-0 text-xs text-gray-500">
              {SEVERITY_LABELS[severity] ?? severity}
            </span>
            {resolved && (
              <span className="shrink-0 text-xs text-gray-500">Traitée le {day(resolvedAt)}</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-600">{body}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={pending}
            className="text-xs text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50"
          >
            {resolved ? 'Rouvrir cette alerte' : 'Marquer comme traitée'}
          </button>
        </form>

        {resolved && (
          <DeleteControl
            id={id}
            action={deleteAlertAction}
            entityLabel="cette alerte"
            cascadeWarning="Cette opération est définitive : l’alerte ne sera plus affichée."
          />
        )}
      </div>

      {message && <p className="text-xs text-red-600">{message}</p>}
    </li>
  );
}