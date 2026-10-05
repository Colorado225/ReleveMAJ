'use client';

import { useActionState } from 'react';
import { createBudgetAction, deleteBudgetAction, updateBudgetAction } from '@/lib/data-actions';
import { DeleteControl, EditControl } from './entity-actions';
import { Button, Input, Label } from './ui';
import { SelectField } from './form-fields';

/**
 * Budgets mensuels — flow.md §24 et §30.
 *
 * Le budget est une ENVELOPPE que l'utilisateur choisit, pas un tarif : aucune
 * source réglementaire ne le fournit. Il sert à répondre à une seule question —
 * « ai-je dépassé ? » — et l'interface ne prétend jamais qu'il est la facture.
 */

/** Libellés des catégories, en français (la base ne stocke que la clé). */
const CATEGORY_LABELS: Record<string, string> = {
  ELECTRICITY: 'Électricité',
  WATER: 'Eau',
  WASTE: 'Ordures ménagères',
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Ligne d'un budget : montant, modification et suppression. */
export function BudgetRow({
  id,
  category,
  monthlyAmount,
  spentAmount,
}: {
  id: string;
  category: string;
  monthlyAmount: number;
  /** Dépensé sur le mois en cours, ou `null` si la donnée n'est pas connue. */
  spentAmount: number | null;
}) {
  const money = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';
  const label = CATEGORY_LABELS[category] ?? category;
  const over = spentAmount != null && spentAmount > monthlyAmount;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-gray-500">Budget mensuel : {money(monthlyAmount)}</p>
          {/* flow.md §11 — la dépense comparée est une MESURE, le budget un objectif.
              Sans donnée de dépense, on ne l'invente pas et on ne l'affiche pas. */}
          <p className="text-xs text-gray-500">
            {spentAmount == null
              ? 'Dépense du mois : à renseigner à partir de vos factures.'
              : over
                ? `Dépensé : ${money(spentAmount)} — dépassement de ${money(spentAmount - monthlyAmount)}.`
                : `Dépensé : ${money(spentAmount)} — il reste ${money(monthlyAmount - spentAmount)}.`}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {over && <p className="text-xs font-medium text-red-600">Budget dépassé</p>}
          <BudgetDeleteControl id={id} label={label} />
        </div>
      </div>

      <BudgetEditForm id={id} monthlyAmount={monthlyAmount} label={label} />
    </li>
  );
}

function BudgetDeleteControl({ id, label }: { id: string; label: string }) {
  return (
    <DeleteControl
      id={id}
      action={deleteBudgetAction}
      entityLabel={`le budget « ${label} »`}
      cascadeWarning="Vos factures et votre historique ne sont pas affectés : seule l’enveloppe disparaît."
    />
  );
}

/** Modification du montant — la catégorie ne change pas (cf. `updateBudgetAction`). */
function BudgetEditForm({
  id,
  monthlyAmount,
  label,
}: {
  id: string;
  monthlyAmount: number;
  label: string;
}) {
  const [message, action, pending] = useActionState(updateBudgetAction, null);

  return (
    <EditControl label={`Modifier le budget ${label}`}>
      <form
        action={action}
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="id" value={id} />

        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`budget-${id}`}>Montant mensuel (FCFA)</Label>
          <Input
            id={`budget-${id}`}
            name="monthlyAmount"
            type="number"
            required
            min="0"
            step="500"
            defaultValue={monthlyAmount}
          />
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>

        {message && <p className="text-xs text-red-600 sm:basis-full">{message}</p>}
      </form>
    </EditControl>
  );
}

/**
 * Formulaire de création d'un budget.
 *
 * Les catégories déjà couvertes sont retirées des options : plutôt qu'afficher
 * une erreur après coup, on ne propose pas ce qui est déjà fait.
 */
export function BudgetForm({
  properties,
  existingCategories,
}: {
  properties: { id: string; name: string }[];
  existingCategories: string[];
}) {
  const [message, action, pending] = useActionState(createBudgetAction, null);

  const available = CATEGORY_OPTIONS.filter((option) => !existingCategories.includes(option.value));

  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Définir un budget mensuel</h2>

      {properties.length > 1 && (
        <SelectField
          name="propertyId"
          label="Logement"
          options={properties.map((p) => ({ value: p.id, label: p.name }))}
        />
      )}
      {properties.length === 1 && (
        <input type="hidden" name="propertyId" value={properties[0].id} />
      )}

      {available.length === 0 ? (
        <p className="text-sm text-gray-500">
          Vous avez déjà un budget pour chaque catégorie de ce logement.
        </p>
      ) : (
        <>
          <SelectField name="category" label="Poste de dépense" options={available} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monthlyAmount">Montant mensuel (FCFA)</Label>
            <Input
              id="monthlyAmount"
              name="monthlyAmount"
              type="number"
              required
              min="0"
              step="500"
              placeholder="35000"
            />
          </div>

          <p className="text-xs leading-5 text-gray-500">
            Ce montant est un objectif que vous fixez, pas un tarif imposé. Il sert à savoir si vous
            dépensez plus que prévu sur le mois.
          </p>

          {message && <p className="text-xs text-red-600">{message}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Définir le budget'}
          </Button>
        </>
      )}
    </form>
  );
}