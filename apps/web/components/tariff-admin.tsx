'use client';

import { useActionState } from 'react';
import { publishTariffVersionAction } from '@/lib/tariff-actions';
import { Button, Input, Label } from '@/components/ui';

type Rule = { kind: string; label: string; value: number; unit: string | null };

/**
 * Publication d'une nouvelle version de grille (flow.md §14 et §49).
 * Une version publiée n'est jamais modifiée : on en crée une nouvelle.
 */
export function PublishTariffForm({ code, rules }: { code: string; rules: Rule[] }) {
  const [message, action, pending] = useActionState(publishTariffVersionAction, null);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <input type="hidden" name="code" value={code} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="effectiveFrom">Date d’effet</Label>
        <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
      </div>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-xs font-medium text-gray-500">
          Valeurs de la nouvelle version (FCFA)
        </legend>
        {rules.map((r) => (
          <div key={r.kind} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-600">{r.label}</span>
            <span className="flex items-center gap-2">
              <input
                type="hidden"
                name="rule"
                value={`${r.kind}:${r.value}`}
                readOnly
                className="hidden"
              />
              <Input
                name={`rule-${r.kind}`}
                type="number"
                step="0.01"
                defaultValue={r.value}
                className="w-28 text-right"
                aria-label={r.label}
              />
            </span>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sourceUrl">Source (URL)</Label>
        <Input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          required
          placeholder="https://www.cie.ci/..."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sourceName">Nom de la source</Label>
        <Input id="sourceName" name="sourceName" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="documentReference">Référence du document</Label>
        <Input id="documentReference" name="documentReference" />
      </div>

      {message && <p className="text-xs leading-5 text-amber-700">{message}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? 'Publication…' : 'Publier une nouvelle version'}
      </Button>
      <p className="text-xs leading-5 text-gray-500">
        La version actuelle reste publiée et consultable. Un changement de tarif crée une nouvelle
        version datée, il ne modifie jamais l’historique.
      </p>
    </form>
  );
}