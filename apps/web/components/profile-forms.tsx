'use client';

import { useActionState } from 'react';
import { createMeterAction, createPropertyAction } from '@/lib/data-actions';
import { logout } from '@/lib/actions';
import { Button, Input, Label } from './ui';
import { SelectField } from './form-fields';

export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="ghost" className="w-full">
        Se déconnecter
      </Button>
    </form>
  );
}

export function PropertyForm() {
  const [message, action, pending] = useActionState(createPropertyAction, null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter un logement</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nom</Label>
        <Input id="name" name="name" required placeholder="Maison principale" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Adresse</Label>
        <Input id="address" name="address" placeholder="Abidjan" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          id="isAbidjan"
          name="isAbidjan"
          defaultChecked
          className="size-4 accent-gray-900"
        />
        <Label htmlFor="isAbidjan" className="cursor-pointer font-normal">
          Situé à Abidjan (tarification ordure applicable)
        </Label>
      </label>
      {message && <p className="text-xs text-red-600">{message}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Enregistrement…' : 'Ajouter le logement'}
      </Button>
    </form>
  );
}

export function MeterForm({
  properties,
}: {
  properties: { id: string; name: string }[];
}) {
  const [message, action, pending] = useActionState(createMeterAction, null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter un compteur</h2>
      <SelectField
        name="propertyId"
        label="Logement"
        options={properties.map((p) => ({ value: p.id, label: p.name }))}
      />
      <SelectField
        name="provider"
        label="Fournisseur"
        options={[
          { value: 'CIE', label: 'CIE — électricité' },
          { value: 'SODECI', label: 'SODECI — eau' },
        ]}
      />
      <SelectField
        name="utilityType"
        label="Type de compteur"
        options={[
          { value: 'ELECTRICITY', label: 'Électricité' },
          { value: 'WATER', label: 'Eau' },
        ]}
      />
      {/* flow.md §9 — prépayé, postpayé ou inconnu */}
      <SelectField
        name="paymentMode"
        label="Mode de paiement"
        defaultValue="PREPAID"
        options={[
          { value: 'PREPAID', label: 'Prépayé' },
          { value: 'POSTPAID', label: 'Postpayé' },
          { value: 'UNKNOWN', label: 'Je ne sais pas' },
        ]}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subscribedPower">Puissance souscrite (A)</Label>
        <Input
          id="subscribedPower"
          name="subscribedPower"
          type="number"
          step="1"
          min="1"
          placeholder="5"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="meterNumber">Numéro de compteur</Label>
        <Input id="meterNumber" name="meterNumber" />
      </div>
      {message && <p className="text-xs text-red-600">{message}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Enregistrement…' : 'Ajouter le compteur'}
      </Button>
    </form>
  );
}