'use client';

import { useState } from 'react';
import {
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';

/**
 * Champs de formulaire compatibles `FormData`.
 *
 * Les composants `Select` et `RadioGroup` de shadcn sont des widgets Radix :
 * ils tiennent leur état dans React et ne produisent **rien** dans un
 * `<form>` HTML. Or tout le projet soumet des `FormData` natifs à ses Server
 * Actions (`formData.get('provider')`, `formData.get('readingType')`…).
 *
 * Chaque champ ci-dessous est donc piloté par l'état React ET répliqué dans un
 * `<input type="hidden">` : on garde l'expérience Radix (navigation clavier,
 * recherche, `aria-*`) tout en restituant au serveur exactement la même valeur
 * qu'un `<select>` natif. Aucune régression possible côté Server Actions.
 */

/** Liste déroulante — Radix, mais sérialisée dans le formulaire. */
export function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0]?.value ?? '');

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>

      {/* La valeur Radix vit ici ; ce champ caché est ce que le serveur lit. */}
      <input type="hidden" name={name} value={value} />

      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id={name} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Groupe de boutons radio — Radix, sérialisé de la même façon.
 *
 * `flow.md §10 : la nature d'une valeur doit toujours être qualifiée`, et
 * `flow.md §23 : jamais d'interprétation automatique`. D'où `defaultValue`
 * obligatoire ici : il est impossible d'oublier le type de valeur, il est
 * toujours explicitement choisi.
 */
export function RadioField({
  name,
  legend,
  options,
  defaultValue,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <fieldset className="rounded-xl border border-gray-200 p-3">
      <legend className="px-1 text-xs font-medium text-gray-500">{legend}</legend>

      <input type="hidden" name={name} value={value} />

      <RadioGroup value={value} onValueChange={setValue} className="gap-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <div key={o.value} className="flex items-center gap-2">
              <RadioGroupItem value={o.value} id={id} />
              <Label htmlFor={id} className="cursor-pointer font-normal">
                {o.label}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}