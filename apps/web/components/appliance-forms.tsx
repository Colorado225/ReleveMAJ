'use client';

import { useActionState } from 'react';
import { APPLIANCE_LABELS, type ApplianceEstimate, type ApplianceType } from '@conso-ci/tariff-engine';
import { createApplianceAction, deleteApplianceAction, updateApplianceAction } from '@/lib/data-actions';
import { DeleteControl, EditControl } from './entity-actions';
import { Button, Input, Label, Progress } from './ui';
import { SelectField } from './form-fields';

/**
 * Ligne d'appareil : consommation estimée, part et coût optionnel.
 *
 * Note architecture : ce composant est client (suppression via Server Action),
 * donc on ne lui passe JAMAIS de fonction — les montants sont déjà formatés
 * par le composant serveur.
 */
export function ApplianceRow({
  appliance,
  costLabel,
  costKnown,
}: {
  appliance: ApplianceEstimate;
  costLabel: string | null;
  costKnown: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{appliance.label}</p>
          <span className="shrink-0 text-xs text-gray-400">
            {APPLIANCE_LABELS[appliance.type] ?? appliance.type}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          {appliance.powerWatts} W · {appliance.hoursPerDay} h/jour · {appliance.daysPerMonth} j/mois
        </p>
        <div className="mt-2 flex items-center gap-3">
          <div className="max-w-[180px] flex-1">
            <Progress value={Math.min(100, appliance.sharePercent)} />
          </div>
          <span className="text-xs text-gray-500">{appliance.sharePercent} %</span>
        </div>

        <ApplianceEditForm
          id={appliance.id}
          type={appliance.type}
          label={appliance.label}
          powerWatts={appliance.powerWatts}
          hoursPerDay={appliance.hoursPerDay}
          daysPerMonth={appliance.daysPerMonth}
        />
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold">{appliance.monthlyKwh} kWh</p>
        {costKnown && costLabel && <p className="text-xs text-gray-500">≈ {costLabel}</p>}
        <ApplianceDeleteControl id={appliance.id} label={appliance.label} />
      </div>
    </li>
  );
}

/**
 * Suppression d'un appareil.
 *
 * On réutilise `DeleteControl` (boîte de dialogue de confirmation) au lieu du
 * bouton direct qu'utilisait la version précédente : la suppression d'un appareil
 * fait disparaître son poids de la répartition du logement, et une erreur de
 * clic n'a pas de retour. Le coût est un clic de plus.
 */
function ApplianceDeleteControl({ id, label }: { id: string; label: string }) {
  return (
    <DeleteControl
      id={id}
      action={deleteApplianceAction}
      entityLabel={`l’appareil « ${label} »`}
      cascadeWarning="Son poids sera retiré de la répartition estimée du logement."
    />
  );
}

/**
 * Modification d'un appareil — flow.md §32.
 *
 * Une estimation se corrige sans conséquence : le moteur recalcule la
 * répartition à chaque affichage. Le formulaire est donc repris tel quel dans
 * `EditControl`, sous la ligne, pour voir la valeur et sa correction ensemble.
 */
function ApplianceEditForm({
  id,
  type,
  label,
  powerWatts,
  hoursPerDay,
  daysPerMonth,
}: {
  id: string;
  type: string;
  label: string;
  powerWatts: number;
  hoursPerDay: number;
  daysPerMonth: number;
}) {
  const [message, action, pending] = useActionState(updateApplianceAction, null);

  return (
    <EditControl label={`Modifier l’appareil ${label}`}>
      <form action={action} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <input type="hidden" name="id" value={id} />

        <SelectField
          name="type"
          label="Type"
          defaultValue={type}
          options={TYPE_OPTIONS.map(([value, optionLabel]) => ({ value, label: optionLabel }))}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`label-${id}`}>Nom</Label>
          <Input id={`label-${id}`} name="label" required defaultValue={label} />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`power-${id}`}>Puissance (W)</Label>
            <Input
              id={`power-${id}`}
              name="powerWatts"
              type="number"
              required
              min="1"
              step="1"
              defaultValue={powerWatts}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`hours-${id}`}>Heures / jour</Label>
            <Input
              id={`hours-${id}`}
              name="hoursPerDay"
              type="number"
              required
              min="0"
              max="24"
              step="0.5"
              defaultValue={hoursPerDay}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`days-${id}`}>Jours / mois</Label>
            <Input
              id={`days-${id}`}
              name="daysPerMonth"
              type="number"
              required
              min="1"
              max="31"
              step="1"
              defaultValue={daysPerMonth}
            />
          </div>
        </div>

        {message && <p className="text-xs text-red-600">{message}</p>}

        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </form>
    </EditControl>
  );
}

const TYPE_OPTIONS = Object.entries(APPLIANCE_LABELS) as [ApplianceType, string][];

/** Formulaire d'ajout — flow.md §32. */
export function ApplianceForm({ properties }: { properties: { id: string; name: string }[] }) {
  const [message, action, pending] = useActionState(createApplianceAction, null);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter un appareil</h2>

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

      <SelectField
        name="type"
        label="Type"
        options={TYPE_OPTIONS.map(([value, label]) => ({ value, label }))}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label">Nom</Label>
        <Input id="label" name="label" required placeholder="Climatisation salon" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="powerWatts">Puissance (W)</Label>
          <Input id="powerWatts" name="powerWatts" type="number" required min="1" step="1" placeholder="1200" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hoursPerDay">Heures / jour</Label>
          <Input id="hoursPerDay" name="hoursPerDay" type="number" required min="0" max="24" step="0.5" placeholder="6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="daysPerMonth">Jours / mois</Label>
          <Input id="daysPerMonth" name="daysPerMonth" type="number" required min="1" max="31" step="1" placeholder="30" />
        </div>
      </div>

      <p className="text-xs leading-5 text-gray-500">
        La puissance se trouve souvent sur l’étiquette de l’appareil. Une valeur approximative suffit :
        l’estimation sert à comparer, pas à mesurer.
      </p>

      {message && <p className="text-xs text-red-600">{message}</p>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Enregistrement…' : 'Ajouter l’appareil'}
      </Button>
    </form>
  );
}