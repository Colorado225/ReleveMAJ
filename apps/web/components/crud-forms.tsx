'use client';

import { useActionState } from 'react';
import {
  deleteMeterAction,
  deletePropertyAction,
  updateMeterAction,
  updatePropertyAction,
  updatePurchaseAction,
  updateWaterBillAction,
} from '@/lib/data-actions';
import { DeleteControl, EditControl } from './entity-actions';
import { SaveButton } from './save-feedback';
import { Input, Label } from '@/components/ui';
import { SelectField } from './form-fields';

/** Suppression d'un logement — flow.md §21 (cascades sur tout l'historique). */
export function PropertyDeleteControl({ id, name }: { id: string; name: string }) {
  return (
    <DeleteControl
      id={id}
      action={deletePropertyAction}
      entityLabel={`le logement « ${name} »`}
      cascadeWarning="Ses compteurs, relevés, recharges et factures seront supprimés aussi."
    />
  );
}

/** Suppression d'un compteur et de ses mesures. */
export function MeterDeleteControl({ id, label }: { id: string; label: string }) {
  return (
    <DeleteControl
      id={id}
      action={deleteMeterAction}
      entityLabel={`le compteur « ${label} »`}
      cascadeWarning="Ses relevés et recharges seront supprimés aussi."
    />
  );
}

/** Formulaire d'édition d'un logement — flow.md §60. */
export function PropertyEditForm({
  id,
  name,
  address,
  isAbidjan,
}: {
  id: string;
  name: string;
  address: string | null;
  isAbidjan: boolean;
}) {
  const [message, action, pending] = useActionState(updatePropertyAction, null);

  return (
    <EditControl label={`Modifier le logement ${name}`}>
      <form action={action} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <input type="hidden" name="id" value={id} />

        <label className="flex flex-col gap-1 text-sm">
          <Label htmlFor="field-name">Nom</Label>
          <Input id="field-name" name="name" required defaultValue={name} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <Label htmlFor="field-address">Adresse</Label>
          <Input id="field-address" name="address" defaultValue={address ?? ''} />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isAbidjan" defaultChecked={isAbidjan} />
          Situé à Abidjan (tarification ordure applicable)
        </label>

        <SaveButton label="Enregistrer les modifications" pending={pending} message={message} />
      </form>
    </EditControl>
  );
}

/** Formulaire d'édition d'un compteur — flow.md §47. */
export function MeterEditForm({
  id,
  provider,
  utilityType,
  paymentMode,
  meterNumber,
  subscribedPower,
  label,
}: {
  id: string;
  provider: string;
  utilityType: string;
  paymentMode: string;
  meterNumber: string | null;
  subscribedPower: number | null;
  label: string | null;
}) {
  const [message, action, pending] = useActionState(updateMeterAction, null);

  return (
    <EditControl label="Modifier ce compteur">
      <form action={action} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <input type="hidden" name="id" value={id} />

        <SelectField
          name="provider"
          label="Fournisseur"
          defaultValue={provider}
          options={[
            { value: 'CIE', label: 'CIE — électricité' },
            { value: 'SODECI', label: 'SODECI — eau' },
          ]}
        />

        <SelectField
          name="utilityType"
          label="Type de compteur"
          defaultValue={utilityType}
          options={[
            { value: 'ELECTRICITY', label: 'Électricité' },
            { value: 'WATER', label: 'Eau' },
          ]}
        />

        <SelectField
          name="paymentMode"
          label="Mode de paiement"
          defaultValue={paymentMode}
          options={[
            { value: 'PREPAID', label: 'Prépayé' },
            { value: 'POSTPAID', label: 'Postpayé' },
            { value: 'UNKNOWN', label: 'Je ne sais pas' },
          ]}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-subscribedPower">Puissance souscrite (A)</Label>
            <Input id="field-subscribedPower" name="subscribedPower"
              type="number"
              step="1"
              min="1"
              defaultValue={subscribedPower ?? ''}
              />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-meterNumber">Numéro de compteur</Label>
            <Input id="field-meterNumber" name="meterNumber" defaultValue={meterNumber ?? ''} />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <Label htmlFor="field-label">Libellé</Label>
          <Input id="field-label" name="label" defaultValue={label ?? ''} />
        </label>

        <p className="text-xs text-gray-500">
          Le logement de rattachement ne change pas : un compteur reste attaché à son logement.
        </p>

        <SaveButton label="Enregistrer les modifications" pending={pending} message={message} />
      </form>
    </EditControl>
  );
}

