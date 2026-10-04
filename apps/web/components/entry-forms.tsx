'use client';

import { useActionState } from 'react';
import {
  createPurchaseAction,
  createReadingAction,
  createWaterBillAction,
} from '@/lib/data-actions';
import { Input, Label } from '@/components/ui';
import { RadioField, SelectField } from './form-fields';
import { SaveButton } from './save-feedback';

export type MeterOption = {
  id: string;
  label: string;
  utilityType: 'ELECTRICITY' | 'WATER';
  provider: string;
};

/**
 * Champ texte — shadcn `Input` + `Label`.
 *
 * L'erreur du serveur est rattachée au champ via `aria-describedby` : sans ce
 * lien, un lecteur d'écran annonce « champ de saisie » sans dire lequel (flow.md §43).
 */
function Field({
  label,
  name,
  type = 'text',
  required,
  step,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  step?: string;
  placeholder?: string;
  hint?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required && (
          <span className="text-red-600" aria-hidden>
            *
          </span>
        )}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        required={required}
        placeholder={placeholder}
        aria-describedby={hintId}
      />
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Liste déroulante — `SelectField` (Radix piloté, sérialisé en FormData). */
function Select({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
}) {
  return <SelectField name={name} label={label} options={options} />;
}

function MeterSelect({ meters, name = 'meterId' }: { meters: MeterOption[]; name?: string }) {
  return (
    <Select
      label="Compteur"
      name={name}
      options={meters.map((m) => ({ value: m.id, label: m.label }))}
    />
  );
}

// flow.md §44 — feedback après sauvegarde, centralisé et cohérent.
function SaveSubmit({ label, pending, message }: { label: string; pending: boolean; message: string | null }) {
  return <SaveButton pending={pending} message={message} label={label} />;
}

/** Champ d'envoi d'un reçu — flow.md §35 et §40 (validation côté serveur). */
function ReceiptField() {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="receipt">Photo du reçu (facultatif)</Label>
      <Input
        id="receipt"
        name="receipt"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        aria-describedby="receipt-hint"
        className="file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
      />
      <p id="receipt-hint" className="text-xs text-gray-500">
        JPEG, PNG, WebP, HEIC ou PDF — 5 Mo maximum.
      </p>
    </div>
  );
}

/**
 * Groupe de boutons radio — flow.md §10.
 *
 * `RadioField` est piloté par React ET répliqué dans un `<input type="hidden">`
 * : le serveur reçoit donc bien `formData.get('readingType')`, exactement
 * comme avec des radios natifs. Le type de valeur reste toujours explicite
 * (flow.md §10 — jamais d'interprétation automatique).
 */
function ReadingTypeField() {
  return (
    <RadioField
      name="readingType"
      legend="Que représente cette valeur ?"
      defaultValue="INDEX"
      options={[
        { value: 'INDEX', label: 'Index de consommation' },
        { value: 'CREDIT', label: 'Crédit disponible' },
        { value: 'ENERGY_AVAILABLE', label: 'Énergie disponible en kWh' },
        { value: 'FCFA', label: 'Montant en FCFA' },
        { value: 'UNKNOWN', label: 'Je ne sais pas' },
      ]}
    />
  );
}

/** flow.md §35 — recharge CIE. Le champ kWh est facultatif. */
export function PurchaseForm({ meters }: { meters: MeterOption[] }) {
  const [message, action, pending] = useActionState(createPurchaseAction, null);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter une recharge CIE</h2>
      <MeterSelect meters={meters} />
      <Field label="Montant payé (FCFA)" name="amountPaid" type="number" required step="1" />
      <Field label="kWh crédités (facultatif)" name="energyCreditedKwh" type="number" step="0.01" />
      <Select
        label="Méthode de paiement"
        name="paymentMethod"
        options={[
          { value: 'ORANGE_MONEY', label: 'Orange Money' },
          { value: 'MTN_MOMO', label: 'MTN MoMo' },
          { value: 'MOOV_MONEY', label: 'Moov Money' },
          { value: 'WAVE', label: 'Wave' },
          { value: 'CASH', label: 'Espèces' },
          { value: 'OTHER', label: 'Autre' },
        ]}
      />
      <Field label="Date de la recharge" name="purchasedAt" type="date" />
      <Field label="Référence du reçu" name="tokenReference" placeholder="Optionnel" />
      <ReceiptField />
      <p className="text-xs leading-5 text-gray-500">
        Sans kWh crédités, l’énergie sera estimée depuis le montant. Elle sera affichée comme « Estimé ».
      </p>
      <SaveSubmit label="Enregistrer la recharge" pending={pending} message={message} />
    </form>
  );
}
/**
 * flow.md §36 et §10 — ajout d'un relevé.
 * Le type de valeur est toujours demandé : jamais d'interprétation automatique.
 */
export function ReadingForm({ meters }: { meters: MeterOption[] }) {
  const [message, action, pending] = useActionState(createReadingAction, null);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter un relevé</h2>
      <MeterSelect meters={meters} />
      <Field label="Valeur affichée" name="value" type="number" required step="0.01" />

      {/* flow.md §10 — la nature de la valeur doit être qualifiée */}
      <ReadingTypeField />

      <Select
        label="Unité"
        name="unit"
        options={[
          { value: 'M3', label: 'm³' },
          { value: 'KWH', label: 'kWh' },
          { value: 'FCFA', label: 'FCFA' },
          { value: 'UNKNOWN', label: 'Je ne sais pas' },
        ]}
      />
      <Field label="Date du relevé" name="readingDate" type="date" />
      <Field label="Note" name="note" placeholder="Facultatif" />
      <p className="text-xs leading-5 text-gray-500">
        Si vous ne savez pas ce que représente la valeur, elle est conservée mais n’entre dans aucun calcul financier.
      </p>
      <SaveSubmit label="Enregistrer le relevé" pending={pending} message={message} />
    </form>
  );
}

/** flow.md §22 — facture SODECI */
export function WaterBillForm({ meters }: { meters: MeterOption[] }) {
  const [message, action, pending] = useActionState(createWaterBillAction, null);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter une facture SODECI</h2>
      <MeterSelect meters={meters} />
      <Field label="Consommation (m³)" name="consumptionM3" type="number" required step="0.01" />
      <Field label="Montant TTC (FCFA)" name="amountTtc" type="number" required step="1" />
      <Field label="Début de période" name="periodStart" type="date" required />
      <Field label="Fin de période" name="periodEnd" type="date" required />
      <Field label="Référence de facture" name="invoiceReference" placeholder="Facultatif" />
      <ReceiptField />
      <p className="text-xs leading-5 text-gray-500">
        L’application calcule un coût effectif observé. Ce n’est pas le tarif officiel SODECI.
      </p>
      <SaveSubmit label="Enregistrer la facture" pending={pending} message={message} />
    </form>
  );
}