const PAYMENT_METHODS = [
  ['ORANGE_MONEY', 'Orange Money'],
  ['MTN_MOMO', 'MTN MoMo'],
  ['MOOV_MONEY', 'Moov Money'],
  ['WAVE', 'Wave'],
  ['CASH', 'Espèces'],
  ['OTHER', 'Autre'],
] as const;

/** Formulaire d'édition d'une recharge CIE — flow.md §35. */
export function PurchaseEditForm({
  id,
  amountPaid,
  energyCreditedKwh,
  paymentMethod,
  purchasedAt,
  tokenReference,
}: {
  id: string;
  amountPaid: number;
  energyCreditedKwh: number | null;
  paymentMethod: string;
  purchasedAt: Date;
  tokenReference: string | null;
}) {
  const [message, action, pending] = useActionState(updatePurchaseAction, null);

  return (
    <EditControl label="Modifier cette recharge">
      <form action={action} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <input type="hidden" name="id" value={id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-amountPaid">Montant payé (FCFA)</Label>
            <Input id="field-amountPaid" name="amountPaid" type="number" required step="1" min="1" defaultValue={amountPaid} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-energyCreditedKwh">kWh crédités</Label>
            <Input id="field-energyCreditedKwh" name="energyCreditedKwh" type="number" step="0.01" defaultValue={energyCreditedKwh ?? ''} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-purchasedAt">Date de la recharge</Label>
            <Input id="field-purchasedAt" name="purchasedAt" type="date" defaultValue={purchasedAt.toISOString().slice(0, 10)} />
          </label>
          <SelectField
              name="paymentMethod"
              label="Moyen de paiement"
              defaultValue={paymentMethod}
              options={PAYMENT_METHODS.map(([value, lbl]) => ({ value, label: lbl }))}
            />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <Label htmlFor="field-tokenReference">Référence du ticket</Label>
          <Input id="field-tokenReference" name="tokenReference" defaultValue={tokenReference ?? ''} />
        </label>

        <p className="text-xs text-gray-500">
          La photo du reçu n’est pas remplacée ici : une preuve déjà enregistrée ne se réécrit pas.
        </p>

        <SaveButton label="Enregistrer les modifications" pending={pending} message={message} />
      </form>
    </EditControl>
  );
}

/** Formulaire d'édition d'une facture SODECI — flow.md §22. */
export function WaterBillEditForm({
  id,
  periodStart,
  periodEnd,
  consumptionM3,
  amountTtc,
  invoiceReference,
}: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  consumptionM3: number;
  amountTtc: number;
  invoiceReference: string | null;
}) {
  const [message, action, pending] = useActionState(updateWaterBillAction, null);

  return (
    <EditControl label="Modifier cette facture">
      <form action={action} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <input type="hidden" name="id" value={id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-consumptionM3">Consommation (m³)</Label>
            <Input id="field-consumptionM3" name="consumptionM3" type="number" required step="0.01" defaultValue={consumptionM3} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-amountTtc">Montant TTC (FCFA)</Label>
            <Input id="field-amountTtc" name="amountTtc" type="number" required step="1" defaultValue={amountTtc} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-periodStart">Début de période</Label>
            <Input id="field-periodStart" name="periodStart" type="date" required defaultValue={periodStart.toISOString().slice(0, 10)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <Label htmlFor="field-periodEnd">Fin de période</Label>
            <Input id="field-periodEnd" name="periodEnd" type="date" required defaultValue={periodEnd.toISOString().slice(0, 10)} />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <Label htmlFor="field-invoiceReference">Référence de facture</Label>
          <Input id="field-invoiceReference" name="invoiceReference" defaultValue={invoiceReference ?? ''} />
        </label>

        <SaveButton label="Enregistrer les modifications" pending={pending} message={message} />
      </form>
    </EditControl>
  );
}